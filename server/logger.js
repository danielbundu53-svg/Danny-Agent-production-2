/* Small logger. Plain lines while developing, one JSON object per line in production
   (easy for hosting dashboards to search). Never pass passwords, keys or message bodies in. */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function createLogger({ level = 'info', json = false, out = console } = {}) {
  const threshold = LEVELS[level] || LEVELS.info;

  function write(name, message, fields) {
    if (LEVELS[name] < threshold) return;
    const stream = name === 'error' || name === 'warn' ? out.error : out.log;
    if (json) {
      stream.call(out, JSON.stringify({ time: new Date().toISOString(), level: name, message, ...fields }));
    } else {
      const extra = fields && Object.keys(fields).length
        ? ' ' + Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ')
        : '';
      stream.call(out, `${name.toUpperCase().padEnd(5)} ${message}${extra}`);
    }
  }

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields)
  };
}

module.exports = { createLogger };
