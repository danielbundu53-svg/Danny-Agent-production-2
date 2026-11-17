/* Opens the SQLite file and gives promise-style helpers.
   The schema is created on first run and is safe to run again on an existing file. */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const SERVICES = ['buy', 'rent', 'sell', 'investment', 'management', 'other'];
const STATUSES = ['new', 'contacted', 'qualified', 'closed'];

function wrap(db) {
  return {
    raw: db,
    run: (sql, params = []) => new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes });
      });
    }),
    get: (sql, params = []) => new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    }),
    all: (sql, params = []) => new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    }),
    exec: sql => new Promise((resolve, reject) => {
      db.exec(sql, err => (err ? reject(err) : resolve()));
    }),
    close: () => new Promise((resolve, reject) => {
      db.close(err => (err ? reject(err) : resolve()));
    })
  };
}

async function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = await new Promise((resolve, reject) => {
    const handle = new sqlite3.Database(dbPath, err => (err ? reject(err) : resolve(handle)));
  });
  const store = wrap(db);

  await store.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      service TEXT NOT NULL,
      budget TEXT,
      location TEXT,
      message TEXT NOT NULL,
      property_id INTEGER,
      property_title TEXT,
      property_location TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_inquiries_created ON inquiries (created_at);
    CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries (status);
    CREATE INDEX IF NOT EXISTS idx_inquiries_phone ON inquiries (phone);
  `);

  /* Defence in depth: the database itself refuses a status or service the app does not know,
     even if a future code change forgets to check. Works on files created before this existed. */
  const list = values => values.map(value => `'${value}'`).join(',');
  await store.exec(`
    CREATE TRIGGER IF NOT EXISTS inquiries_check_insert
    BEFORE INSERT ON inquiries
    WHEN NEW.status NOT IN (${list(STATUSES)}) OR NEW.service NOT IN (${list(SERVICES)})
    BEGIN SELECT RAISE(ABORT, 'invalid status or service'); END;

    CREATE TRIGGER IF NOT EXISTS inquiries_check_update
    BEFORE UPDATE OF status, service ON inquiries
    WHEN NEW.status NOT IN (${list(STATUSES)}) OR NEW.service NOT IN (${list(SERVICES)})
    BEGIN SELECT RAISE(ABORT, 'invalid status or service'); END;
  `);

  return store;
}

module.exports = { openDatabase, SERVICES, STATUSES };
