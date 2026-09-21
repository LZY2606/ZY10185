import type {
  AnalysisFrame,
  AnalysisResponse,
  CheckConfig,
  CheckKey,
  FailureReason,
  NeighborEvidence,
  PointResult,
  RawPoint
} from './types.js';
import { framesFixture, datasetId, xs, ys } from './fixture.js';

export const defaultConfig: CheckConfig = {
  enabled: {
    median: true,
    peakRatio: true,
    velocityRange: true,
    temporal: true
  },
  medianThreshold: 2.5,
  peakRatioThreshold: 1.5,
  speedThreshold: 8,
  temporalThreshold: 3,
  minimumNeighbors: 3,
  repair: 'interpolate',
  fieldVersion: 'repaired'
};

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function indexPoints(points: RawPoint[]): Map<number, Map<string, RawPoint>> {
  const byFrame = new Map<number, Map<string, RawPoint>>();
  for (const point of points) {
    let frame = byFrame.get(point.frameId);
    if (!frame) {
      frame = new Map();
      byFrame.set(point.frameId, frame);
    }
    frame.set(`${point.i},${point.j}`, point);
  }
  return byFrame;
}

function pointAt(byFrame: Map<number, Map<string, RawPoint>>, frameId: number, i: number, j: number) {
  if (i < 0 || j < 0 || i >= xs.length || j >= ys.length) return null;
  return byFrame.get(frameId)?.get(`${i},${j}`) ?? null;
}

function rawNeighbors(
  point: RawPoint,
  byFrame: Map<number, Map<string, RawPoint>>
): NeighborEvidence[] {
  const neighbors: NeighborEvidence[] = [];
  for (const dj of [-1, 0, 1]) {
    for (const di of [-1, 0, 1]) {
      if (di === 0 && dj === 0) continue;
      const candidate = pointAt(byFrame, point.frameId, point.i + di, point.j + dj);
      if (
        candidate &&
        candidate.status === 'valid' &&
        isFiniteNumber(candidate.u) &&
        isFiniteNumber(candidate.v)
      ) {
        neighbors.push({
          i: candidate.i,
          j: candidate.j,
          x: candidate.x,
          y: candidate.y,
          u: candidate.u,
          v: candidate.v,
          peakRatio: isFiniteNumber(candidate.peakRatio) ? candidate.peakRatio : Number.NaN,
          dx: candidate.x - point.x,
          dy: candidate.y - point.y
        });
      }
    }
  }
  return neighbors;
}

function evaluateFrame(
  frameId: number,
  byFrame: Map<number, Map<string, RawPoint>>,
  config: CheckConfig,
  previousFrameId: number | null
) {
  const framePoints = [...(byFrame.get(frameId)?.values() ?? [])].sort(
    (a, b) => a.j - b.j || a.i - b.i
  );
  const results = new Map<string, PointResult>();
  const accepted = new Set<string>();

  for (const point of framePoints) {
    const resultKey = `${point.i},${point.j}`;
    const finiteU = isFiniteNumber(point.u) ? point.u : null;
    const finiteV = isFiniteNumber(point.v) ? point.v : null;
    const finitePeak = isFiniteNumber(point.peakRatio) ? point.peakRatio : null;
    const neighbors = rawNeighbors(point, byFrame);
    const failureReasons: FailureReason[] = [];
    let medianResidual: number | null = null;
    let temporalDelta: number | null = null;

    if (point.status === 'valid' && (!isFiniteNumber(point.u) || !isFiniteNumber(point.v))) {
      failureReasons.push({
        check: 'velocityRange',
        message: 'u 或 v 为浮点非数值，按缺失传播，不能归零使用'
      });
    }

    if (point.status === 'valid' && finiteU !== null && finiteV !== null) {
      if (config.enabled.median && neighbors.length >= config.minimumNeighbors) {
        const medianU = median(neighbors.map((neighbor) => neighbor.u));
        const medianV = median(neighbors.map((neighbor) => neighbor.v));
        if (medianU !== null && medianV !== null) {
          medianResidual = Math.max(Math.abs(finiteU - medianU), Math.abs(finiteV - medianV));
          if (medianResidual > config.medianThreshold) {
            failureReasons.push({
              check: 'median',
              message: `中值残差 ${medianResidual.toFixed(3)} 大于阈值 ${config.medianThreshold}`,
              evidence: Number(medianResidual.toFixed(6))
            });
          }
        }
      }

      if (config.enabled.peakRatio) {
        if (finitePeak === null) {
          failureReasons.push({ check: 'peakRatio', message: '相关峰比缺失' });
        } else if (finitePeak < config.peakRatioThreshold) {
          failureReasons.push({
            check: 'peakRatio',
            message: `峰比 ${finitePeak.toFixed(3)} 低于阈值 ${config.peakRatioThreshold}`,
            evidence: finitePeak
          });
        }
      }

      const speed = Math.hypot(finiteU, finiteV);
      if (config.enabled.velocityRange && speed > config.speedThreshold) {
        failureReasons.push({
          check: 'velocityRange',
          message: `速率 ${speed.toFixed(3)} 超过阈值 ${config.speedThreshold}`,
          evidence: Number(speed.toFixed(6))
        });
      }

      if (config.enabled.temporal && previousFrameId !== null) {
        const previous = pointAt(byFrame, previousFrameId, point.i, point.j);
        if (
          previous &&
          previous.status === 'valid' &&
          isFiniteNumber(previous.u) &&
          isFiniteNumber(previous.v)
        ) {
          temporalDelta = Math.max(
            Math.abs(finiteU - previous.u),
            Math.abs(finiteV - previous.v)
          );
          if (temporalDelta > config.temporalThreshold) {
            failureReasons.push({
              check: 'temporal',
              message: `与上一帧原始矢量最大分量差 ${temporalDelta.toFixed(3)} 大于阈值 ${config.temporalThreshold}`,
              evidence: Number(temporalDelta.toFixed(6))
            });
          }
        }
      }
    }

    const invalid = point.status !== 'valid' || failureReasons.length > 0;
    if (!invalid) accepted.add(resultKey);

    results.set(resultKey, {
      frameId,
      i: point.i,
      j: point.j,
      x: point.x,
      y: point.y,
      rawU: finiteU,
      rawV: finiteV,
      peakRatio: finitePeak,
      sourceStatus: point.status,
      invalid,
      failureReasons,
      medianResidual: medianResidual === null ? null : Number(medianResidual.toFixed(6)),
      temporalDelta: temporalDelta === null ? null : Number(temporalDelta.toFixed(6)),
      neighborCount: neighbors.length,
      neighbors,
      fieldU: finiteU,
      fieldV: finiteV,
      fieldSource: point.status === 'valid' ? 'raw' : 'hole',
      supportPoints: [],
      methodDetail: '',
      vorticity: null,
      divergence: null
    });
  }

  return { results, accepted, framePoints };
}

function repairAndDerive(
  frameId: number,
  state: ReturnType<typeof evaluateFrame>,
  byFrame: Map<number, Map<string, RawPoint>>,
  acceptedByFrame: Map<number, Set<string>>,
  config: CheckConfig
): PointResult[] {
  const { results } = state;
  const currentAccepted = acceptedByFrame.get(frameId) ?? new Set<string>();
  const frameIndex = framesFixture.find((frame) => frame.id === frameId)?.frameIndex ?? 0;
  const previousFrameId = frameIndex === 0 ? null : framesFixture[frameIndex - 1]?.id ?? null;
  const previousAccepted = previousFrameId === null ? null : acceptedByFrame.get(previousFrameId);

  for (const result of results.values()) {
    const resultKey = `${result.i},${result.j}`;
    if (!result.invalid) {
      result.fieldSource = 'raw';
      result.methodDetail = '原始矢量通过当前启用检查，直接作为选定场版本';
      result.supportPoints = [{ frameId, i: result.i, j: result.j, weight: 1 }];
      continue;
    }

    result.fieldU = null;
    result.fieldV = null;
    result.fieldSource = 'hole';
    result.methodDetail = '该点未通过检查或源状态缺失；留空修复保留空洞';

    if (config.fieldVersion === 'raw') {
      result.methodDetail = '选定原始场版本：该点未通过检查或源状态缺失，保留空洞，涡量/散度不读取替换值';
      continue;
    }

    if (config.repair === 'leave') {
      continue;
    }

    if (config.repair === 'interpolate') {
      const support = result.neighbors
        .filter((neighbor) => currentAccepted.has(`${neighbor.i},${neighbor.j}`))
        .map((neighbor) => {
          const distance = Math.hypot(neighbor.x - result.x, neighbor.y - result.y);
          return { neighbor, distance };
        })
        .filter((item) => item.distance > 0);

      if (support.length < config.minimumNeighbors) {
        result.methodDetail = `局部插值仅有 ${support.length} 个已接受原始支持点，少于 ${config.minimumNeighbors}，保留空洞；不使用新生成值连锁补洞`;
        continue;
      }

      const weighted = support.map((item) => ({ ...item, weight: 1 / item.distance }));
      const weightSum = weighted.reduce((sum, item) => sum + item.weight, 0);
      result.fieldU = weighted.reduce(
        (sum, item) => sum + item.weight * (item.neighbor.u ?? 0),
        0
      ) / weightSum;
      result.fieldV = weighted.reduce(
        (sum, item) => sum + item.weight * (item.neighbor.v ?? 0),
        0
      ) / weightSum;
      result.fieldSource = 'interpolation';
      result.supportPoints = weighted.map((item) => ({
        frameId,
        i: item.neighbor.i,
        j: item.neighbor.j,
        weight: Number((item.weight / weightSum).toFixed(6))
      }));
      result.methodDetail = `基于 ${support.length} 个已接受原始邻域点的反距离加权插值；支持点不包含遮挡、失败点或本帧刚生成的替换值`;
      continue;
    }

    if (config.repair === 'previous' && previousFrameId !== null && previousAccepted) {
      if (!previousAccepted.has(resultKey)) {
        result.methodDetail = '上一帧同格点不是已接受原始矢量，保留空洞；不引用修复值或继续向前追溯';
        continue;
      }
      const previousRaw = pointAt(byFrame, previousFrameId, result.i, result.j);
      if (
        !previousRaw ||
        previousRaw.status !== 'valid' ||
        !isFiniteNumber(previousRaw.u) ||
        !isFiniteNumber(previousRaw.v)
      ) {
        result.methodDetail = '上一帧同格点缺少有限原始值，按缺失保留空洞';
        continue;
      }
      result.fieldU = previousRaw.u;
      result.fieldV = previousRaw.v;
      result.supportPoints = [{ frameId: previousFrameId, i: result.i, j: result.j, weight: 1 }];
      result.fieldSource = 'previous-frame';
      result.methodDetail = '引用上一帧同格点且通过检查的原始矢量；不引用上一帧的插值或继续向前追溯';
    }
  }

  const repairedIndex = new Map(
    [...results.values()].map((result) => [`${result.i},${result.j}`, result] as const)
  );

  for (const result of results.values()) {
    if (result.i === 0 || result.j === 0 || result.i === xs.length - 1 || result.j === ys.length - 1) {
      result.vorticity = null;
      result.divergence = null;
      continue;
    }

    const left = repairedIndex.get(`${result.i - 1},${result.j}`);
    const right = repairedIndex.get(`${result.i + 1},${result.j}`);
    const bottom = repairedIndex.get(`${result.i},${result.j - 1}`);
    const top = repairedIndex.get(`${result.i},${result.j + 1}`);
    const values = [result, left, right, bottom, top].flatMap((item) => [
      item?.fieldU,
      item?.fieldV
    ]);
    if (values.some((value) => value === null || !Number.isFinite(value))) {
      result.vorticity = null;
      result.divergence = null;
      continue;
    }

    const dx = (right?.x ?? 0) - (left?.x ?? 0);
    const dy = (top?.y ?? 0) - (bottom?.y ?? 0);
    const duDx = ((right?.fieldU ?? 0) - (left?.fieldU ?? 0)) / dx;
    const dvDx = ((right?.fieldV ?? 0) - (left?.fieldV ?? 0)) / dx;
    const duDy = ((top?.fieldU ?? 0) - (bottom?.fieldU ?? 0)) / dy;
    const dvDy = ((top?.fieldV ?? 0) - (bottom?.fieldV ?? 0)) / dy;
    result.vorticity = Number((dvDx - duDy).toFixed(9));
    result.divergence = Number((duDx + dvDy).toFixed(9));
  }

  return [...results.values()].sort((a, b) => a.j - b.j || a.i - b.i);
}

export function analyze(points: RawPoint[], config: CheckConfig): AnalysisResponse {
  const byFrame = indexPoints(points);
  const acceptedByFrame = new Map<number, Set<string>>();
  const analyzedPoints = new Map<number, PointResult[]>();

  for (const frame of framesFixture) {
    const previousFrameId = frame.frameIndex === 0 ? null : framesFixture[frame.frameIndex - 1]?.id ?? null;
    const state = evaluateFrame(frame.id, byFrame, config, previousFrameId);
    acceptedByFrame.set(frame.id, state.accepted);
    analyzedPoints.set(
      frame.id,
      repairAndDerive(frame.id, state, byFrame, acceptedByFrame, config)
    );
  }

  const analysisFrames: AnalysisFrame[] = framesFixture.map((frame) => ({
    frameId: frame.id,
    frameIndex: frame.frameIndex,
    points: analyzedPoints.get(frame.id)!
  }));

  return { dataset: datasetId, config, frames: analysisFrames };
}
