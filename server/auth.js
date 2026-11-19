/* Authentication, session management and Role-Based Access Control (RBAC). */

const crypto = require('crypto');
const { verifyPassword, hashPassword } = require('./db');
const { fail } = require('./http-errors');

const SESSION_DURATION_HOURS = 24 * 7; // 7 days

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function safeEqual(a, b) {
  if (!a || !b) return false;
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function createAuthService({ db, config, log }) {
  const lockouts = new Map();
  const MAX_FAILURES = 8;
  const LOCK_MS = 15 * 60 * 1000;

  setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of lockouts) {
      if (record.reset <= now && (record.blockedUntil || 0) <= now) lockouts.delete(ip);
    }
  }, 60 * 1000).unref();

  function checkLockout(ip) {
    const now = Date.now();
    const record = lockouts.get(ip);
    if (record && record.blockedUntil > now) {
      const wait = Math.ceil((record.blockedUntil - now) / 1000);
      return { locked: true, wait };
    }
    return { locked: false, wait: 0 };
  }

  function recordFailure(ip) {
    const now = Date.now();
    let record = lockouts.get(ip);
    if (!record || record.reset <= now) {
      record = { count: 0, reset: now + LOCK_MS, blockedUntil: 0 };
      lockouts.set(ip, record);
    }
    record.count += 1;
    if (record.count >= MAX_FAILURES) {
      record.blockedUntil = now + LOCK_MS;
      if (log) log.warn('ip locked after failed authentication', { ip });
    }
  }

  function clearFailure(ip) {
    lockouts.delete(ip);
  }

  async function login(username, password, { ip } = {}) {
    if (ip) {
      const { locked, wait } = checkLockout(ip);
      if (locked) {
        return { success: false, code: 'ADMIN_LOCKED', message: `Too many wrong attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`, retryAfter: wait };
      }
    }

    const cleanUser = String(username || '').trim().toLowerCase();
    const user = await db.get('SELECT * FROM users WHERE (LOWER(username) = ? OR LOWER(email) = ?) AND status = "active"', [cleanUser, cleanUser]);

    if (!user || !verifyPassword(password, user.password_hash)) {
      if (ip) recordFailure(ip);
      return { success: false, code: 'UNAUTHORIZED', message: 'Invalid username or password.' };
    }

    if (ip) clearFailure(ip);

    const token = generateToken();
    const expires = new Date(Date.now() + SESSION_DURATION_HOURS * 3600 * 1000).toISOString();

    await db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [token, user.id, expires]);

    await db.run('INSERT INTO activity_logs (user_id, username, action, entity_type, details) VALUES (?, ?, ?, ?, ?)', [
      user.id, user.username, 'login', 'auth', `User logged in from ${ip || 'unknown'}`
    ]);

    return {
      success: true,
      token,
      expiresAt: expires,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        mustChangePassword: Boolean(user.must_change_password)
      }
    };
  }

  async function logout(token) {
    if (!token) return;
    await db.run('DELETE FROM sessions WHERE token = ?', [token]);
  }

  async function getUserByToken(token) {
    if (!token) return null;
    const row = await db.get(
      `SELECT u.id, u.username, u.name, u.email, u.phone, u.role, u.status, u.must_change_password
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token = ? AND datetime(s.expires_at) > datetime('now') AND u.status = 'active'`,
      [token]
    );
    if (!row) return null;
    return {
      ...row,
      mustChangePassword: Boolean(row.must_change_password)
    };
  }

  /* Middleware: verifies session token OR fallback legacy adminKey */
  function requireAuth(req, res, next) {
    const authHeader = req.get('authorization') || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const token = bearerToken || req.get('x-session-token');

    if (token) {
      getUserByToken(token).then(user => {
        if (!user) {
          return fail(res, 401, 'UNAUTHORIZED', 'Session expired or invalid.');
        }
        req.user = user;
        req.token = token;

        /* Centrally enforce first-login password change:
           Users with must_change_password=1 are strictly restricted to:
           1. Session identity check (/api/auth/me)
           2. Password change (/api/auth/change-password)
           3. Logout (/api/auth/logout)
        */
        if (user.mustChangePassword) {
          const path = req.path || '';
          const url = (req.originalUrl || '').split('?')[0];
          const isAllowed = path === '/auth/me' ||
                            path === '/auth/change-password' ||
                            path === '/auth/logout' ||
                            url === '/api/auth/me' ||
                            url === '/api/auth/change-password' ||
                            url === '/api/auth/logout';
          if (!isAllowed) {
            return fail(res, 403, 'PASSWORD_CHANGE_REQUIRED', 'Password change required before accessing dashboard operations.');
          }
        }

        next();
      }).catch(err => {
        if (log) log.error('auth lookup failed', { error: err.message });
        fail(res, 500, 'SERVER_ERROR', 'Authentication verification failed.');
      });
      return;
    }

    /* Fallback for legacy admin key in tests and scripts */
    const suppliedKey = req.get('x-admin-key');
    if (suppliedKey && config.adminKey) {
      const { locked, wait } = checkLockout(req.ip);
      if (locked) {
        res.set('Retry-After', String(wait));
        return fail(res, 429, 'ADMIN_LOCKED', `Too many wrong keys. Try again in ${Math.ceil(wait / 60)} minute(s).`, { retryAfterSeconds: wait });
      }

      if (safeEqual(suppliedKey, config.adminKey)) {
        clearFailure(req.ip);
        req.user = { id: 1, username: 'admin', name: 'Administrator', role: 'admin' };
        return next();
      }

      recordFailure(req.ip);
      return fail(res, 401, 'UNAUTHORIZED', 'That admin key is not correct.');
    }

    if (!config.adminKey && !token) {
      return fail(res, 503, 'ADMIN_DISABLED', 'Admin access is not set up on this server.');
    }

    return fail(res, 401, 'UNAUTHORIZED', 'Authentication required.');
  }

  /* Middleware: enforces required role */
  function requireRole(allowed) {
    const roles = Array.isArray(allowed) ? allowed : [allowed];
    return (req, res, next) => {
      requireAuth(req, res, () => {
        if (!req.user || !roles.includes(req.user.role)) {
          return fail(res, 403, 'FORBIDDEN', 'You do not have permission to perform this action.');
        }
        next();
      });
    };
  }

  return {
    login,
    logout,
    getUserByToken,
    requireAuth,
    requireRole,
    generateToken,
    hashPassword,
    verifyPassword
  };
}

module.exports = { createAuthService };
