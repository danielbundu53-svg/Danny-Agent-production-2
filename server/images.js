/* Makes phone-sized copies of property photos the first time they are asked for.
   A phone asks for /images/w/480/property-1.jpg and gets a small file (about 30 KB)
   instead of the original (about 300 KB). Copies are kept in the cache folder and are
   rebuilt automatically when the original photo is replaced. */

const fs = require('fs');
const path = require('path');

let sharp = null;
try {
  sharp = require('sharp');
  sharp.cache({ files: 0, items: 50, memory: 50 });
  sharp.concurrency(1);
} catch (_) { /* resizing is optional: originals are sent instead */ }

const WIDTHS = new Set([480, 800, 1200]);
const FILE_NAME = /^[A-Za-z0-9._-]+\.(?:jpe?g|png|webp)$/i;
const CACHE_CONTROL = 'public, max-age=3600';

function createImageRoute({ publicDir, cacheDir, log }) {
  const imagesDir = path.join(publicDir, 'images');
  const inFlight = new Map();

  if (!sharp) log.warn('sharp is not installed: phones will receive full-size photos');

  async function makeCopy(source, target, width) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
      await sharp(source)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 74, progressive: true, mozjpeg: true })
        .toFile(temp);
      fs.renameSync(temp, target);
    } catch (err) {
      try { fs.unlinkSync(temp); } catch (_) { /* nothing to clean */ }
      throw err;
    }
  }

  return async function imageRoute(req, res, next) {
    const width = Number(req.params.width);
    const file = req.params.file;
    if (!WIDTHS.has(width) || !FILE_NAME.test(file)) return next();

    const source = path.join(imagesDir, file);
    let sourceStat;
    try { sourceStat = fs.statSync(source); } catch (_) { return next(); }
    if (!sourceStat.isFile()) return next();

    const send = (full, type) => res.type(type).set('Cache-Control', CACHE_CONTROL).sendFile(full, { dotfiles: 'deny' }, err => {
      if (err && !res.headersSent) next(err);
    });

    if (!sharp) return send(source, path.extname(file));

    const target = path.join(cacheDir, 'images', `${file}.${width}.jpg`);
    try {
      let fresh = false;
      try { fresh = fs.statSync(target).mtimeMs >= sourceStat.mtimeMs; } catch (_) { /* not made yet */ }

      if (!fresh) {
        if (!inFlight.has(target)) {
          inFlight.set(target, makeCopy(source, target, width).finally(() => inFlight.delete(target)));
        }
        await inFlight.get(target);
      }
      return send(target, 'jpeg');
    } catch (err) {
      /* A photo that cannot be resized (damaged file, no disk space) still gets shown */
      log.warn('could not resize photo, sending the original', { file, error: err.message });
      return send(source, path.extname(file));
    }
  };
}

module.exports = { createImageRoute };
