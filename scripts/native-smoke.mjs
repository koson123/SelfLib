// Exercises the actual compiled application with a temporary data directory.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
const listener = createServer();
await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const directory = mkdtempSync(join(tmpdir(), 'selflib-production-'));
const origin = `http://localhost:${port}`;
let child;
let logs = '';
let cookie = '';
let csrf = '';
let sampledRssBytes = null;
function start() {
  child = spawn(
    process.execPath,
    [
      '--import',
      'data:text/javascript,process.channel?.unref();setInterval(()=>process.send?.(process.memoryUsage()),250).unref();',
      'dist/server.js',
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DATA_DIR: directory,
        PORT: String(port),
        APP_URL: origin,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  child.on('message', (sample) => {
    sampledRssBytes = sample.rss;
  });
  child.stdout.on('data', (v) => (logs += v));
  child.stderr.on('data', (v) => (logs += v));
}
async function stop() {
  const stopped = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await stopped;
  assert.equal(existsSync(join(directory, 'server.lock')), false);
}
async function call(path, method = 'GET', body) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      Cookie: cookie,
      Origin: origin,
      ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const set of response.headers.getSetCookie()) {
    const pair = set.split(';')[0];
    const key = pair.slice(0, pair.indexOf('='));
    cookie = cookie
      .split('; ')
      .filter((c) => !c.startsWith(key + '='))
      .concat(pair)
      .filter(Boolean)
      .join('; ');
  }
  const json = await response.json();
  if (json.csrf) csrf = json.csrf;
  return { response, json };
}
async function ready() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await call('/healthz')).response.ok) return;
    } catch {
      /* booting */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Compiled app did not start.');
}
try {
  start();
  await ready();
  assert.equal((await call('/api/items')).response.status, 401);
  assert.equal((await call('/api/demo')).json.items.length, 23);
  assert.equal((await call('/api/status')).json.setupRequired, true);
  const password = 'disposable-native-smoke-password';
  const setupToken = readFileSync(join(directory, 'setup.token'), 'utf8');
  assert.equal(
    (await call('/api/setup', 'POST', { username: 'native-owner', password, setupToken })).response
      .status,
    201,
  );
  assert.equal(existsSync(join(directory, 'setup.token')), false);
  assert.equal(
    (await call('/api/items/demo-0/favorite', 'PUT', { favorite: true })).response.status,
    200,
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  const rss = sampledRssBytes;
  await stop();
  start();
  await ready();
  assert.equal((await call('/api/items?demo=true&favorite=true')).json.total, 1);
  assert.equal((await call('/api/status')).json.setupRequired, false);
  await call('/api/logout', 'POST', {});
  assert.equal((await call('/api/items')).response.status, 401);
  assert.ok(!logs.includes(password));
  assert.ok(!logs.includes(setupToken));
  await stop();
  console.log(
    JSON.stringify({
      result: 'passed',
      node: process.version,
      architecture: process.arch,
      idleAfterSetupRssBytes: rss,
      databaseBytes: statSync(join(directory, 'selflib.sqlite')).size,
    }),
  );
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
  rmSync(directory, { recursive: true, force: true });
}
