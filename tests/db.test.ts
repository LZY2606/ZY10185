import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze, defaultConfig } from '../src/analysis.js';
import { buildFixturePoints, framesFixture, xs, ys } from '../src/fixture.js';
import {
  datasetReady,
  exportRun,
  listRuns,
  loadRawPoints,
  migrate,
  resetAndImportFixture,
  saveRun
} from '../src/db.js';

let tempDir = '';

function tempDb() {
  tempDir = mkdtempSync(join(tmpdir(), 'flow-board-db-'));
  return new Database(join(tempDir, 'test.sqlite'));
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('sqlite fixture and run replay', () => {
  it('imports the complete fixed fixture and supports reset/reimport', () => {
    const db = tempDb();
    migrate(db);
    expect(datasetReady(db)).toBe(false);

    const first = resetAndImportFixture(db);
    expect(first).toHaveLength(framesFixture.length * xs.length * ys.length);
    expect(loadRawPoints(db)).toEqual(buildFixturePoints());
    expect(datasetReady(db)).toBe(true);

    const result = analyze(loadRawPoints(db), defaultConfig);
    const runId = saveRun(db, defaultConfig, result);
    expect(listRuns(db)).toHaveLength(1);

    const second = resetAndImportFixture(db);
    expect(second).toEqual(buildFixturePoints());
    expect(listRuns(db)).toHaveLength(0);

    const rerunResult = analyze(loadRawPoints(db), defaultConfig);
    saveRun(db, defaultConfig, rerunResult);
    expect(listRuns(db)).toHaveLength(1);
    db.close();
  });

  it('exports persisted point testimony for replay', () => {
    const db = tempDb();
    resetAndImportFixture(db);
    const result = analyze(loadRawPoints(db), { ...defaultConfig, repair: 'leave' });
    const runId = saveRun(db, { ...defaultConfig, repair: 'leave' }, result);
    const exported = exportRun(db, runId);
    expect(exported).not.toBeNull();
    expect(exported!.run.config.repair).toBe('leave');
    expect(exported!.points).toHaveLength(framesFixture.length * xs.length * ys.length);
    const occluded = exported!.points.find((point: any) => point.frameId === 2 && point.i === 2 && point.j === 1);
    expect(occluded.fieldSource).toBe('hole');
    expect(occluded.supportPoints).toEqual([]);
    db.close();
  });
});
