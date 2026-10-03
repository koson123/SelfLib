// Runs only against a disposable first-run container; never against an existing owner install.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const origin = 'http://localhost:3000';
let cookie = '';
let csrf = '';
async function call(path, method = 'GET', body) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      Origin: origin,
      Cookie: cookie,
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
  for (let i = 0; i < 30; i++) {
    try {
      if ((await call('/healthz')).response.ok) return;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Container did not become healthy.');
}
await ready();
assert.equal((await call('/api/items')).response.status, 401);
assert.equal(
  (await call('/api/status')).json.setupRequired,
  true,
  'Use a fresh disposable volume.',
);
const setupToken = execFileSync(
  'docker',
  ['compose', 'exec', '-T', 'selflib', 'cat', '/data/setup.token'],
  { encoding: 'utf8' },
);
assert.equal(
  (
    await call('/api/setup', 'POST', {
      username: 'smoke-owner',
      password: 'disposable-smoke-password',
      setupToken,
    })
  ).response.status,
  201,
);
await call('/api/items/demo-0/favorite', 'PUT', { favorite: true });
execFileSync('docker', ['compose', 'restart'], { stdio: 'inherit' });
await ready();
assert.equal((await call('/api/items?demo=true&favorite=true')).json.total, 1);
await call('/api/logout', 'POST', {});
assert.equal((await call('/api/items')).response.status, 401);
console.log('Container first-run, authentication, favorite persistence and restart passed.');
