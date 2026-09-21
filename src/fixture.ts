import type { RawPoint, Status } from './types.js';

export const datasetId = 'fixed-shear-layer-4x6';
export const xs = [0, 1, 3, 4, 7, 8];
export const ys = [0, 2, 3, 6];

export interface RawOverride {
  u?: number | null;
  v?: number | null;
  peakRatio?: number | null;
  status?: Status;
}

export interface FrameFixture {
  id: number;
  frameIndex: number;
  name: string;
  pair: string;
  overrides: Record<string, RawOverride>;
}

export const framesFixture: FrameFixture[] = [
  {
    id: 1,
    frameIndex: 0,
    name: '基线帧',
    pair: 'pair-00/01',
    overrides: {
      '0,0': { u: null, v: null, peakRatio: null, status: 'missing' }
    }
  },
  {
    id: 2,
    frameIndex: 1,
    name: '遮挡与边界空洞帧',
    pair: 'pair-01/02',
    overrides: {
      '0,0': { u: null, v: null, peakRatio: null, status: 'missing' },
      '1,1': { u: null, v: null, peakRatio: null, status: 'occluded' },
      '2,1': { u: null, v: null, peakRatio: null, status: 'occluded' },
      '3,1': { u: null, v: null, peakRatio: null, status: 'occluded' },
      '5,0': { u: 8.5, v: 1.5, peakRatio: 1.2, status: 'valid' }
    }
  },
  {
    id: 3,
    frameIndex: 2,
    name: '完整对照帧',
    pair: 'pair-02/03',
    overrides: {}
  },
  {
    id: 4,
    frameIndex: 3,
    name: '孤立错误与低峰比帧',
    pair: 'pair-03/04',
    overrides: {
      '4,2': { u: 9.5, v: -2.5, peakRatio: 2.0, status: 'valid' },
      '1,3': { peakRatio: 1.1, status: 'valid' }
    }
  }
];

export function trueFlow(x: number, y: number): { u: number; v: number } {
  return { u: 1 + 0.9 * y, v: 0 };
}

export function key(i: number, j: number): string {
  return `${i},${j}`;
}

export function buildFixturePoints(): RawPoint[] {
  const points: RawPoint[] = [];
  for (const frame of framesFixture) {
    for (let j = 0; j < ys.length; j += 1) {
      for (let i = 0; i < xs.length; i += 1) {
        const x = xs[i] ?? 0;
        const y = ys[j] ?? 0;
        const flow = trueFlow(x, y);
        const override = frame.overrides[key(i, j)] ?? {};
        points.push({
          frameId: frame.id,
          i,
          j,
          x,
          y,
          u: override.u === undefined ? flow.u : override.u,
          v: override.v === undefined ? flow.v : override.v,
          peakRatio: override.peakRatio === undefined ? 2.2 : override.peakRatio,
          status: override.status ?? 'valid'
        });
      }
    }
  }
  return points;
}

export function fixedFixture() {
  return {
    dataset: {
      id: datasetId,
      name: '固定非均匀剪切层 PIV fixture',
      description:
        '6×4 非均匀网格，四帧；含真实剪切层、连续三格遮挡、边界空洞、低峰比和孤立错误矢量。',
      xs,
      ys
    },
    frames: framesFixture,
    points: buildFixturePoints()
  };
}
