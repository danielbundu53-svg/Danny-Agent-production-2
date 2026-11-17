/* Makes a safe copy of the database while the site is running.
   Run:  npm run backup        (copies go to data/backups, the 14 newest are kept)
   Optional:  node scripts/backup-db.js /some/other/folder */

const fs = require('fs');
const path = require('path');
const { loadEnvFile, readConfig } = require('../server/config');
const sqlite3 = require('sqlite3');

loadEnvFile();
const config = readConfig();
const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(path.dirname(config.dbPath), 'backups');
const KEEP = 14;

if (!fs.existsSync(config.dbPath)) {
  console.error(`No database found at ${config.dbPath}`);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const target = path.join(targetDir, `inquiries-${stamp}.sqlite`);

const db = new sqlite3.Database(config.dbPath, sqlite3.OPEN_READONLY, err => {
  if (err) { console.error('Could not open the database:', err.message); process.exit(1); }
  db.run('VACUUM INTO ?', [target], vacuumErr => {
    db.close();
    if (vacuumErr) { console.error('Backup failed:', vacuumErr.message); process.exit(1); }
    const old = fs.readdirSync(targetDir).filter(f => /^inquiries-.*\.sqlite$/.test(f)).sort().reverse().slice(KEEP);
    old.forEach(f => fs.unlinkSync(path.join(targetDir, f)));
    console.log(`Backup saved: ${target}`);
    if (old.length) console.log(`Removed ${old.length} older backup(s).`);
  });
});
