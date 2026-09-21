import { describe, expect, it } from 'vitest';
import { analyze, defaultConfig } from '../src/analysis.js';
import { buildFixturePoints, framesFixture, xs, ys } from '../src/fixture.js';
import type { CheckConfig, PointResult, RawPoint, RepairMethod } from '../src/types.js';

const points = buildFixturePoints();

function point(results: PointResult[], frameId: number, i: number, j: number) {
  const found = results.find((item) => item.frameId === frameId && item.i === i && item.j === j);
  if (!found) throw new Error(`missing point ${frameId}:${i},${j}`);
  return found;
}

function withRepair(repair: RepairMethod): CheckConfig {
  return { ...defaultConfig, repair };
}

describe('fixed fixture checks', () => {
  it('detects isolated spikes, low peak ratio and temporal failure without treating shear as noise', () => {
    const analysis = analyze(points, defaultConfig);
    const frame1 = analysis.frames.find((frame) => frame.frameId === 2)!;
    expect(point(frame1.points, 2, 5, 0).failureReasons.map((reason) => reason.check)).toEqual([
      'median',
      'peakRatio',
      'velocityRange',
      'temporal'
    ]);

    const frame4 = analysis.frames.find((frame) => frame.frameId === 4)!;
    const spike = point(frame4.points, 4, 4, 2);
    expect(spike.invalid).toBe(true);
    expect(spike.failureReasons.map((reason) => reason.check)).toEqual([
      'median',
      'velocityRange',
      'temporal'
    ]);

    const peakOnly = analyze(points, {
      ...defaultConfig,
      enabled: { median: false, peakRatio: true, velocityRange: false, temporal: false }
    });
    const lowPeak = point(
      peakOnly.frames.find((frame) => frame.frameId === 4)!.points,
      4,
      1,
      3
    );
    expect(lowPeak.failureReasons.map((reason) => reason.check)).toEqual(['peakRatio']);

    const normalInterior = point(frame4.points, 4, 2, 2);
    expect(normalInterior.invalid).toBe(false);
    expect(normalInterior.failureReasons).toEqual([]);
  });

  it('keeps occluded and boundary missing points out of neighborhood evidence', () => {
    const analysis = analyze(points, defaultConfig);
    const frame2 = analysis.frames.find((frame) => frame.frameId === 2)!;
    const occluded = point(frame2.points, 2, 2, 1);
    expect(occluded.sourceStatus).toBe('occluded');
    expect(occluded.invalid).toBe(true);
    expect(occluded.neighbors.some((neighbor) => neighbor.j === 1 && [1, 2, 3].includes(neighbor.i))).toBe(false);

    const adjacent = point(frame2.points, 2, 2, 0);
    expect(adjacent.neighbors.map((neighbor) => [neighbor.i, neighbor.j])).not.toContainEqual([2, 1]);

    const boundaryHole = point(frame2.points, 2, 0, 0);
    expect(boundaryHole.invalid).toBe(true);
    expect(boundaryHole.neighborCount).toBe(2);
    expect(boundaryHole.neighbors.map((neighbor) => [neighbor.i, neighbor.j])).toEqual([
      [1, 0],
      [0, 1]
    ]);
  });
});

describe('repair methods and provenance', () => {
  it('leaves invalid points empty and records no borrowed values', () => {
    const analysis = analyze(points, withRepair('leave'));
    const frame2 = analysis.frames.find((frame) => frame.frameId === 2)!.points;
    for (const target of [[1, 1], [2, 1], [3, 1], [0, 0], [5, 0]] as const) {
      const result = point(frame2, 2, target[0], target[1]);
      expect(result.fieldU).toBeNull();
      expect(result.fieldV).toBeNull();
      expect(result.fieldSource).toBe('hole');
      expect(result.supportPoints).toEqual([]);
    }
  });

  it('interpolates only from accepted raw current-frame points and never chains generated values', () => {
    const analysis = analyze(points, withRepair('interpolate'));
    const frame2 = analysis.frames.find((frame) => frame.frameId === 2)!.points;
    const occluded = point(frame2, 2, 1, 1);
    expect(occluded.fieldSource).toBe('interpolation');
    expect(occluded.supportPoints.length).toBeGreaterThanOrEqual(3);
    expect(occluded.supportPoints).not.toContainEqual(expect.objectContaining({ i: 2, j: 1 }));
    expect(occluded.supportPoints.some((support) => support.frameId !== 2)).toBe(false);
    for (const support of occluded.supportPoints) {
      const supportResult = point(frame2, 2, support.i, support.j);
      expect(supportResult.invalid).toBe(false);
      expect(supportResult.fieldSource).toBe('raw');
    }

    const boundaryHole = point(frame2, 2, 0, 0);
    expect(boundaryHole.fieldU).toBeNull();
    expect(boundaryHole.fieldV).toBeNull();
    expect(boundaryHole.fieldSource).toBe('hole');
    expect(boundaryHole.methodDetail).toContain('少于 3');
  });

  it('uses only the previous frame raw accepted point for previous-frame repair', () => {
    const analysis = analyze(points, withRepair('previous'));
    const frame2 = analysis.frames.find((frame) => frame.frameId === 2)!.points;
    const firstOccluded = point(frame2, 2, 1, 1);
    expect(firstOccluded.fieldSource).toBe('previous-frame');
    expect(firstOccluded.fieldU).toBe(2.8);
    expect(firstOccluded.fieldV).toBe(0);
    expect(firstOccluded.supportPoints).toEqual([{ frameId: 1, i: 1, j: 1, weight: 1 }]);

    const boundaryHole = point(frame2, 2, 0, 0);
    expect(boundaryHole.fieldSource).toBe('hole');
    expect(boundaryHole.fieldU).toBeNull();
  });
});

describe('derived fields', () => {
  it('computes vorticity and divergence from actual non-uniform coordinate spacing', () => {
    const analysis = analyze(points, {
      ...withRepair('leave'),
      enabled: { median: false, peakRatio: false, velocityRange: false, temporal: false }
    });
    const frame3 = analysis.frames.find((frame) => frame.frameId === 3)!.points;
    for (let j = 1; j < ys.length - 1; j += 1) {
      for (let i = 1; i < xs.length - 1; i += 1) {
        const result = point(frame3, 3, i, j);
        expect(result.vorticity).toBeCloseTo(-0.9, 12);
        expect(result.divergence).toBeCloseTo(0, 12);
      }
    }
  });

  it('propagates missing values on derivatives instead of substituting zero', () => {
    const analysis = analyze(points, withRepair('leave'));
    const frame2 = analysis.frames.find((frame) => frame.frameId === 2)!.points;
    const nearOcclusion = point(frame2, 2, 2, 0);
    expect(nearOcclusion.vorticity).toBeNull();
    expect(nearOcclusion.divergence).toBeNull();
  });

  it('propagates non-finite raw values as missing rather than zeroing them', () => {
    const nanPoints: RawPoint[] = buildFixturePoints().map((point) =>
      point.frameId === 3 && point.i === 2 && point.j === 2
        ? { ...point, u: Number.NaN, v: 0, peakRatio: 2 }
        : point
    );
    const analysis = analyze(nanPoints, withRepair('leave'));
    const target = point(analysis.frames.find((frame) => frame.frameId === 3)!.points, 3, 2, 2);
    expect(target.rawU).toBeNull();
    expect(target.fieldU).toBeNull();
    expect(target.invalid).toBe(true);
    expect(target.vorticity).toBeNull();
    expect(target.divergence).toBeNull();
  });
});

  it('computes derived values only from the selected field version', () => {
    const raw = analyze(points, { ...withRepair('interpolate'), fieldVersion: 'raw' });
    const repaired = analyze(points, withRepair('interpolate'));
    const rawFrame = raw.frames.find((frame) => frame.frameId === 2)!.points;
    const repairedFrame = repaired.frames.find((frame) => frame.frameId === 2)!.points;
    const rawNearOcclusion = point(rawFrame, 2, 4, 1);
    const repairedNearOcclusion = point(repairedFrame, 2, 4, 1);
    expect(rawNearOcclusion.vorticity).toBeNull();
    expect(repairedNearOcclusion.fieldSource).toBe('raw');
    expect(repairedNearOcclusion.vorticity).not.toBeNull();
  });

describe('fixture metadata', () => {
  it('contains four fixed frames and nonuniform coordinates', () => {
    expect(framesFixture).toHaveLength(4);
    expect(xs).not.toEqual([0, 1, 2, 3, 4, 5]);
    expect(ys).not.toEqual([0, 1, 2, 3]);
  });
});
