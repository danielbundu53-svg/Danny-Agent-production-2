/* Everything that protects the site: browser security headers, request limits,
   the admin key check and the lock-out after too many wrong keys. */

const crypto = require('crypto');
const helmet = require('helmet');
const { fail } = require('./http-errors');

/* ---------- Browser security headers ----------
   The Content-Security-Policy tells the browser to run only scripts and styles that come
   from this site. If someone ever managed to inject a script into a page, the browser
   would refuse to run it. */
function securityHeaders({ isProd }) {
  const directives = {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'"],
    'img-src': ["'self'", 'data:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"]
  };
  if (isProd) directives['upgrade-insecure-requests'] = [];

  const base = helmet({
    contentSecurityPolicy: { useDefaults: false, directives },
    // Tells browsers to use https only. Skipped locally, where there is no https.
    strictTransportSecurity: isProd ? { maxAge: 15552000 } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' },
    crossOriginResourcePolicy: { policy: 'same-origin' }
  });

  return (req, res, next) => {
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    base(req, res, next);
  };
}

/* ---------- Redirect http to https (only when FORCE_HTTPS=true) ---------- */
function forceHttps({ enabled }) {
  return (req, res, next) => {
    if (!enabled || req.secure || req.path === '/api/health') return next();
    return res.redirect(308, `https://${req.get('host')}${req.originalUrl}`);
  };
}

/* ---------- Rate limit per visitor address ---------- */
function rateLimit({ windowMs, max, code, message, log }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) if (entry.reset <= now) hits.delete(ip);
  }, Math.min(windowMs, 60 * 1000)).unref();

  return (req, res, next) => {
    const now = Date.now();
    const entry = hits.get(req.ip);
    if (!entry || entry.reset <= now) {
      hits.set(req.ip, { count: 1, reset: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      const wait = Math.max(1, Math.ceil((entry.reset - now) / 1000));
      res.set('Retry-After', String(wait));
      if (entry.count === max + 1 && log) log.warn('rate limit reached', { ip: req.ip, path: req.path });
      return fail(res, 429, code || 'RATE_LIMITED', message, { retryAfterSeconds: wait });
    }
    next();
  };
}

/* ---------- API requests must come from this website, as JSON ---------- */
function apiGuards({ siteUrl }) {
  const allowedHosts = new Set();
  if (siteUrl) {
    try { allowedHosts.add(new URL(siteUrl).host); } catch (_) { /* validated elsewhere */ }
  }

  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

    const origin = req.get('origin');
    if (origin) {
      let originHost = '';
      try { originHost = new URL(origin).host; } catch (_) { /* treated as foreign below */ }
      if (originHost !== req.get('host') && !allowedHosts.has(originHost)) {
        return fail(res, 403, 'FORBIDDEN_ORIGIN', 'This request did not come from our website.');
      }
    }

    /* Only a request that carries a body has to say it is JSON */
    const hasBody = req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length']) > 0;
    if (hasBody && !req.is('application/json')) {
      return fail(res, 415, 'JSON_REQUIRED', 'Please send the request as JSON.');
    }
    next();
  };
}

/* ---------- Admin key ---------- */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/* After MAX_FAILURES wrong keys from one address, that address is locked out for
   LOCK_MS, even if it then tries the right key. Slows down guessing to a crawl. */
function createAdminAuth({ adminKey, log, maxFailures = 8, lockMs = 15 * 60 * 1000 }) {
  const failures = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of failures) if (record.reset <= now && (record.blockedUntil || 0) <= now) failures.delete(ip);
  }, 60 * 1000).unref();

  return function requireAdmin(req, res, next) {
    if (!adminKey) {
      return fail(res, 503, 'ADMIN_DISABLED', 'Admin access is not set up on this server.');
    }

    const now = Date.now();
    let record = failures.get(req.ip);

    if (record && record.blockedUntil > now) {
      const wait = Math.ceil((record.blockedUntil - now) / 1000);
      res.set('Retry-After', String(wait));
      return fail(res, 429, 'ADMIN_LOCKED', `Too many wrong keys. Try again in ${Math.ceil(wait / 60)} minute(s).`, { retryAfterSeconds: wait });
    }

    const supplied = req.get('x-admin-key');
    if (supplied && safeEqual(supplied, adminKey)) {
      failures.delete(req.ip);
      return next();
    }

    if (!record || record.reset <= now) {
      record = { count: 0, reset: now + lockMs, blockedUntil: 0 };
      failures.set(req.ip, record);
    }
    record.count += 1;
    if (record.count >= maxFailures) {
      record.blockedUntil = now + lockMs;
      log.warn('admin locked after wrong keys', { ip: req.ip });
    } else {
      log.warn('admin key rejected', { ip: req.ip, attempt: record.count });
    }
    return fail(res, 401, 'UNAUTHORIZED', 'That admin key is not correct.');
  };
}

module.exports = { securityHeaders, forceHttps, rateLimit, apiGuards, createAdminAuth };
