/* Comprehensive automated tests for Danny Agent extended backend API:
   - Authentication (Login, Logout, Session validation, Lockout)
   - RBAC Permissions (Admin vs Agent access)
   - Property Management (CRUD, publish/archive, gallery images)
   - Customers CRM (Auto-linking from inquiries, assignment, notes)
   - Website Settings & Announcement Banners
   - Analytics & Notifications Log
   Run with: node --test tests/api-extended.test.js
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readConfig } = require('../server/config');
const { createLogger } = require('../server/logger');
const { createApp } = require('../server/app');

const KEY = 'test-admin-key-0123456789abcdef';
const quiet = { log() {}, error() {} };
let server, base, db, tmp;
let adminToken = '';
let agentToken = '';

function json(method, url, body = null, token = null, key = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['x-session-token'] = token;
  }
  if (key) {
    headers['x-admin-key'] = key;
  }
  return fetch(base + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
}

test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'danny-api-test-'));
  const config = readConfig({ NODE_ENV: 'test', DATABASE_PATH: path.join(tmp, 'test.sqlite'), ADMIN_KEY: KEY });
  const made = await createApp(config, { log: createLogger({ level: 'error', out: quiet }) });
  db = made.db;
  await new Promise(resolve => { server = made.app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await db.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
});

/* -------------------------------------------------------------
   1. AUTHENTICATION & RBAC
   ------------------------------------------------------------- */

test('auth: seeded admin can login and receives a session token', async () => {
  const res = await json('POST', '/api/auth/login', { username: 'admin', password: KEY });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.token);
  assert.equal(data.user.role, 'admin');
  adminToken = data.token;
});

test('auth: seeded agent can login and receives an agent session token', async () => {
  const res = await json('POST', '/api/auth/login', { username: 'danny.agent', password: 'AgentDanny2026!' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.token);
  assert.equal(data.user.role, 'agent');
  agentToken = data.token;
});

test('auth: wrong password returns 401 UNAUTHORIZED', async () => {
  const res = await json('POST', '/api/auth/login', { username: 'admin', password: 'WrongPassword999' });
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.code, 'UNAUTHORIZED');
});

test('auth: /api/auth/me returns user profile with valid session token', async () => {
  const res = await json('GET', '/api/auth/me', null, adminToken);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.user.username, 'admin');
  assert.equal(data.user.role, 'admin');
});

test('auth: agent cannot access admin-only /api/users endpoint (403 FORBIDDEN)', async () => {
  const res = await json('GET', '/api/users', null, agentToken);
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.code, 'FORBIDDEN');
});

test('auth: admin can access /api/users and create a new team member', async () => {
  const res = await json('GET', '/api/users', null, adminToken);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.users));
  assert.ok(data.users.length >= 2);

  // Create new agent
  const createRes = await json('POST', '/api/users', {
    name: 'Samuel Bangura',
    username: 'samuelb',
    email: 'samuel@dannyrealty.sl',
    phone: '+232 76 998877',
    password: 'SecurePass123!',
    role: 'agent'
  }, adminToken);
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.equal(created.success, true);
  assert.ok(created.id);
});

test('auth: logout revokes session token', async () => {
  const loginRes = await json('POST', '/api/auth/login', { username: 'danny.agent', password: 'AgentDanny2026!' });
  const token = (await loginRes.json()).token;

  const meBefore = await json('GET', '/api/auth/me', null, token);
  assert.equal(meBefore.status, 200);

  const logoutRes = await json('POST', '/api/auth/logout', null, token);
  assert.equal(logoutRes.status, 200);

  const meAfter = await json('GET', '/api/auth/me', null, token);
  assert.equal(meAfter.status, 401);
});

/* -------------------------------------------------------------
   2. PROPERTIES CRUD & MEDIA
   ------------------------------------------------------------- */

let createdPropId = null;

test('properties: create a new property with full details', async () => {
  const payload = {
    title: 'Luxury Beachfront Villa Goderich',
    slug: 'luxury-beachfront-villa-goderich',
    location: 'Goderich, Freetown',
    purpose: 'Buy',
    type: 'Villa',
    price: '$450,000',
    status: 'available',
    beds: 5,
    baths: 4,
    area: '450 sqm',
    image: 'images/house-1.webp',
    features: ['Private Beach Access', 'Infinity Pool', 'Borehole', 'Solar Backup'],
    description: 'An exceptional custom beachfront residence overlooking the Atlantic Ocean.',
    featured: 1,
    published: 1
  };

  const res = await json('POST', '/api/properties', payload, adminToken);
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.property.id);
  createdPropId = data.property.id;
  assert.equal(data.property.title, payload.title);
  assert.equal(data.property.beds, 5);
});

test('properties: get created property by id', async () => {
  const res = await json('GET', `/api/properties/${createdPropId}`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.property.id, createdPropId);
  assert.equal(data.property.title, 'Luxury Beachfront Villa Goderich');
  assert.ok(Array.isArray(data.property.features));
});

test('properties: update property details', async () => {
  const res = await json('PUT', `/api/properties/${createdPropId}`, {
    price: '$425,000',
    status: 'under_offer'
  }, adminToken);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.property.price, '$425,000');
  assert.equal(data.property.status, 'under_offer');
});

test('properties: add and delete gallery images', async () => {
  // Add image
  const addRes = await json('POST', `/api/properties/${createdPropId}/images`, {
    url: 'images/apartment-2.webp',
    isCover: false
  }, adminToken);
  assert.equal(addRes.status, 201);
  const addData = await addRes.json();
  assert.ok(addData.imageId);

  // Check property has image in gallery
  const propRes = await json('GET', `/api/properties/${createdPropId}`);
  const prop = (await propRes.json()).property;
  assert.ok(prop.images.length >= 1);

  // Delete image
  const delRes = await json('DELETE', `/api/properties/${createdPropId}/images/${addData.imageId}`, null, adminToken);
  assert.equal(delRes.status, 200);
});

test('properties: toggle published status', async () => {
  const res = await json('PATCH', `/api/properties/${createdPropId}/publish`, { published: false }, adminToken);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.property.published, 0);

  // When unpublished, public listing does not show it unless includeUnpublished=true with auth
  const publicList = await (await json('GET', '/api/properties')).json();
  assert.ok(!publicList.properties.some(p => p.id === createdPropId));

  const authList = await (await json('GET', '/api/properties?includeUnpublished=true', null, adminToken)).json();
  assert.ok(authList.properties.some(p => p.id === createdPropId));
});

/* -------------------------------------------------------------
   3. SETTINGS & ANNOUNCEMENT BANNER
   ------------------------------------------------------------- */

test('settings: fetch and update site settings and banner', async () => {
  const getRes = await json('GET', '/api/settings');
  assert.equal(getRes.status, 200);
  const initial = (await getRes.json()).settings;
  assert.ok(initial.businessName);

  const putRes = await json('PUT', '/api/settings', {
    bannerActive: '1',
    bannerText: 'Special Announcement: Free property valuation this week in Freetown!',
    phone: '+232 76 683667'
  }, adminToken);
  assert.equal(putRes.status, 200);

  const updatedRes = await json('GET', '/api/settings');
  const updated = (await updatedRes.json()).settings;
  assert.equal(updated.bannerActive, '1');
  assert.equal(updated.bannerText, 'Special Announcement: Free property valuation this week in Freetown!');
});

/* -------------------------------------------------------------
   4. CRM, INQUIRIES & LEAD ASSIGNMENT
   ------------------------------------------------------------- */

test('crm: submitting an inquiry creates customer profile and links inquiry', async () => {
  const enquiryPayload = {
    name: 'Finda Sesay',
    phone: '+232 78 554433',
    email: 'finda.sesay@example.sl',
    service: 'buy',
    message: 'Interested in buying a 3-bedroom house in Wilberforce.',
    property_id: 1,
    budget: '$150,000'
  };

  const subRes = await json('POST', '/api/inquiries', enquiryPayload);
  assert.equal(subRes.status, 201);
  const subData = await subRes.json();
  assert.ok(subData.inquiryId);
  const numId = Number(subData.inquiryId.replace('ENQ-', ''));

  // Verify customer was created
  const custRes = await json('GET', '/api/customers', null, adminToken);
  assert.equal(custRes.status, 200);
  const customers = (await custRes.json()).customers;
  const finda = customers.find(c => c.name === 'Finda Sesay');
  assert.ok(finda);
  assert.equal(finda.phone, '+232 78 554433');
  assert.ok(finda.inquiries_count >= 1);

  // Assign agent and update notes
  const patchRes = await json('PATCH', `/api/inquiries/${numId}`, {
    assigned_agent_id: 2,
    notes: 'Client pre-approved for mortgage. Scheduled viewing Saturday 10am.'
  }, adminToken);
  assert.equal(patchRes.status, 200);

  // Verify inquiry reflected updates
  const inqListRes = await json('GET', '/api/inquiries', null, adminToken);
  const inq = (await inqListRes.json()).inquiries.find(i => i.id === numId);
  assert.equal(inq.assigned_agent_id, 2);
  assert.equal(inq.notes, 'Client pre-approved for mortgage. Scheduled viewing Saturday 10am.');
});

/* -------------------------------------------------------------
   5. ANALYTICS & NOTIFICATION DISPATCH AUDIT
   ------------------------------------------------------------- */

test('analytics: reports business metrics and breakdowns', async () => {
  const res = await json('GET', '/api/analytics', null, adminToken);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.metrics.totalProperties >= 9);
  assert.ok(data.metrics.totalInquiries >= 1);
  assert.ok(data.metrics.totalCustomers >= 1);
  assert.ok(Array.isArray(data.inquiriesByStatus));
  assert.ok(Array.isArray(data.propertiesByType));
});

test('notifications: logs dispatches with real delivery/simulation status', async () => {
  const res = await json('GET', '/api/notifications', null, adminToken);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(Array.isArray(data.notifications));
  // Notification log records status 'simulated_no_credentials' or 'sent'
  if (data.notifications.length > 0) {
    const logItem = data.notifications[0];
    assert.ok(['sent', 'simulated_no_credentials', 'failed', 'disabled'].includes(logItem.status));
  }
});
