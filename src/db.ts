import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AnalysisResponse, CheckConfig, RawPoint } from './types.js';
import { datasetId, fixedFixture, framesFixture, xs, ys } from './fixture.js';

export function openDatabase(path = process.env.FLOW_DB_PATH ?? 'data/flow-board.sqlite') {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

export function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS datasets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      xs_json TEXT NOT NULL,
      ys_json TEXT NOT NULL,
      imported_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS frames (
      id INTEGER PRIMARY KEY,
      frame_index INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      pair TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS raw_vectors (
      frame_id INTEGER NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
      i INTEGER NOT NULL,
      j INTEGER NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      u REAL,
      v REAL,
      peak_ratio REAL,
      status TEXT NOT NULL CHECK (status IN ('valid', 'occluded', 'missing')),
      PRIMARY KEY (frame_id, i, j)
    );

    CREATE TABLE IF NOT EXISTS run_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      config_json TEXT NOT NULL,
      summary_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS run_points (
      run_id INTEGER NOT NULL REFERENCES run_records(id) ON DELETE CASCADE,
      frame_id INTEGER NOT NULL,
      i INTEGER NOT NULL,
      j INTEGER NOT NULL,
      point_json TEXT NOT NULL,
      PRIMARY KEY (run_id, frame_id, i, j)
    );
  `);
}

export function resetAndImportFixture(db: Database.Database) {
  const fixture = fixedFixture();
  const transaction = db.transaction(() => {
    migrate(db);
    db.exec('DELETE FROM run_points; DELETE FROM run_records; DELETE FROM raw_vectors; DELETE FROM frames; DELETE FROM datasets;');
    db.prepare(`
      INSERT INTO datasets (id, name, description, xs_json, ys_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      fixture.dataset.id,
      fixture.dataset.name,
      fixture.dataset.description,
      JSON.stringify(fixture.dataset.xs),
      JSON.stringify(fixture.dataset.ys)
    );

    const insertFrame = db.prepare('INSERT INTO frames (id, frame_index, name, pair) VALUES (?, ?, ?, ?)');
    const insertPoint = db.prepare(`
      INSERT INTO raw_vectors (frame_id, i, j, x, y, u, v, peak_ratio, status)
      VALUES (@frame_id, @i, @j, @x, @y, @u, @v, @peak_ratio, @status)
    `);

    for (const frame of fixture.frames) {
      insertFrame.run(frame.id, frame.frameIndex, frame.name, frame.pair);
    }
    for (const point of fixture.points) {
      insertPoint.run({
        frame_id: point.frameId,
        i: point.i,
        j: point.j,
        x: point.x,
        y: point.y,
        u: nullableFinite(point.u),
        v: nullableFinite(point.v),
        peak_ratio: nullableFinite(point.peakRatio),
        status: point.status
      });
    }
  });
  transaction();
  return loadRawPoints(db);
}

function nullableFinite(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function loadRawPoints(db: Database.Database): RawPoint[] {
  const rows = db.prepare(`
    SELECT frame_id, i, j, x, y, u, v, peak_ratio, status
    FROM raw_vectors
    ORDER BY frame_id, j, i
  `).all() as Array<{
    frame_id: number;
    i: number;
    j: number;
    x: number;
    y: number;
    u: number | null;
    v: number | null;
    peak_ratio: number | null;
    status: RawPoint['status'];
  }>;
  return rows.map((row) => ({
    frameId: row.frame_id,
    i: row.i,
    j: row.j,
    x: row.x,
    y: row.y,
    u: row.u,
    v: row.v,
    peakRatio: row.peak_ratio,
    status: row.status
  }));
}

export function datasetReady(db: Database.Database) {
  const row = db.prepare('SELECT COUNT(*) AS count FROM datasets').get() as { count: number };
  const pointCount = db.prepare('SELECT COUNT(*) AS count FROM raw_vectors').get() as { count: number };
  return row.count === 1 && pointCount.count === framesFixture.length * xs.length * ys.length;
}

export function saveRun(db: Database.Database, config: CheckConfig, result: AnalysisResponse) {
  const summary = {
    dataset: result.dataset,
    frames: result.frames.map((frame) => {
      const invalid = frame.points.filter((point) => point.invalid).length;
      const holes = frame.points.filter((point) => point.fieldSource === 'hole').length;
      const interpolated = frame.points.filter((point) => point.fieldSource === 'interpolation').length;
      const previous = frame.points.filter((point) => point.fieldSource === 'previous-frame').length;
      return { frameId: frame.frameId, total: frame.points.length, invalid, holes, interpolated, previous };
    })
  };

  const insertRun = db.prepare('INSERT INTO run_records (config_json, summary_json) VALUES (?, ?)');
  const insertPoint = db.prepare(`
    INSERT INTO run_points (run_id, frame_id, i, j, point_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  const transaction = db.transaction(() => {
    const runInfo = insertRun.run(JSON.stringify(config), JSON.stringify(summary));
    const runId = Number(runInfo.lastInsertRowid);
    for (const frame of result.frames) {
      for (const point of frame.points) {
        insertPoint.run(runId, frame.frameId, point.i, point.j, JSON.stringify(point));
      }
    }
    return runId;
  });
  return transaction();
}

export function listRuns(db: Database.Database) {
  const rows = db.prepare(`
    SELECT id, created_at, config_json, summary_json
    FROM run_records
    ORDER BY id DESC
  `).all() as Array<{ id: number; created_at: string; config_json: string; summary_json: string }>;
  return rows.map((row) => ({
    id: row.id,
    created_at: row.created_at,
    config: JSON.parse(row.config_json),
    summary: JSON.parse(row.summary_json)
  }));
}

export function loadRun(db: Database.Database, runId: number) {
  const run = db.prepare('SELECT * FROM run_records WHERE id = ?').get(runId) as
    | { id: number; created_at: string; config_json: string; summary_json: string }
    | undefined;
  if (!run) return null;
  const rows = db.prepare('SELECT point_json FROM run_points WHERE run_id = ? ORDER BY frame_id, j, i').all(runId) as Array<{ point_json: string }>;
  return {
    id: run.id,
    createdAt: run.created_at,
    config: JSON.parse(run.config_json) as CheckConfig,
    summary: JSON.parse(run.summary_json),
    points: rows.map((row) => JSON.parse(row.point_json))
  };
}

export function exportRun(db: Database.Database, runId: number) {
  const run = loadRun(db, runId);
  if (!run) return null;
  return {
    dataset: { id: datasetId },
    exportedAt: new Date().toISOString(),
    run: {
      id: run.id,
      createdAt: run.createdAt,
      config: run.config,
      summary: run.summary
    },
    points: run.points
  };
}

export function ensureFixture(db: Database.Database) {
  if (!datasetReady(db)) resetAndImportFixture(db);
}
