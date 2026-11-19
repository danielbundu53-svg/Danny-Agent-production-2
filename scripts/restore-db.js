/* Restores the SQLite database from a backup snapshot.
   Usage:
     node scripts/restore-db.js                    (restores from newest backup in data/backups/)
     node scripts/restore-db.js path/to/backup.sqlite
*/

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { loadEnvFile, readConfig } = require('../server/config');

loadEnvFile();
const config = readConfig();
const dbDir = path.dirname(config.dbPath);
const backupsDir = path.join(dbDir, 'backups');

let backupFile = process.argv[2] ? path.resolve(process.argv[2]) : null;

if (!backupFile) {
  if (!fs.existsSync(backupsDir)) {
    console.error(`Backups directory does not exist: ${backupsDir}`);
    process.exit(1);
  }
  const files = fs.readdirSync(backupsDir)
    .filter(f => /^inquiries-.*\.sqlite$/.test(f))
    .sort()
    .reverse();
  if (files.length === 0) {
    console.error(`No backup files found in: ${backupsDir}`);
    process.exit(1);
  }
  backupFile = path.join(backupsDir, files[0]);
}

if (!fs.existsSync(backupFile)) {
  console.error(`Specified backup file does not exist: ${backupFile}`);
  process.exit(1);
}

console.log(`Preparing to restore database from:\n  ${backupFile}`);

// Step 1: Verify backup file integrity
const testDb = new sqlite3.Database(backupFile, sqlite3.OPEN_READONLY, err => {
  if (err) {
    console.error('Cannot open backup file:', err.message);
    process.exit(1);
  }

  testDb.get('PRAGMA integrity_check', (checkErr, row) => {
    if (checkErr || !row || row.integrity_check !== 'ok') {
      console.error('Backup integrity check failed:', checkErr ? checkErr.message : 'Not ok');
      testDb.close();
      process.exit(1);
    }

    testDb.close(async () => {
      try {
        // Step 2: Backup current database before replacing
        if (fs.existsSync(config.dbPath)) {
          const preRestore = path.join(dbDir, `pre-restore-${Date.now()}.sqlite`);
          fs.copyFileSync(config.dbPath, preRestore);
          console.log(`Safety snapshot of current DB saved to:\n  ${preRestore}`);

          // Remove old WAL/SHM sidecars
          const wal = config.dbPath + '-wal';
          const shm = config.dbPath + '-shm';
          if (fs.existsSync(wal)) fs.unlinkSync(wal);
          if (fs.existsSync(shm)) fs.unlinkSync(shm);
        }

        // Step 3: Copy backup to live path
        fs.copyFileSync(backupFile, config.dbPath);
        console.log(`Database successfully restored to:\n  ${config.dbPath}`);

        // Step 4: Verify restored DB contents
        const liveDb = new sqlite3.Database(config.dbPath, sqlite3.OPEN_READONLY, liveErr => {
          if (liveErr) {
            console.error('Error opening restored DB:', liveErr.message);
            process.exit(1);
          }
          liveDb.get('SELECT (SELECT COUNT(*) FROM properties) as props, (SELECT COUNT(*) FROM inquiries) as inqs, (SELECT COUNT(*) FROM users) as usrs', (cntErr, counts) => {
            liveDb.close();
            if (!cntErr && counts) {
              console.log(`\nRestored contents verification:`);
              console.log(`  Properties: ${counts.props}`);
              console.log(`  Inquiries:  ${counts.inqs}`);
              console.log(`  Users:      ${counts.usrs}`);
            }
            console.log('\nRestore complete. Restart server if currently running.');
          });
        });
      } catch (copyErr) {
        console.error('Restore operation failed:', copyErr.message);
        process.exit(1);
      }
    });
  });
});
