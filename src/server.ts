import { createServer, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { analyze, defaultConfig } from './analysis.js';
import {
  ensureFixture,
  exportRun,
  listRuns,
  loadRawPoints,
  openDatabase,
  resetAndImportFixture,
  saveRun
} from './db.js';
import { renderFramePng } from './render.js';
import type { CheckConfig, CheckKey, RepairMethod } from './types.js';

const host = process.argv.includes('--host')
  ? process.argv[process.argv.indexOf('--host') + 1]
  : '127.0.0.1';
const port = process.argv.includes('--port')
  ? Number(process.argv[process.argv.indexOf('--port') + 1])
  : 5525;
const publicDir = join(process.cwd(), 'public');
const db = openDatabase();
ensureFixture(db);

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (request.method === 'GET' && url.pathname === '/api/fixture') {
      const points = loadRawPoints(db);
      return sendJson(response, { pointCount: points.length, points });
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/runs/') && url.pathname.endsWith('/export')) {
      const runId = Number(url.pathname.split('/')[3]);
      const exported = exportRun(db, runId);
      if (!exported) return sendJson(response, { error: 'run not found' }, 404);
      return sendJson(response, exported);
    }

    if (request.method === 'GET' && url.pathname === '/api/runs') {
      return sendJson(response, listRuns(db));
    }

    if (request.method === 'POST' && url.pathname === '/api/analyze') {
      const body = await readJson(request);
      const config = parseConfig(body);
      const result = analyze(loadRawPoints(db), config);
      const runId = saveRun(db, config, result);
      return sendJson(response, { runId, ...result });
    }

    if (request.method === 'POST' && url.pathname === '/api/reimport') {
      const points = resetAndImportFixture(db);
      return sendJson(response, { ok: true, pointCount: points.length });
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/render/')) {
      const frameId = Number(url.pathname.split('/').pop());
      const result = analyze(loadRawPoints(db), parseConfig(Object.fromEntries(url.searchParams)));
      const frame = result.frames.find((item) => item.frameId === frameId) ?? result.frames[0]!;
      const png = renderFramePng(frame);
      response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      return response.end(png);
    }

    return serveStatic(url.pathname, response);
  } catch (error) {
    return sendJson(response, { error: error instanceof Error ? error.message : 'unknown error' }, 400);
  }
});

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  console.log(`流场证言板: http://${host}:${actualPort}`);
});

function sendJson(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

function readJson(request: import('node:http').IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error('request too large'));
    });
    request.on('end', () => {
      try {
        resolve(body ? (JSON.parse(body) as Record<string, unknown>) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function parseConfig(input: Record<string, unknown>): CheckConfig {
  const numberInput = (key: keyof CheckConfig, fallback: number) => {
    const value = input[key];
    const parsed = value === undefined ? fallback : Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${key} must be finite`);
    return parsed;
  };
  const booleanFromInput = (key: string, fallback: boolean) => {
    const value = input[key];
    if (value === undefined || value === '') return fallback;
    return value === true || value === 'true' || value === 'on' || value === '1';
  };
  const repairInput = input.repair;
  const repair: RepairMethod =
    repairInput === 'leave' || repairInput === 'interpolate' || repairInput === 'previous'
      ? repairInput
      : defaultConfig.repair;
  const fieldVersionInput = input.fieldVersion;
  const fieldVersion = fieldVersionInput === 'raw' || fieldVersionInput === 'repaired'
    ? fieldVersionInput
    : defaultConfig.fieldVersion;
  const keys: CheckKey[] = ['median', 'peakRatio', 'velocityRange', 'temporal'];
  return {
    enabled: Object.fromEntries(keys.map((key) => [key, booleanFromInput(key, defaultConfig.enabled[key])])) as CheckConfig['enabled'],
    medianThreshold: numberInput('medianThreshold', defaultConfig.medianThreshold),
    peakRatioThreshold: numberInput('peakRatioThreshold', defaultConfig.peakRatioThreshold),
    speedThreshold: numberInput('speedThreshold', defaultConfig.speedThreshold),
    temporalThreshold: numberInput('temporalThreshold', defaultConfig.temporalThreshold),
    minimumNeighbors: Math.max(1, Math.round(numberInput('minimumNeighbors', defaultConfig.minimumNeighbors))),
    repair,
    fieldVersion
  };
}

function serveStatic(pathname: string, response: import('node:http').ServerResponse) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(publicDir, safePath);
  if (!filePath.startsWith(publicDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return response.end('not found');
  }
  response.writeHead(200, { 'content-type': mimeTypes[extname(filePath)] ?? 'application/octet-stream' });
  return createReadStream(filePath).pipe(response);
}
