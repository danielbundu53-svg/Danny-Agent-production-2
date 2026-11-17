/* Server tests. Run with:  npm test
   Starts a private copy of the site on a spare port with a throw-away database,
   so the real data/ folder is never touched. */

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

function validInquiry(extra = {}) {
  return {
    name: 'Mariama Kamara', phone: '+232 76 123456', email: 'mariama@example.com',
    service: 'buy', message: 'I want to see the house in Lumley this week.', ...extra
  };
}

function post(url, body, headers = {}, root = base) {
  return fetch(root + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

/* A second, separate copy of the site, for tests that use up limits */
async function startExtra(name) {
  const config = readConfig({ NODE_ENV: 'test', DATABASE_PATH: path.join(tmp, name + '.sqlite'), ADMIN_KEY: KEY });
  const made = await createApp(config, { log: createLogger({ level: 'error', out: quiet }) });
  const extra = await new Promise(resolve => { const s = made.app.listen(0, () => resolve(s)); });
  return {
    url: `http://127.0.0.1:${extra.address().port}`,
    async stop() {
      await new Promise(resolve => extra.close(resolve));
      await made.db.close();
    }
  };
}

test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-'));
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
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('health check reports online and checks the database', async () => {
  const res = await fetch(base + '/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true, status: 'online' });
});

test('every response carries security headers', async () => {
  const res = await fetch(base + '/');
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.ok(res.headers.get('referrer-policy'));
  assert.ok(res.headers.get('permissions-policy'));
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.ok(res.headers.get('x-request-id'));
});

test('pages load, with or without .html, and get versioned asset links', async () => {
  for (const url of ['/', '/index.html', '/properties', '/properties.html', '/about', '/contact', '/favorites', '/property-detail?id=1']) {
    const res = await fetch(base + url);
    assert.equal(res.status, 200, url);
    const html = await res.text();
    assert.match(html, /css\/site\.css\?v=[0-9a-f]{10}/, url);
    assert.doesNotMatch(html, /%%[A-Z_]+%%/, `${url} still has a placeholder`);
  }
});

test('"JavaScript off" fallback lists properties and contact links', async () => {
  const html = await (await fetch(base + '/properties')).text();
  assert.match(html, /<noscript><h3[^>]*>Apartments for Rent<\/h3><ul[^>]*><li><a[^>]*property-detail\.html\?id=2/);
  assert.match(html, /Houses for Sale[\s\S]*Commercial Offices for Rent[\s\S]*Land for Sale/);
  assert.match(html, /property-detail\.html\?id=1/);
  assert.match(html, /href="tel:\+/);
});

test('property page: real property gets previews and text, unknown id gets 404', async () => {
  const ok = await fetch(base + '/property-detail.html?id=3');
  assert.equal(ok.status, 200);
  const html = await ok.text();
  assert.match(html, /property="og:title"/);
  assert.match(html, /property="og:image" content="http[^"]*images\/w\/1200\//);
  assert.match(html, /<noscript>\s*<div class="max-w-3xl/);

  for (const id of ['99999', 'abc', '']) {
    const res = await fetch(base + '/property-detail.html?id=' + id);
    assert.equal(res.status, 404, id);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  }
});

test('long-lived caching only for versioned files; pages always revalidate', async () => {
  const versioned = await fetch(base + '/css/site.css?v=abc');
  assert.match(versioned.headers.get('cache-control'), /immutable/);
  const plain = await fetch(base + '/css/site.css');
  assert.doesNotMatch(plain.headers.get('cache-control'), /immutable/);
  const page = await fetch(base + '/');
  assert.equal(page.headers.get('cache-control'), 'no-cache');
  const admin = await fetch(base + '/admin');
  assert.equal(admin.headers.get('cache-control'), 'no-store');
  assert.match(admin.headers.get('x-robots-tag'), /noindex/);
});

test('private files are never served', async () => {
  for (const url of ['/.env', '/server/app.js', '/data/danny-angel.sqlite', '/package.json', '/%2e%2e/package.json', '/404.html', '/500', '/500.html', '/index.html.bak', '/css/..%2f..%2fpackage.json']) {
    const res = await fetch(base + url);
    assert.equal(res.status, 404, url);
    const text = await res.text();
    assert.doesNotMatch(text, /ADMIN_KEY|require\(/, url);
  }
});

test('unknown address gives the friendly 404 page, unknown API route gives JSON', async () => {
  const page = await fetch(base + '/no-such-page');
  assert.equal(page.status, 404);
  assert.match(await page.text(), /We could not find that page/);

  const api = await fetch(base + '/api/nothing');
  assert.equal(api.status, 404);
  const body = await api.json();
  assert.equal(body.success, false);
  assert.equal(body.code, 'NOT_FOUND');
  assert.ok(body.requestId);
});

test('robots.txt and sitemap.xml', async () => {
  const robots = await (await fetch(base + '/robots.txt')).text();
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Sitemap: http/);
  const sitemap = await (await fetch(base + '/sitemap.xml')).text();
  assert.match(sitemap, /<urlset/);
  assert.match(sitemap, /property-detail\.html\?id=1/);
  assert.doesNotMatch(sitemap, /admin/);
});

test('photos: allowed sizes are resized and smaller, others are refused', async () => {
  const small = await fetch(base + '/images/w/480/property-1.jpg');
  assert.equal(small.status, 200);
  assert.equal(small.headers.get('content-type'), 'image/jpeg');
  const original = fs.statSync(path.join(__dirname, '..', 'public', 'images', 'property-1.jpg')).size;
  assert.ok((await small.arrayBuffer()).byteLength < original / 2);

  assert.equal((await fetch(base + '/images/w/999/property-1.jpg')).status, 404);
  assert.equal((await fetch(base + '/images/w/480/missing.jpg')).status, 404);
  assert.equal((await fetch(base + '/images/w/480/..%2f..%2fpackage.json')).status, 404);
});

test('enquiry: a valid one is saved and appears for the admin', async () => {
  const res = await post('/api/inquiries', validInquiry({ propertyId: '3' }));
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.match(body.inquiryId, /^ENQ-\d+$/);

  const list = await fetch(base + '/api/inquiries', { headers: { 'x-admin-key': KEY } });
  assert.equal(list.status, 200);
  const data = await list.json();
  assert.equal(data.truncated, false);
  const row = data.inquiries.find(r => `ENQ-${r.id}` === body.inquiryId);
  assert.equal(row.name, 'Mariama Kamara');
  assert.equal(row.property_id, 3);
  assert.equal(row.status, 'new');
});

test('enquiry: bad input is refused with the list of wrong fields', async () => {
  const extra = await startExtra('validation');
  try {
    const cases = [
      [{ name: 'A' }, 'name'],
      [{ phone: 'abc' }, 'phone'],
      [{ phone: '123' }, 'phone'],
      [{ email: 'no-at-sign' }, 'email'],
      [{ email: 'a@b.c' }, 'email'],
      [{ service: 'steal' }, 'service'],
      [{ message: 'short' }, 'message'],
      [{ name: { $ne: 1 } }, 'name']
    ];
    // Invalid requests count toward the limit (5 per 10 min), so spread them over fresh copies
    let remaining = 0;
    let current = extra;
    const opened = [];
    for (const [change, field] of cases) {
      if (remaining === 0) {
        current = await startExtra('validation' + opened.length);
        opened.push(current);
        remaining = 5;
      }
      remaining--;
      const res = await post('/api/inquiries', validInquiry(change), {}, current.url);
      const body = await res.json();
      assert.equal(res.status, 400, JSON.stringify(change));
      assert.equal(body.code, 'VALIDATION');
      assert.ok(body.fields.includes(field), `${field} missing from ${body.fields}`);
    }
    for (const item of opened) await item.stop();
  } finally {
    await extra.stop();
  }
});

test('enquiry: hidden "website" field (bots) pretends to work but saves nothing', async () => {
  const before = (await db.get('SELECT COUNT(*) AS n FROM inquiries')).n;
  const res = await post('/api/inquiries', validInquiry({ website: 'http://spam.example' }));
  assert.equal(res.status, 201);
  assert.equal((await res.json()).inquiryId, 'ENQ-0');
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM inquiries')).n, before);
});

test('enquiry: sending the same message twice does not create two rows', async () => {
  const input = validInquiry({ phone: '+232 77 000111', message: 'Unique duplicate-check message for the test.' });
  const first = await (await post('/api/inquiries', input)).json();
  const second = await (await post('/api/inquiries', input)).json();
  assert.equal(first.inquiryId, second.inquiryId);
});

test('API refuses wrong content type, broken JSON, foreign origins and oversized bodies', async () => {
  const extra = await startExtra('refusals');
  try {
    const wrongType = await fetch(extra.url + '/api/inquiries', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hello' });
    assert.equal(wrongType.status, 415);
    assert.equal((await wrongType.json()).code, 'JSON_REQUIRED');

    const broken = await post('/api/inquiries', '{"name": ', {}, extra.url);
    assert.equal(broken.status, 400);
    assert.equal((await broken.json()).code, 'INVALID_JSON');

    const foreign = await post('/api/inquiries', validInquiry(), { Origin: 'https://evil.example' }, extra.url);
    assert.equal(foreign.status, 403);
    assert.equal((await foreign.json()).code, 'FORBIDDEN_ORIGIN');

    const huge = await post('/api/inquiries', validInquiry({ message: 'x'.repeat(60000) }), {}, extra.url);
    assert.equal(huge.status, 413);
    assert.equal((await huge.json()).code, 'TOO_LARGE');
  } finally {
    await extra.stop();
  }
});

test('API: right path with wrong method gives 405', async () => {
  const res = await fetch(base + '/api/inquiries', { method: 'DELETE', headers: { 'x-admin-key': KEY } });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, POST');
});

test('admin: no key and wrong key are refused', async () => {
  const extra = await startExtra('adminwrong');
  try {
    const none = await fetch(extra.url + '/api/inquiries');
    assert.equal(none.status, 401);
    assert.equal((await none.json()).code, 'UNAUTHORIZED');
    const wrong = await fetch(extra.url + '/api/inquiries', { headers: { 'x-admin-key': 'nope' } });
    assert.equal(wrong.status, 401);
  } finally {
    await extra.stop();
  }
});

test('admin: lock-out stops even the right key after 8 wrong ones', async () => {
  const extra = await startExtra('lock');
  try {
    for (let i = 0; i < 8; i++) {
      const res = await fetch(extra.url + '/api/inquiries', { headers: { 'x-admin-key': 'wrong-' + i } });
      assert.equal(res.status, 401);
    }
    const locked = await fetch(extra.url + '/api/inquiries', { headers: { 'x-admin-key': KEY } });
    assert.equal(locked.status, 429);
    assert.equal((await locked.json()).code, 'ADMIN_LOCKED');
  } finally {
    await extra.stop();
  }
});

test('admin: change status, and refuse invalid status or unknown enquiry', async () => {
  const created = await (await post('/api/inquiries', validInquiry({ phone: '+232 78 555000', message: 'Status change test enquiry message.' }))).json();
  const id = created.inquiryId.replace('ENQ-', '');
  const patch = (target, status) => fetch(`${base}/api/inquiries/${target}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-admin-key': KEY }, body: JSON.stringify({ status })
  });

  assert.equal((await patch(id, 'contacted')).status, 200);
  assert.equal((await db.get('SELECT status FROM inquiries WHERE id = ?', [id])).status, 'contacted');
  assert.equal((await patch(id, 'banana')).status, 400);
  assert.equal((await patch('999999', 'closed')).status, 404);
  assert.equal((await patch('abc', 'closed')).status, 400);
});

test('database refuses an invalid status even if the app code is bypassed', async () => {
  const row = await db.get('SELECT id FROM inquiries LIMIT 1');
  await assert.rejects(db.run("UPDATE inquiries SET status = 'weird' WHERE id = ?", [row.id]), /invalid status/);
});

test('enquiry limiter: the sixth quick enquiry from one address is refused politely', async () => {
  const extra = await startExtra('rate');
  try {
    let last;
    for (let i = 0; i < 6; i++) {
      last = await post('/api/inquiries', validInquiry({ phone: `+232 79 00000${i}`, message: `Rate limit test message number ${i}.` }), {}, extra.url);
      if (i < 5) assert.equal(last.status, 201, 'enquiry ' + i);
    }
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get('retry-after')) > 0);
    assert.equal((await last.json()).code, 'TOO_MANY_ENQUIRIES');
  } finally {
    await extra.stop();
  }
});
