/* Starts the website. Run with: npm start */

const { loadEnvFile, readConfig, validateConfig } = require('./config');
const { createLogger } = require('./logger');

const loadedFrom = loadEnvFile();
const config = readConfig();
const log = createLogger({ level: config.logLevel, json: config.isProd });

const { errors, warnings } = validateConfig(config);
warnings.forEach(text => log.warn(text));
if (errors.length) {
  errors.forEach(text => log.error(text));
  log.error('The server did not start. Fix the problem above in your .env file (or host settings) and start again.');
  process.exit(1);
}

const { createApp } = require('./app');

async function main() {
  const { app, db } = await createApp(config, { log });

  const server = app.listen(config.port, () => {
    log.info('server started', {
      port: config.port,
      mode: config.isProd ? 'production' : 'development',
      env: loadedFrom ? 'loaded .env' : 'no .env file'
    });
  });

  /* Slow or stuck connections are cut instead of piling up */
  server.requestTimeout = 30 * 1000;
  server.headersTimeout = 15 * 1000;
  server.keepAliveTimeout = 65 * 1000;

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') log.error(`Port ${config.port} is already in use. Stop the other program, or set a different PORT.`);
    else if (err.code === 'EACCES') log.error(`No permission to use port ${config.port}. Try a port above 1024.`);
    else log.error('server error', { error: err.message });
    process.exit(1);
  });

  let closing = false;
  async function shutdown(signal, exitCode = 0) {
    if (closing) return;
    closing = true;
    log.info('shutting down', { signal });
    const force = setTimeout(() => {
      log.error('shutdown took too long, forcing exit');
      process.exit(1);
    }, 10 * 1000);
    force.unref();
    server.close(async () => {
      try { await db.close(); } catch (err) { log.error('database close failed', { error: err.message }); }
      process.exit(exitCode);
    });
    server.closeIdleConnections && server.closeIdleConnections();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', reason => {
    log.error('unhandled promise rejection', { error: reason && reason.message ? reason.message : String(reason) });
  });
  process.on('uncaughtException', err => {
    log.error('uncaught exception', { error: err.message, stack: err.stack });
    shutdown('uncaughtException', 1);
  });
}

main().catch(err => {
  log.error('could not start', { error: err.message });
  process.exit(1);
});
