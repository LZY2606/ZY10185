import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderFramePng } from '../src/render.js';
import { analyze, defaultConfig } from '../src/analysis.js';
import { buildFixturePoints } from '../src/fixture.js';

const tempDir = mkdtempSync(join(tmpdir(), 'flow-board-server-'));
const dbPath = join(tempDir, 'server.sqlite');
let child: ReturnType<typeof spawn>;
let baseUrl = '';
let testPort = 0;

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  testPort = await freePort();
  child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts', '--host', '127.0.0.1', '--port', String(testPort)], {
    env: { ...process.env, FLOW_DB_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  baseUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server timeout')), 10000);
    child.stdout?.on('data', (chunk) => {
      const text = String(chunk);
      const match = text.match(/http:\/\/(127\.0\.0\.1:(\d+))/);
      if (match) {
        clearTimeout(timer);
        resolve(`http://${match[1]}`);
      }
    });
    child.stderr?.on('data', (chunk) => process.stderr.write(chunk));
    child.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
}, 15000);

afterAll(() => {
  child.kill('SIGTERM');
  rmSync(tempDir, { recursive: true, force: true });
});

describe('http service and canvas', () => {
  it('serves the Chinese board page', async () => {
    const response = await fetch(baseUrl);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('流场证言板');
  });

  it('analyzes, persists, exports and reimports over HTTP', async () => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...defaultConfig, repair: 'interpolate' })
    });
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.frames).toHaveLength(4);

    const exported = await fetch(`${baseUrl}/api/runs/${result.runId}/export`).then((r) => r.json());
    expect(exported.points.length).toBeGreaterThan(0);

    const reimport = await fetch(`${baseUrl}/api/reimport`, { method: 'POST' }).then((r) => r.json());
    expect(reimport.ok).toBe(true);
  });

  it('renders a PNG buffer server-side', () => {
    const result = analyze(buildFixturePoints(), defaultConfig);
    const png = renderFramePng(result.frames[0]!);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });
});
