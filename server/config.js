/* Reads settings from the environment (and the .env file) and checks them.
   Everything the server needs to know about where it runs comes through here. */

const path = require('path');

const root = path.join(__dirname, '..');

/* Loads .env from the project folder (Node 20.12+). Real environment variables always win. */
function loadEnvFile() {
  for (const file of [path.join(root, '.env'), path.join(__dirname, '.env')]) {
    try {
      process.loadEnvFile(file);
      return file;
    } catch (_) { /* file not there: fine */ }
  }
  return null;
}

function parseTrustProxy(value, isProd) {
  if (value === undefined || value === '') return isProd ? 1 : false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : value;
}

function readConfig(env = process.env) {
  const isProd = env.NODE_ENV === 'production';
  const dbPath = env.DATABASE_PATH || path.join(root, 'data', 'danny-angel.sqlite');

  return {
    root,
    isProd,
    port: Number(env.PORT) || 5000,
    publicDir: env.PUBLIC_DIR || path.join(root, 'public'),
    dbPath,
    cacheDir: env.CACHE_DIR || path.join(path.dirname(dbPath), 'cache'),
    adminKey: env.ADMIN_KEY || '',
    siteUrl: (env.SITE_URL || '').trim().replace(/\/+$/, ''),
    // Off unless asked for: if the host's proxy does not report https correctly, redirecting would loop.
    forceHttps: env.FORCE_HTTPS === 'true',
    trustProxy: parseTrustProxy(env.TRUST_PROXY, isProd),
    logLevel: env.LOG_LEVEL || 'info',
    chat: {
      apiKey: (env.ANTHROPIC_API_KEY || '').trim(),
      model: env.CHAT_MODEL || 'claude-haiku-4-5-20251001',
      // Most messages the assistant will answer per day across the whole site (caps your bill)
      dailyLimit: Number(env.CHAT_DAILY_LIMIT) > 0 ? Number(env.CHAT_DAILY_LIMIT) : 400
    }
  };
}

const PLACEHOLDER_KEYS = /^(change-this|put-a-long|your-|example|test-key|AdminDanny|AgentDanny|admin|password|default)/i;
const KNOWN_DEFAULT_KEYS = [
  'AdminDanny2026!SecureKey',
  'AgentDanny2026!',
  'admin',
  'password',
  'dannyagent',
  '12345678',
  'secret'
];

/* Returns problems that must stop a production server, and warnings that should not. */
function validateConfig(config) {
  const errors = [];
  const warnings = [];

  if (!config.adminKey) {
    (config.isProd ? errors : warnings).push('ADMIN_KEY is not set. The admin page and API stay locked until you set it in .env.');
  } else if (KNOWN_DEFAULT_KEYS.some(k => k.toLowerCase() === config.adminKey.toLowerCase()) || PLACEHOLDER_KEYS.test(config.adminKey)) {
    (config.isProd ? errors : warnings).push('ADMIN_KEY is a known default or placeholder. A secure, unique random key of at least 24 characters is required in production.');
  } else if (config.adminKey.length < 24) {
    (config.isProd ? errors : warnings).push('ADMIN_KEY is too short. Use at least 24 random characters.');
  }

  if (config.siteUrl) {
    try {
      const url = new URL(config.siteUrl);
      if (!/^https?:$/.test(url.protocol)) errors.push('SITE_URL must start with http:// or https://');
      else if (config.isProd && url.protocol !== 'https:') warnings.push('SITE_URL is not https. Use your https address in production.');
    } catch (_) {
      errors.push('SITE_URL is not a valid address, for example https://www.example.com');
    }
  } else if (config.isProd) {
    warnings.push('SITE_URL is not set. Link previews and the sitemap will use the address each visitor arrives on.');
  }

  if (config.isProd && config.trustProxy === false) {
    warnings.push('TRUST_PROXY is off. Behind a hosting proxy, visitor addresses (used for rate limits) will all look the same.');
  }

  if (!config.chat.apiKey) {
    warnings.push('ANTHROPIC_API_KEY is not set. The website chat assistant stays hidden until you add it.');
  }

  return { errors, warnings };
}

module.exports = { loadEnvFile, readConfig, validateConfig };
