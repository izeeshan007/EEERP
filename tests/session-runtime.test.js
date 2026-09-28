const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');
const { sessionPolicy, sessionOptions, enforceSessionLifetime, COOKIE_NAME } = require('../session-runtime');
const { createClient } = require('../public/erp-api');

async function listen(app, t) {
 const server = app.listen(0, '127.0.0.1');
 await new Promise(resolve => server.once('listening', resolve));
 t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
 return 'http://127.0.0.1:' + server.address().port;
}
function mockApp(store, production = false, clock = Date.now) {
 const app = express(), policy = sessionPolicy({});
 if (production) app.set('trust proxy', 1);
 app.use(session(sessionOptions({ secret: 'test-only-stable-secret', store, production, policy })));
 app.use(enforceSessionLifetime(policy, clock));
 app.post('/login', (req, res) => req.session.regenerate(error => {
  if (error) return res.sendStatus(500);
  req.session.authenticated = true; req.session.authenticatedAt = clock();
  req.session.save(() => res.json({ success: true }));
 }));
 app.get('/check', (req, res) => res.json({ authenticated: !!req.session.authenticated }));
 return app;
}

test('session policy renews idle expiry but bounds maximum lifetime', () => {
 assert.deepEqual(sessionPolicy({}), { idleMs: 7*86400000, absoluteMs: 30*86400000 });
 assert.deepEqual(sessionPolicy({ SESSION_IDLE_DAYS: 50, SESSION_MAX_DAYS: 2 }), { idleMs: 2*86400000, absoluteMs: 2*86400000 });
 const options=sessionOptions({secret:'test',production:true,policy:sessionPolicy({})});
 assert.equal(options.rolling,true);assert.equal(options.cookie.httpOnly,true);assert.equal(options.cookie.secure,true);assert.equal(options.cookie.sameSite,'lax');
});

test('session survives an application replacement using the same persistent store and secret', async t => {
 // A shared memory store models the persisted session record without touching MongoDB.
 const store=new session.MemoryStore();
 const first=await listen(mockApp(store),t);
 const login=await fetch(first+'/login',{method:'POST'});
 const cookie=login.headers.get('set-cookie').split(';')[0];
 assert.ok(cookie.startsWith(COOKIE_NAME+'='));
 const replacement=await listen(mockApp(store),t);
 const response=await fetch(replacement+'/check',{headers:{Cookie:cookie}});
 assert.equal((await response.json()).authenticated,true);
 assert.ok(response.headers.get('set-cookie'), 'Rolling expiry must renew the cookie');
});

test('absolute expiry revokes authentication rather than silently extending forever', async t => {
 let now=Date.now();
 const origin=await listen(mockApp(new session.MemoryStore(),false,()=>now),t);
 const login=await fetch(origin+'/login',{method:'POST'}),cookie=login.headers.get('set-cookie').split(';')[0];
 now+=31*86400000;
 const response=await fetch(origin+'/check',{headers:{Cookie:cookie}});
 assert.equal(response.status,401);assert.equal((await response.json()).code,'SESSION_EXPIRED');
});

test('HTTPS behind a trusted hosting proxy issues a secure persistent cookie',async t=>{
 const origin=await listen(mockApp(new session.MemoryStore(),true),t);
 const response=await fetch(origin+'/login',{method:'POST',headers:{'X-Forwarded-Proto':'https'}});
 const cookie=response.headers.get('set-cookie');
 assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Lax/);assert.match(cookie,/Expires=/);
});

test('temporary proxy and database errors never trigger a logout',async()=>{
 let calls=0,logouts=0;
 const client=createClient({fetchImpl:async()=>{calls++;return new Response(JSON.stringify({message:'Database reconnecting'}),{status:503,headers:{'content-type':'application/json'}});},sleep:async()=>{},onUnauthorized:()=>logouts++});
 await assert.rejects(client.checkAuth(),/Database reconnecting/);
 assert.equal(calls,3);assert.equal(logouts,0);
});

test('invalid successful auth payload does not mean logged out; explicit false does',async()=>{
 let logouts=0,payload={error:'Unexpected result'};
 const client=createClient({fetchImpl:async()=>Response.json(payload),onUnauthorized:()=>logouts++});
 await assert.rejects(client.checkAuth(),/Invalid authentication/);assert.equal(logouts,0);
 payload={authenticated:false};assert.equal(await client.checkAuth(),false);assert.equal(logouts,1);
});

test('writes are never retried after an ambiguous network failure',async()=>{
 let calls=0;
 const client=createClient({fetchImpl:async()=>{calls++;throw new TypeError('Network failure');},sleep:async()=>{}});
 await assert.rejects(client.request('/api/sales',{method:'POST',attempts:4}),/not automatically retried/);
 assert.equal(calls,1);
});

test('readiness waits once for concurrent callers and recovers after a cold start',async()=>{
 let calls=0,clock=0;
 const client=createClient({now:()=>clock,sleep:async ms=>{clock+=ms;},fetchImpl:async()=>{calls++;return Response.json({service:'eeerp',ready:calls>=2});}});
 const [a,b]=await Promise.all([client.ready(),client.ready()]);
 assert.equal(a.ready,true);assert.equal(b.ready,true);assert.equal(calls,2);
});

test('readiness gives up with an actionable message instead of waiting forever',async()=>{
 let clock=0;
 const client=createClient({now:()=>clock,sleep:async ms=>{clock+=ms;},fetchImpl:async()=>Response.json({service:'eeerp',ready:false})});
 await assert.rejects(client.ready(),/unavailable/);assert.ok(clock<=92000);
});
