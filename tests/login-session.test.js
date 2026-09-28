const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const connectMongo = require('connect-mongo');
const MongoStore = connectMongo.MongoStore || connectMongo.default || connectMongo;
const { sessionPolicy, sessionOptions, createLoginHandler, apiErrorHandler } = require('../session-runtime');
const { createClient } = require('../public/erp-api');

async function fixture(t, failure) {
 const records = new Map();
 let writes = 0;
 // Exercise the installed connect-mongo adapter without a real database.
 const collection = {
  createIndex: async () => 'expires_1',
  findOne: async query => records.get(query._id) || null,
  deleteOne: async query => {
   if (failure === 'create') throw new Error('Test-only session delete failure');
   records.delete(query._id); return { deletedCount: 1 };
  },
  updateOne: async (query, update) => {
   writes++;
   if (failure === 'save') throw new Error('Test-only session write failure');
   const exists = records.has(query._id);
   records.set(query._id, { ...records.get(query._id), ...update.$set });
   return { upsertedCount: exists ? 0 : 1, matchedCount: exists ? 1 : 0 };
  }
 };
 const store = MongoStore.create({ clientPromise: Promise.resolve({ db: () => ({ collection: () => collection }) }) });
 const app = express();
 app.use(express.json());
 app.use(session(sessionOptions({ secret: 'test-only-login-secret', store, production: false, policy: sessionPolicy({}) })));
 app.post('/api/login', createLoginHandler({ ADMIN_USER: 'test-admin', ADMIN_PASS: 'test-password' }));
 app.get('/api/check-auth', (req, res) => res.json({ authenticated: !!req.session?.authenticated }));
 app.get('/api/throw', () => { throw new Error('Unexpected test-only API failure'); });
 app.use(apiErrorHandler);
 const server = app.listen(0, '127.0.0.1');
 await new Promise(resolve => server.once('listening', resolve));
 t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
 t.mock.method(console, 'error', () => {});
 const origin = 'http://127.0.0.1:' + server.address().port;
 const login = body => fetch(origin + '/api/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: body || JSON.stringify({ username: 'test-admin', password: 'test-password' })
 });
 return { origin, login, records, writes: () => writes };
}

test('successful login uses connect-mongo and persists an authenticated session', async t => {
 const f = await fixture(t);
 const response = await f.login();
 assert.equal(response.status, 200);
 assert.deepEqual(await response.json(), { success: true });
 const cookie = response.headers.get('set-cookie').split(';')[0];
 const check = await fetch(f.origin + '/api/check-auth', { headers: { Cookie: cookie } });
 assert.equal((await check.json()).authenticated, true);
 assert.equal(f.records.size, 1);
});

for (const failure of ['create', 'save']) {
 test('session ' + failure + ' failure returns JSON without issuing an authenticated cookie', async t => {
  const f = await fixture(t, failure);
  const response = await f.login();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('set-cookie'), null);
  const body = await response.json();
  assert.equal(body.code, failure === 'create' ? 'SESSION_CREATE_FAILED' : 'SESSION_SAVE_FAILED');
  assert.match(body.reference, /^[a-f0-9-]{36}$/);
  assert.equal(f.writes(), failure === 'save' ? 1 : 0, 'Failed save must not be automatically retried');
  assert.equal(f.records.size, 0);
 });
}

test('malformed JSON and unexpected API exceptions remain structured JSON', async t => {
 const f = await fixture(t);
 const invalid = await f.login('{invalid');
 assert.equal(invalid.status, 400);
 assert.equal((await invalid.json()).code, 'INVALID_JSON');
 const response = await fetch(f.origin + '/api/throw');
 assert.equal(response.status, 500);
 const body = await response.json();
 assert.equal(body.code, 'ERP_API_ERROR');
 assert.ok(body.reference);
 assert.ok(!JSON.stringify(body).includes('Unexpected test-only'));
});

test('incorrect password never creates an authenticated session', async t => {
 const f = await fixture(t);
 const response = await f.login(JSON.stringify({ username: 'test-admin', password: 'incorrect' }));
 assert.equal(response.status, 401);
 assert.equal(response.headers.get('set-cookie'), null);
 assert.equal(f.records.size, 0);
});

test('frontend displays the server error code and matching log reference', async () => {
 const client = createClient({ fetchImpl: async () => Response.json({ message: 'Could not save session.', code: 'SESSION_SAVE_FAILED', reference: 'test-reference' }, { status: 503 }) });
 await assert.rejects(client.request('/api/login', { method: 'POST' }), /SESSION_SAVE_FAILED.*test-reference/);
});
