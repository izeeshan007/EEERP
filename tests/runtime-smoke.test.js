const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('dashboard and login inline scripts parse without syntax errors', () => {
 for (const file of ['index.html', 'login.html']) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
  let count = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
   if (/\bsrc\s*=/.test(match[1]) || /application\/(?:ld\+)?json/.test(match[1])) continue;
   new vm.Script(match[2], { filename: file + ':inline-' + (++count) });
  }
  assert.ok(count > 0);
  assert.match(html, /erp-api\.js/);
 }
});

test('real app health is session independent and login fails closed without credentials', async t => {
 const unexpectedErrors = [];
 t.mock.method(console, 'error', (...args) => unexpectedErrors.push(args.join(' ')));
 // Importing the server does not connect MongoDB. Never use real credentials.
 Object.assign(process.env, {
  NODE_ENV: 'test', RENDER: '', RAILWAY_ENVIRONMENT_NAME: '',
  SESSION_SECRET: 'runtime-smoke-test-only-secret', ADMIN_USER: '', ADMIN_PASS: '',
  MONGO_URI: '', MONGO_DIRECT_URI: '', FRONTEND_URLS: '', FRONTEND_URL: ''
 });
 const { app } = require('../server');
 const server = app.listen(0, '127.0.0.1');
 await new Promise(resolve => server.once('listening', resolve));
 t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
 const origin = 'http://127.0.0.1:' + server.address().port;
 const health = await fetch(origin + '/api/health');
 assert.equal(health.status, 200);
 assert.equal(health.headers.get('set-cookie'), null);
 assert.match(health.headers.get('cache-control'), /no-store/);
 const state = await health.json();
 assert.equal(state.service, 'eeerp');
 assert.equal(state.ready, false);
 assert.equal(state.version, '20260923-login-order-fix');
 const ready = await fetch(origin + '/api/ready');
 assert.equal(ready.status, 503);
 assert.equal(ready.headers.get('set-cookie'), null);
 assert.deepEqual(await ready.json(), { ready: false });
 const auth = await fetch(origin + '/api/check-auth');
 assert.equal((await auth.json()).authenticated, false);
 const login = await fetch(origin + '/api/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
 });
 assert.equal(login.status, 503);
 assert.equal(login.headers.get('set-cookie'), null);
 // Exercise successful login through the real middleware chain, not just a
 // mock app: invoking next() instead of passing next used to throw after it.
 process.env.ADMIN_USER = 'runtime-test-admin';
 process.env.ADMIN_PASS = 'runtime-test-password';
 const accepted = await fetch(origin + '/api/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'runtime-test-admin', password: 'runtime-test-password' })
 });
 assert.equal(accepted.status, 200);
 assert.deepEqual(await accepted.json(), { success: true });
 const cookie = accepted.headers.get('set-cookie').split(';')[0];
 const authenticated = await fetch(origin + '/api/check-auth', { headers: { Cookie: cookie } });
 assert.equal(authenticated.status, 200);
 assert.equal((await authenticated.json()).authenticated, true);
 const logout = await fetch(origin + '/api/logout', { method: 'POST', headers: { Cookie: cookie } });
 assert.equal(logout.status, 200);
 const afterLogout = await fetch(origin + '/api/check-auth', { headers: { Cookie: cookie } });
 assert.equal((await afterLogout.json()).authenticated, false);
 await new Promise(resolve => setImmediate(resolve));
 assert.deepEqual(unexpectedErrors, [], 'Middleware must not throw after starting the route handler');
});
