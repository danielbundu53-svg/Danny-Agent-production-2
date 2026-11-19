/* Builds the Express app: security, API, pages, photos, errors.
   Kept separate from server.js so the tests can start a copy on a spare port. */

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const compression = require('compression');

const { openDatabase, STATUSES } = require('./db');
const { createInquiryService, clean } = require('./inquiries');
const { fail } = require('./http-errors');
const { securityHeaders, forceHttps, rateLimit, apiGuards } = require('./security');
const { createAuthService } = require('./auth');
const { createPropertyService } = require('./properties');
const { createNotificationService } = require('./notifications');
const { createPages } = require('./pages');
const { createImageRoute } = require('./images');
const { createChat } = require('./chat');

const ADMIN_LIST_LIMIT = 2000;

async function createApp(config, { log, fetchImpl }) {
  const db = await openDatabase(config.dbPath, { adminKey: config.adminKey, rootDir: config.rootDir });
  const notifications = createNotificationService({ db, config, log });
  const auth = createAuthService({ db, config, log });
  const propertiesService = createPropertyService({ db, publicDir: config.publicDir, log });
  const pages = createPages({ publicDir: config.publicDir, config, log, db });
  const inquiries = createInquiryService({ db, log, notifications });
  const chat = createChat({ config, pages, inquiries, log, fetchImpl });
  const requireAdmin = auth.requireAuth;
  const app = express();

  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.set('etag', 'strong');

  /* ---------- Request id and one log line per request ---------- */
  app.use((req, res, next) => {
    req.id = crypto.randomBytes(4).toString('hex');
    res.set('X-Request-Id', req.id);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
      const isAsset = /^\/(css|js|images)\//.test(req.path);
      const isHealth = req.path === '/api/health';
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : (isAsset || isHealth ? 'debug' : 'info');
      log[level]('request', { id: req.id, method: req.method, path: req.path, status: res.statusCode, ms });
    });
    next();
  });

  app.use(forceHttps({ enabled: config.forceHttps }));
  app.use(securityHeaders({ isProd: config.isProd }));
  app.use(compression());

  /* ---------- Health check (hosting services poll this) ---------- */
  app.get('/api/health', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await db.get('SELECT 1 AS ok');
      res.json({ success: true, status: 'online' });
    } catch (err) {
      log.error('health check failed', { error: err.message });
      fail(res, 503, 'DATABASE_DOWN', 'The service is not ready.', { status: 'degraded' });
    }
  });

  /* ---------- API ---------- */
  const api = express.Router();
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use(rateLimit({
    windowMs: 60 * 1000, max: 120, code: 'RATE_LIMITED', log,
    message: 'Too many requests. Please wait a minute and try again.'
  }));
  api.use(apiGuards({ siteUrl: config.siteUrl }));
  api.use(express.json({ limit: '32kb', strict: true }));

  const inquiryLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, max: 5, code: 'TOO_MANY_ENQUIRIES', log,
    message: 'Too many enquiries from this connection. Please try again in a few minutes, or call us.'
  });

  api.post('/inquiries', inquiryLimiter, async (req, res, next) => {
    try {
      const out = await inquiries.submit(req.body);
      if (out.result === 'spam') {
        /* Pretend it worked so the bot moves on, but save nothing */
        return res.status(201).json({ success: true, inquiryId: 'ENQ-0', message: 'Enquiry received successfully.' });
      }
      if (out.result === 'invalid') {
        return fail(res, 400, 'VALIDATION', 'Please check these fields: ' + out.fields.join(', ') + '.', { fields: out.fields });
      }
      if (out.result === 'busy') {
        return fail(res, 503, 'BUSY', 'We are receiving a very high number of messages right now. Please call or WhatsApp us instead.');
      }
      res.status(201).json({ success: true, inquiryId: `ENQ-${out.id}`, message: 'Enquiry received successfully.' });
    } catch (err) {
      next(err);
    }
  });

  /* ---------- Chat assistant ---------- */
  const chatLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, max: 30, code: 'TOO_MANY_MESSAGES', log,
    message: 'You are sending messages very quickly. Please wait a few minutes, or call us.'
  });
  api.get('/chat/status', chat.status);
  api.post('/chat', chatLimiter, chat.handler);
  api.all('/chat', (req, res) => { res.set('Allow', 'POST'); fail(res, 405, 'METHOD_NOT_ALLOWED', 'That method is not allowed here.'); });

  /* ---------- Auth ---------- */
  api.post('/auth/login', async (req, res, next) => {
    try {
      const { username, password } = req.body || {};
      const result = await auth.login(username, password, { ip: req.ip });
      if (!result.success) {
        if (result.retryAfter) res.set('Retry-After', String(result.retryAfter));
        return fail(res, result.code === 'ADMIN_LOCKED' ? 429 : 401, result.code, result.message, { retryAfterSeconds: result.retryAfter });
      }
      res.json(result);
    } catch (err) { next(err); }
  });

  api.post('/auth/logout', async (req, res, next) => {
    try {
      const token = req.get('x-session-token') || (req.get('authorization') || '').replace(/^Bearer\s+/, '');
      await auth.logout(token);
      res.json({ success: true, message: 'Logged out successfully.' });
    } catch (err) { next(err); }
  });

  api.get('/auth/me', auth.requireAuth, (req, res) => {
    res.json({ success: true, user: req.user });
  });

  api.post('/auth/change-password', auth.requireAuth, async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      if (!currentPassword || !newPassword) {
        return fail(res, 400, 'VALIDATION', 'Both current and new passwords are required.');
      }
      if (typeof newPassword !== 'string' || newPassword.length < 10) {
        return fail(res, 400, 'VALIDATION', 'New password must be at least 10 characters long.');
      }
      if (currentPassword === newPassword) {
        return fail(res, 400, 'VALIDATION', 'New password cannot be the same as your current password.');
      }
      const KNOWN_INSECURE_PASSWORDS = ['AdminDanny2026!SecureKey', 'AgentDanny2026!', 'admin', 'password', 'dannyagent', '12345678'];
      if (KNOWN_INSECURE_PASSWORDS.some(p => p.toLowerCase() === newPassword.toLowerCase())) {
        return fail(res, 400, 'VALIDATION', 'New password is too common or a default password. Please choose a stronger password.');
      }

      // Fetch user's current password hash from db
      const user = await db.get('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
      if (!user || !auth.verifyPassword(currentPassword, user.password_hash)) {
        return fail(res, 400, 'VALIDATION', 'Current password is not correct.');
      }

      const newHash = auth.hashPassword(newPassword);
      await db.run(
        'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [newHash, req.user.id]
      );
      await db.run(
        'INSERT INTO activity_logs (user_id, username, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)',
        [req.user.id, req.user.username, 'password_change', 'user', req.user.id, 'User updated their password']
      );
      res.json({ success: true, message: 'Password changed successfully.' });
    } catch (err) { next(err); }
  });

  /* ---------- Properties (Public & Protected) ---------- */
  api.get('/properties', async (req, res, next) => {
    try {
      const { purpose, type, location, minPrice, maxPrice, beds, status, search, limit, offset, includeUnpublished } = req.query;
      const isAdmin = req.get('x-admin-key') || req.get('x-session-token') || req.get('authorization');
      const list = await propertiesService.listProperties({
        purpose, type, location, minPrice, maxPrice, beds, status, search,
        includeUnpublished: includeUnpublished === 'true' && Boolean(isAdmin),
        limit: Number(limit) || 100,
        offset: Number(offset) || 0
      });
      res.json({ success: true, properties: list, count: list.length });
    } catch (err) { next(err); }
  });

  api.get('/properties/:id', async (req, res, next) => {
    try {
      const property = await propertiesService.getPropertyById(req.params.id);
      if (!property) return fail(res, 404, 'NOT_FOUND', 'Property not found.');
      res.json({ success: true, property });
    } catch (err) { next(err); }
  });

  api.post('/properties', auth.requireRole(['admin', 'agent']), async (req, res, next) => {
    try {
      const property = await propertiesService.createProperty(req.body, req.user.id);
      await pages.refreshFromDb();
      res.status(201).json({ success: true, property, message: 'Property created successfully.' });
    } catch (err) {
      if (err.message && (err.message.includes('must be') || err.message.includes('required'))) {
        return fail(res, 400, 'VALIDATION', err.message);
      }
      next(err);
    }
  });

  api.put('/properties/:id', auth.requireRole(['admin', 'agent']), async (req, res, next) => {
    try {
      const property = await propertiesService.updateProperty(req.params.id, req.body, req.user.id);
      if (!property) return fail(res, 404, 'NOT_FOUND', 'Property not found.');
      await pages.refreshFromDb();
      res.json({ success: true, property, message: 'Property updated successfully.' });
    } catch (err) { next(err); }
  });

  api.delete('/properties/:id', auth.requireRole('admin'), async (req, res, next) => {
    try {
      const ok = await propertiesService.deleteProperty(req.params.id, req.user.id, { hard: req.query.hard === 'true' });
      if (!ok) return fail(res, 404, 'NOT_FOUND', 'Property not found.');
      await pages.refreshFromDb();
      res.json({ success: true, message: 'Property removed or archived.' });
    } catch (err) { next(err); }
  });

  api.patch('/properties/:id/publish', auth.requireRole(['admin', 'agent']), async (req, res, next) => {
    try {
      const property = await propertiesService.updateProperty(req.params.id, { published: req.body.published ? 1 : 0 }, req.user.id);
      if (!property) return fail(res, 404, 'NOT_FOUND', 'Property not found.');
      await pages.refreshFromDb();
      res.json({ success: true, property, message: 'Publication status updated.' });
    } catch (err) { next(err); }
  });

  api.post('/properties/:id/images', auth.requireRole(['admin', 'agent']), async (req, res, next) => {
    try {
      const { url, isCover, sortOrder } = req.body || {};
      if (!url) return fail(res, 400, 'VALIDATION', 'Image URL is required.');
      const imageId = await propertiesService.addImage(Number(req.params.id), url, { isCover, sortOrder });
      await pages.refreshFromDb();
      res.status(201).json({ success: true, imageId, message: 'Image added.' });
    } catch (err) { next(err); }
  });

  api.delete('/properties/:id/images/:imageId', auth.requireRole(['admin', 'agent']), async (req, res, next) => {
    try {
      await propertiesService.deleteImage(Number(req.params.id), Number(req.params.imageId));
      await pages.refreshFromDb();
      res.json({ success: true, message: 'Image removed.' });
    } catch (err) { next(err); }
  });

  api.patch('/properties/:id/images/reorder', auth.requireRole(['admin', 'agent']), async (req, res, next) => {
    try {
      const { order } = req.body || {};
      if (!Array.isArray(order)) return fail(res, 400, 'VALIDATION', 'Order array required.');
      await propertiesService.reorderImages(Number(req.params.id), order);
      await pages.refreshFromDb();
      res.json({ success: true, message: 'Images reordered.' });
    } catch (err) { next(err); }
  });

  /* Image Upload Handler */
  const uploadRouter = express.Router();
  uploadRouter.use(express.json({ limit: '10mb' }));
  uploadRouter.post('/', auth.requireRole(['admin', 'agent']), async (req, res, next) => {
    try {
      const { image, filename = 'upload.jpg' } = req.body || {};
      if (!image) return fail(res, 400, 'VALIDATION', 'No image data provided.');
      const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(image);
      let buffer;
      if (match) {
        buffer = Buffer.from(match[2], 'base64');
      } else {
        buffer = Buffer.from(image, 'base64');
      }
      if (buffer.length === 0) return fail(res, 400, 'VALIDATION', 'Invalid image data.');
      const savedUrl = await propertiesService.saveUploadedBuffer(buffer, filename);
      res.status(201).json({ success: true, url: savedUrl, message: 'Image uploaded successfully.' });
    } catch (err) { next(err); }
  });
  api.use('/upload', uploadRouter);

  /* Categories & Locations */
  api.get('/categories', async (req, res, next) => {
    try {
      const categories = await db.all('SELECT * FROM categories ORDER BY id ASC');
      res.json({ success: true, categories });
    } catch (err) { next(err); }
  });

  api.get('/locations', async (req, res, next) => {
    try {
      const locations = await db.all('SELECT * FROM locations ORDER BY name ASC');
      res.json({ success: true, locations });
    } catch (err) { next(err); }
  });

  /* Customers */
  api.get('/customers', auth.requireAuth, async (req, res, next) => {
    try {
      const customers = await db.all(`
        SELECT c.*,
          (SELECT COUNT(*) FROM inquiries i WHERE i.customer_id = c.id) as inquiries_count,
          u.name as assigned_agent_name
        FROM customers c
        LEFT JOIN users u ON c.assigned_agent_id = u.id
        ORDER BY c.id DESC LIMIT 500
      `);
      res.json({ success: true, customers });
    } catch (err) { next(err); }
  });

  api.patch('/customers/:id', auth.requireAuth, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const { name, phone, email, notes, assigned_agent_id } = req.body || {};
      await db.run(
        `UPDATE customers
         SET name = COALESCE(?, name), phone = COALESCE(?, phone), email = COALESCE(?, email),
             notes = COALESCE(?, notes), assigned_agent_id = COALESCE(?, assigned_agent_id),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [name, phone, email, notes, assigned_agent_id, id]
      );
      res.json({ success: true, message: 'Customer updated.' });
    } catch (err) { next(err); }
  });

  /* Users / Team Management */
  api.get('/users', auth.requireRole('admin'), async (req, res, next) => {
    try {
      const users = await db.all('SELECT id, username, name, email, phone, role, status, created_at FROM users ORDER BY id ASC');
      res.json({ success: true, users });
    } catch (err) { next(err); }
  });

  api.post('/users', auth.requireRole('admin'), async (req, res, next) => {
    try {
      const { username, password, name, email, phone, role } = req.body || {};
      if (!username || !password || !name || !email) {
        return fail(res, 400, 'VALIDATION', 'Username, password, name and email are required.');
      }
      const existing = await db.get('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
      if (existing) return fail(res, 400, 'VALIDATION', 'Username or email already exists.');
      const passHash = auth.hashPassword(password);
      const userRole = role === 'admin' ? 'admin' : 'agent';
      const created = await db.run(
        'INSERT INTO users (username, password_hash, name, email, phone, role) VALUES (?, ?, ?, ?, ?, ?)',
        [username.toLowerCase().trim(), passHash, name.trim(), email.toLowerCase().trim(), phone || '', userRole]
      );
      res.status(201).json({ success: true, id: created.lastID, message: 'User created successfully.' });
    } catch (err) { next(err); }
  });

  api.patch('/users/:id', auth.requireRole('admin'), async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const { name, phone, email, role, status, password } = req.body || {};
      if (password) {
        const passHash = auth.hashPassword(password);
        await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [passHash, id]);
      }
      await db.run(
        `UPDATE users
         SET name = COALESCE(?, name), phone = COALESCE(?, phone), email = COALESCE(?, email),
             role = COALESCE(?, role), status = COALESCE(?, status), updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [name, phone, email, role, status, id]
      );
      res.json({ success: true, message: 'User updated successfully.' });
    } catch (err) { next(err); }
  });

  /* Site Settings & Banners */
  api.get('/settings', async (req, res, next) => {
    try {
      const rows = await db.all('SELECT key, value FROM site_settings');
      const settings = {};
      rows.forEach(r => { settings[r.key] = r.value; });
      res.json({ success: true, settings });
    } catch (err) { next(err); }
  });

  api.put('/settings', auth.requireRole('admin'), async (req, res, next) => {
    try {
      const updates = req.body || {};
      for (const [key, value] of Object.entries(updates)) {
        await db.run('INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)', [key, String(value)]);
      }
      await pages.refreshFromDb();
      res.json({ success: true, message: 'Settings updated successfully.' });
    } catch (err) { next(err); }
  });

  /* Analytics */
  api.get('/analytics', auth.requireRole('admin'), async (req, res, next) => {
    try {
      const totalProps = (await db.get('SELECT COUNT(*) as n FROM properties WHERE status != "archived"')).n;
      const activeProps = (await db.get('SELECT COUNT(*) as n FROM properties WHERE status = "available" AND published = 1')).n;
      const soldProps = (await db.get('SELECT COUNT(*) as n FROM properties WHERE status = "sold"')).n;
      const rentedProps = (await db.get('SELECT COUNT(*) as n FROM properties WHERE status = "rented"')).n;
      const totalInquiries = (await db.get('SELECT COUNT(*) as n FROM inquiries')).n;
      const newInquiries = (await db.get('SELECT COUNT(*) as n FROM inquiries WHERE status = "new"')).n;
      const totalCustomers = (await db.get('SELECT COUNT(*) as n FROM customers')).n;

      const inquiriesByStatus = await db.all('SELECT status, COUNT(*) as count FROM inquiries GROUP BY status');
      const inquiriesByService = await db.all('SELECT service, COUNT(*) as count FROM inquiries GROUP BY service');
      const propertiesByType = await db.all('SELECT type, COUNT(*) as count FROM properties WHERE status != "archived" GROUP BY type');
      const recentActivity = await db.all('SELECT * FROM activity_logs ORDER BY id DESC LIMIT 10');

      res.json({
        success: true,
        metrics: {
          totalProperties: totalProps,
          activeProperties: activeProps,
          soldProperties: soldProps,
          rentedProperties: rentedProps,
          totalInquiries,
          newInquiries,
          totalCustomers
        },
        inquiriesByStatus,
        inquiriesByService,
        propertiesByType,
        recentActivity
      });
    } catch (err) { next(err); }
  });

  /* Notifications & Audit Logs */
  api.get('/notifications', auth.requireRole('admin'), async (req, res, next) => {
    try {
      const logs = await notifications.getLogs(100);
      res.json({ success: true, notifications: logs });
    } catch (err) { next(err); }
  });

  api.get('/activity', auth.requireRole('admin'), async (req, res, next) => {
    try {
      const logs = await db.all('SELECT * FROM activity_logs ORDER BY id DESC LIMIT 100');
      res.json({ success: true, logs });
    } catch (err) { next(err); }
  });

  api.get('/inquiries', requireAdmin, async (req, res, next) => {
    try {
      const { status, search, agent_id } = req.query;
      let sql = 'SELECT * FROM inquiries WHERE 1=1';
      const params = [];
      if (status) {
        sql += ' AND status = ?';
        params.push(status);
      }
      if (agent_id) {
        sql += ' AND assigned_agent_id = ?';
        params.push(Number(agent_id));
      }
      if (search) {
        sql += ' AND (LOWER(name) LIKE ? OR LOWER(phone) LIKE ? OR LOWER(email) LIKE ? OR LOWER(message) LIKE ? OR LOWER(property_title) LIKE ?)';
        const term = `%${search.toLowerCase().trim()}%`;
        params.push(term, term, term, term, term);
      }
      sql += ' ORDER BY datetime(created_at) DESC, id DESC LIMIT ?';
      params.push(ADMIN_LIST_LIMIT);

      const total = (await db.get('SELECT COUNT(*) AS n FROM inquiries')).n;
      const inquiries = await db.all(sql, params);
      res.json({ success: true, inquiries, total, truncated: total > inquiries.length });
    } catch (err) {
      next(err);
    }
  });

  api.patch('/inquiries/:id', requireAdmin, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const { status: rawStatus, notes, assigned_agent_id } = req.body || {};
      const status = rawStatus ? clean(rawStatus, 30) : null;
      if (status && (!STATUSES.includes(status) || !Number.isInteger(id) || id < 1)) {
        return fail(res, 400, 'VALIDATION', 'Invalid inquiry or status.');
      }
      if (!Number.isInteger(id) || id < 1) {
        return fail(res, 400, 'VALIDATION', 'Invalid inquiry id.');
      }
      if (assigned_agent_id !== undefined && req.user && req.user.role !== 'admin') {
        return fail(res, 403, 'FORBIDDEN', 'Only administrators can reassign inquiries to agents.');
      }
      const existing = await db.get('SELECT id, status FROM inquiries WHERE id = ?', [id]);
      if (!existing) return fail(res, 404, 'NOT_FOUND', 'Enquiry not found.');

      await db.run(
        `UPDATE inquiries
         SET status = COALESCE(?, status), notes = COALESCE(?, notes),
             assigned_agent_id = COALESCE(?, assigned_agent_id), updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [status, notes !== undefined ? clean(notes, 2000) : null, assigned_agent_id !== undefined ? Number(assigned_agent_id) : null, id]
      );
      res.json({ success: true, message: 'Enquiry updated.' });
    } catch (err) {
      next(err);
    }
  });

  /* A known path used with the wrong method gets 405, anything else gets 404 */
  api.all('/inquiries', (req, res) => {
    res.set('Allow', 'GET, POST');
    fail(res, 405, 'METHOD_NOT_ALLOWED', 'That method is not allowed here.');
  });
  api.all('/inquiries/:id', (req, res) => {
    res.set('Allow', 'PATCH');
    fail(res, 405, 'METHOD_NOT_ALLOWED', 'That method is not allowed here.');
  });
  api.use((req, res) => fail(res, 404, 'NOT_FOUND', 'API route not found.'));

  app.use('/api', api);

  /* ---------- Search engine files ---------- */
  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(
      `User-agent: *\nDisallow: /api/\nDisallow: /admin\n\nSitemap: ${pages.baseUrl(req)}/sitemap.xml\n`
    );
  });

  app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(pages.sitemapXml(req));
  });

  /* ---------- Photos in phone-friendly sizes ---------- */
  app.get('/images/w/:width/:file', createImageRoute({ publicDir: config.publicDir, cacheDir: config.cacheDir, log }));

  /* ---------- Pages ---------- */
  function sendPage(res, html, status = 200, cache = 'no-cache') {
    res.status(status).type('html').set('Cache-Control', cache).send(html);
  }

  function notFound(req, res) {
    if (req.path.startsWith('/api/')) return fail(res, 404, 'NOT_FOUND', 'API route not found.');
    res.set('X-Robots-Tag', 'noindex');
    sendPage(res, pages.renderError(404), 404);
  }

  app.get(['/property-detail', '/property-detail.html'], (req, res, next) => {
    const result = pages.renderPropertyPage(req);
    if (!result) return next();
    if (result.status === 404) res.set('X-Robots-Tag', 'noindex');
    sendPage(res, result.html, result.status);
  });

  app.get('/', (req, res, next) => {
    const html = pages.render('index');
    if (html === null) return next();
    sendPage(res, html);
  });

  app.get(/^\/([a-z0-9-]+?)(?:\.html)?$/i, (req, res, next) => {
    const name = req.params[0];
    if (!pages.isPage(name)) return next();
    const html = pages.render(name);
    if (html === null) return next();
    const isAdmin = /^admin/i.test(name);
    if (isAdmin) res.set('X-Robots-Tag', 'noindex, nofollow');
    sendPage(res, html, 200, isAdmin ? 'no-store' : 'no-cache');
  });

  /* ---------- Static files (css, js, images) ---------- */
  app.use((req, res, next) => {
    /* Raw .html files contain unfilled placeholders and are never served directly */
    if (/\.html?$/i.test(req.path)) return notFound(req, res);
    /* A file linked with ?v=hash never changes under that address, so keep it for a year */
    if (req.query.v) res.set('Cache-Control', 'public, max-age=31536000, immutable');
    next();
  });
  app.use(express.static(config.publicDir, {
    dotfiles: 'deny',
    index: false,
    maxAge: '1h',
    redirect: false
  }));

  /* ---------- Not found ---------- */
  app.use(notFound);

  /* ---------- Errors ---------- */
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return req.socket.destroy();

    let status = Number(err.status || err.statusCode) || 500;
    let code = 'SERVER_ERROR';
    let message = 'Something went wrong on our side. Please try again in a moment.';

    if (err.type === 'entity.parse.failed') { status = 400; code = 'INVALID_JSON'; message = 'The request could not be read.'; }
    else if (err.type === 'entity.too.large') { status = 413; code = 'TOO_LARGE'; message = 'That message is too long.'; }
    else if (err.type === 'request.aborted' || err.code === 'ECONNABORTED') { status = 400; code = 'ABORTED'; message = 'The request was cancelled.'; }
    else if (status >= 400 && status < 500) { code = 'BAD_REQUEST'; message = 'The request could not be processed.'; }
    else status = 500;

    if (status >= 500) log.error('unhandled error', { id: req.id, path: req.path, error: err.message, stack: config.isProd ? undefined : err.stack });

    if (req.path.startsWith('/api/')) return fail(res, status, code, message);
    sendPage(res, pages.renderError(status >= 500 ? 500 : 404), status >= 500 ? 500 : status);
  });

  return { app, db, pages };
}

module.exports = { createApp };
