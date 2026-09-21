export type Status = 'valid' | 'occluded' | 'missing';
export type RepairMethod = 'leave' | 'interpolate' | 'previous';
export type CheckKey = 'median' | 'peakRatio' | 'velocityRange' | 'temporal';
export type FieldVersion = 'raw' | 'repaired';

export interface RawPoint {
  frameId: number;
  i: number;
  j: number;
  x: number;
  y: number;
  u: number | null;
  v: number | null;
  peakRatio: number | null;
  status: Status;
}

export interface CheckConfig {
  enabled: Record<CheckKey, boolean>;
  medianThreshold: number;
  peakRatioThreshold: number;
  speedThreshold: number;
  temporalThreshold: number;
  minimumNeighbors: number;
  repair: RepairMethod;
  fieldVersion: FieldVersion;
}

export interface NeighborEvidence {
  i: number;
  j: number;
  x: number;
  y: number;
  u: number;
  v: number;
  peakRatio: number;
  dx: number;
  dy: number;
}

export interface FailureReason {
  check: CheckKey;
  message: string;
  evidence?: number | number[];
}

export interface PointResult {
  frameId: number;
  i: number;
  j: number;
  x: number;
  y: number;
  rawU: number | null;
  rawV: number | null;
  peakRatio: number | null;
  sourceStatus: Status;
  invalid: boolean;
  failureReasons: FailureReason[];
  medianResidual: number | null;
  temporalDelta: number | null;
  neighborCount: number;
  neighbors: NeighborEvidence[];
  fieldU: number | null;
  fieldV: number | null;
  fieldSource: 'raw' | 'hole' | 'interpolation' | 'previous-frame';
  supportPoints: Array<{ frameId: number; i: number; j: number; weight: number }>;
  methodDetail: string;
  vorticity: number | null;
  divergence: number | null;
}

export interface AnalysisFrame {
  frameId: number;
  frameIndex: number;
  points: PointResult[];
}

export interface AnalysisResponse {
  dataset: string;
  config: CheckConfig;
  frames: AnalysisFrame[];
}

export interface RunRecord {
  id: number;
  created_at: string;
  config_json: string;
  summary_json: string;
}
