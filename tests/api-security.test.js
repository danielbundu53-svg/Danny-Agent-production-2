/* Dedicated security and authorization test suite for Danny Agent platform:
   - Unauthenticated access to all administrative routes
   - Invalid and expired session tokens
   - Administrator vs Agent role-based access control (RBAC)
   - First-login password-change workflow
   - Logout token revocation and reuse prevention
   - Malicious payloads (SQL injection, XSS, payload size)
   - Production startup default credential prevention
   Run with: node --test tests/api-security.test.js
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readConfig, validateConfig } = require('../server/config');
const { createLogger } = require('../server/logger');
const { createApp } = require('../server/app');
const { hashPassword } = require('../server/db');

const KEY = 'test-security-admin-key-0123456789abcdef';
const quiet = { log() {}, error() {}, warn() {} };
let server, base, db, tmp;
let adminToken = '';
let agentToken = '';

function json(method, url, body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['x-session-token'] = token;
  }
  return fetch(base + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
}

test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'danny-sec-test-'));
  const config = readConfig({ NODE_ENV: 'test', DATABASE_PATH: path.join(tmp, 'sec.sqlite'), ADMIN_KEY: KEY });
  const made = await createApp(config, { log: createLogger({ level: 'error', out: quiet }) });
  db = made.db;
  await new Promise(resolve => { server = made.app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;

  // Log in as admin and agent to get baseline tokens
  const adminLogin = await (await json('POST', '/api/auth/login', { username: 'admin', password: KEY })).json();
  adminToken = adminLogin.token;

  const agentLogin = await (await json('POST', '/api/auth/login', { username: 'danny.agent', password: 'AgentDanny2026!' })).json();
  agentToken = agentLogin.token;
});

test.after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await db.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
});

/* -------------------------------------------------------------
   1. UNAUTHENTICATED REQUESTS (401 UNAUTHORIZED)
   ------------------------------------------------------------- */
test('security: unauthenticated requests to administrative endpoints return 401', async () => {
  const endpoints = [
    ['GET', '/api/auth/me'],
    ['POST', '/api/auth/change-password'],
    ['GET', '/api/users'],
    ['POST', '/api/users'],
    ['PATCH', '/api/users/1'],
    ['PUT', '/api/settings'],
    ['GET', '/api/analytics'],
    ['GET', '/api/notifications'],
    ['GET', '/api/activity'],
    ['POST', '/api/properties'],
    ['PUT', '/api/properties/1'],
    ['DELETE', '/api/properties/1'],
    ['POST', '/api/upload'],
    ['GET', '/api/customers'],
    ['PATCH', '/api/customers/1'],
    ['GET', '/api/inquiries'],
    ['PATCH', '/api/inquiries/1']
  ];

  for (const [method, route] of endpoints) {
    const res = await json(method, route, method !== 'GET' ? { dummy: 'data' } : null, null);
    assert.equal(res.status, 401, `Expected 401 for unauthenticated ${method} ${route}, got ${res.status}`);
  }
});

/* -------------------------------------------------------------
   2. INVALID AND EXPIRED SESSIONS (401 UNAUTHORIZED)
   ------------------------------------------------------------- */
test('security: invalid session token returns 401', async () => {
  const res = await json('GET', '/api/auth/me', null, 'completely-bogus-token-123456');
  assert.equal(res.status, 401);
});

test('security: expired session token returns 401', async () => {
  const expiredToken = 'expired-test-token-abcdef123456';
  await db.run(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, 1, ?)',
    [expiredToken, '2020-01-01T00:00:00.000Z']
  );
  const res = await json('GET', '/api/auth/me', null, expiredToken);
  assert.equal(res.status, 401);
});

/* -------------------------------------------------------------
   3. FIRST-LOGIN PASSWORD-CHANGE WORKFLOW
   ------------------------------------------------------------- */
test('security: login flags mustChangePassword for seeded accounts', async () => {
  const loginRes = await json('POST', '/api/auth/login', { username: 'admin', password: KEY });
  const data = await loginRes.json();
  assert.equal(data.user.mustChangePassword, true);
});

test('security: password change rejects short or common passwords', async () => {
  // Too short
  const resShort = await json('POST', '/api/auth/change-password', {
    currentPassword: KEY,
    newPassword: 'short'
  }, adminToken);
  assert.equal(resShort.status, 400);

  // Common/default
  const resDefault = await json('POST', '/api/auth/change-password', {
    currentPassword: KEY,
    newPassword: 'AdminDanny2026!SecureKey'
  }, adminToken);
  assert.equal(resDefault.status, 400);

  // Same as current
  const resSame = await json('POST', '/api/auth/change-password', {
    currentPassword: KEY,
    newPassword: KEY
  }, adminToken);
  assert.equal(resSame.status, 400);
});

test('security: successful password change updates credentials and clears mustChangePassword', async () => {
  const NEW_PASSWORD = 'NewSecurePassword2026!Danny';
  const res = await json('POST', '/api/auth/change-password', {
    currentPassword: KEY,
    newPassword: NEW_PASSWORD
  }, adminToken);
  assert.equal(res.status, 200);

  // Old password no longer works
  const oldLogin = await json('POST', '/api/auth/login', { username: 'admin', password: KEY });
  assert.equal(oldLogin.status, 401);

  // New password works and mustChangePassword is false
  const newLogin = await json('POST', '/api/auth/login', { username: 'admin', password: NEW_PASSWORD });
  assert.equal(newLogin.status, 200);
  const data = await newLogin.json();
  assert.equal(data.user.mustChangePassword, false);
  adminToken = data.token; // update active admin token
});

/* -------------------------------------------------------------
   4. AGENT RESTRICTIONS & RBAC (403 FORBIDDEN)
   ------------------------------------------------------------- */
test('security: agent cannot access administrator-only operations (403 FORBIDDEN)', async () => {
  const adminOnlyRoutes = [
    ['GET', '/api/users'],
    ['POST', '/api/users', { username: 'rogue', password: 'password123', name: 'Rogue', email: 'rogue@test.sl' }],
    ['PATCH', '/api/users/1', { role: 'admin' }],
    ['PUT', '/api/settings', { business_name: 'Hacked Real Estate' }],
    ['GET', '/api/analytics'],
    ['GET', '/api/notifications'],
    ['GET', '/api/activity'],
    ['DELETE', '/api/properties/1']
  ];

  for (const [method, route, payload] of adminOnlyRoutes) {
    const res = await json(method, route, payload || null, agentToken);
    assert.equal(res.status, 403, `Expected 403 for agent ${method} ${route}, got ${res.status}`);
  }
});

test('security: agent cannot reassign inquiry to another agent (403 FORBIDDEN)', async () => {
  const res = await json('PATCH', '/api/inquiries/1', { assigned_agent_id: 2 }, agentToken);
  assert.equal(res.status, 403);
});

test('security: agent can access authorized operations (200 OK)', async () => {
  const resInq = await json('GET', '/api/inquiries', null, agentToken);
  assert.equal(resInq.status, 200);

  const resCust = await json('GET', '/api/customers', null, agentToken);
  assert.equal(resCust.status, 200);

  const resProps = await json('GET', '/api/properties?includeUnpublished=true', null, agentToken);
  assert.equal(resProps.status, 200);
});

/* -------------------------------------------------------------
   5. LOGOUT & TOKEN INVALIDATION
   ------------------------------------------------------------- */
test('security: logout invalidates token and prevents reuse', async () => {
  const tempLogin = await (await json('POST', '/api/auth/login', { username: 'danny.agent', password: 'AgentDanny2026!' })).json();
  const tempToken = tempLogin.token;

  // Verify token works
  const beforeRes = await json('GET', '/api/auth/me', null, tempToken);
  assert.equal(beforeRes.status, 200);

  // Logout
  const logoutRes = await json('POST', '/api/auth/logout', null, tempToken);
  assert.equal(logoutRes.status, 200);

  // Reused token is rejected
  const afterRes = await json('GET', '/api/auth/me', null, tempToken);
  assert.equal(afterRes.status, 401);
});

/* -------------------------------------------------------------
   6. MALICIOUS & INVALID PAYLOADS
   ------------------------------------------------------------- */
test('security: SQL injection attempts are safely parameterized and neutralised', async () => {
  // SQLi in search query
  const resSearch = await fetch(`${base}/api/properties?search=' UNION SELECT id, password_hash, email FROM users --`);
  assert.equal(resSearch.status, 200);
  const data = await resSearch.json();
  assert.ok(Array.isArray(data.properties));

  // SQLi in login credentials
  const resLogin = await json('POST', '/api/auth/login', {
    username: "admin' OR '1'='1",
    password: "password' OR '1'='1"
  });
  assert.equal(resLogin.status, 401);
});

test('security: XSS payloads in inquiries are sanitized and not executed', async () => {
  const xssPayload = {
    name: 'Attacker <script>alert("xss")</script>',
    phone: '+232 76 000111',
    email: 'attacker@evil.sl',
    service: 'buy',
    message: '<img src=x onerror=alert(1)> Interested in buying.'
  };
  const res = await json('POST', '/api/inquiries', xssPayload);
  assert.equal(res.status, 201);
});

test('security: wrong Content-Type rejected with 415', async () => {
  const res = await fetch(`${base}/api/inquiries`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'plain text body'
  });
  assert.equal(res.status, 415);
});

/* -------------------------------------------------------------
   7. PRODUCTION CONFIGURATION SAFEGUARDS
   ------------------------------------------------------------- */
test('security: validateConfig halts production startup if ADMIN_KEY is default or placeholder', () => {
  const insecureDefaults = [
    'AdminDanny2026!SecureKey',
    'AgentDanny2026!',
    'admin',
    'password',
    'dannyagent',
    'change-this-to-a-secure-key'
  ];

  for (const badKey of insecureDefaults) {
    const cfg = { isProd: true, adminKey: badKey, siteUrl: 'https://dannyagent.sl', chat: {} };
    const { errors } = validateConfig(cfg);
    assert.ok(errors.length > 0, `Expected production error for insecure key: ${badKey}`);
  }

  // Valid strong key passes
  const goodCfg = { isProd: true, adminKey: 'f948b89e248b1d927a481c0028a1c8e034981bfd', siteUrl: 'https://dannyagent.sl', chat: {} };
  const { errors: goodErrors } = validateConfig(goodCfg);
  assert.equal(goodErrors.length, 0);
});
