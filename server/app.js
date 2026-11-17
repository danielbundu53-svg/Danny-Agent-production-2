/* Builds the Express app: security, API, pages, photos, errors.
   Kept separate from server.js so the tests can start a copy on a spare port. */

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const compression = require('compression');

const { openDatabase, STATUSES } = require('./db');
const { createInquiryService, clean } = require('./inquiries');
const { fail } = require('./http-errors');
const { securityHeaders, forceHttps, rateLimit, apiGuards, createAdminAuth } = require('./security');
const { createPages } = require('./pages');
const { createImageRoute } = require('./images');
const { createChat } = require('./chat');

const ADMIN_LIST_LIMIT = 2000;

async function createApp(config, { log, fetchImpl }) {
  const db = await openDatabase(config.dbPath);
  const pages = createPages({ publicDir: config.publicDir, config, log });
  const inquiries = createInquiryService({ db, log });
  const chat = createChat({ config, pages, inquiries, log, fetchImpl });
  const requireAdmin = createAdminAuth({ adminKey: config.adminKey, log });
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

  api.get('/inquiries', requireAdmin, async (req, res, next) => {
    try {
      const total = (await db.get('SELECT COUNT(*) AS n FROM inquiries')).n;
      const inquiries = await db.all(
        'SELECT * FROM inquiries ORDER BY datetime(created_at) DESC, id DESC LIMIT ?',
        [ADMIN_LIST_LIMIT]
      );
      res.json({ success: true, inquiries, total, truncated: total > inquiries.length });
    } catch (err) {
      next(err);
    }
  });

  api.patch('/inquiries/:id', requireAdmin, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const status = clean((req.body || {}).status, 30);
      if (!Number.isInteger(id) || id < 1 || !STATUSES.includes(status)) {
        return fail(res, 400, 'VALIDATION', 'Invalid inquiry or status.');
      }
      const result = await db.run('UPDATE inquiries SET status = ? WHERE id = ?', [status, id]);
      if (result.changes === 0) return fail(res, 404, 'NOT_FOUND', 'Enquiry not found.');
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
