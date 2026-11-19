/* Opens the SQLite file and gives promise-style helpers.
   The schema is created on first run and is safe to run again on an existing file. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const sqlite3 = require('sqlite3');

const SERVICES = ['buy', 'rent', 'sell', 'investment', 'management', 'other'];
const STATUSES = ['new', 'contacted', 'qualified', 'closed'];
const PROPERTY_STATUSES = ['available', 'under offer', 'sold', 'rented', 'archived'];
const PROPERTY_TYPES = ['House', 'Apartment', 'Land', 'Commercial'];
const PROPERTY_PURPOSES = ['Buy', 'Rent'];
const USER_ROLES = ['admin', 'agent'];

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, key] = stored.split(':');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(hash, 'hex'));
}

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

async function addColumnIfNotExists(store, table, columnDef, columnName) {
  try {
    const tableInfo = await store.all(`PRAGMA table_info(${table})`);
    const exists = tableInfo.some(col => col.name === columnName);
    if (!exists) {
      await store.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
    }
  } catch (_) { /* column might already exist */ }
}

async function openDatabase(dbPath, { seedInitial = true, rootDir = path.join(__dirname, '..'), adminKey } = {}) {
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

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      role TEXT NOT NULL DEFAULT 'agent',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      city TEXT NOT NULL DEFAULT 'Freetown',
      region TEXT
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      purpose TEXT NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT UNIQUE,
      type TEXT NOT NULL,
      purpose TEXT NOT NULL,
      price_amount NUMERIC NOT NULL DEFAULT 0,
      price_currency TEXT NOT NULL DEFAULT '$',
      price_period TEXT,
      price_display TEXT NOT NULL,
      location TEXT NOT NULL,
      location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
      beds INTEGER NOT NULL DEFAULT 0,
      baths INTEGER NOT NULL DEFAULT 0,
      area TEXT NOT NULL,
      description TEXT NOT NULL,
      featured INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'available',
      published INTEGER NOT NULL DEFAULT 1,
      agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_properties_status ON properties (status);
    CREATE INDEX IF NOT EXISTS idx_properties_published ON properties (published);
    CREATE INDEX IF NOT EXISTS idx_properties_type ON properties (type);
    CREATE INDEX IF NOT EXISTS idx_properties_purpose ON properties (purpose);

    CREATE TABLE IF NOT EXISTS property_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_cover INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_property_images_prop ON property_images (property_id);

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      notes TEXT,
      assigned_agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone);
    CREATE INDEX IF NOT EXISTS idx_customers_email ON customers (email);

    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS banners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      link_url TEXT,
      bg_color TEXT DEFAULT 'navy',
      text_color TEXT DEFAULT 'white',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notifications_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      recipient TEXT NOT NULL,
      subject TEXT,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  /* Upgrade inquiries and properties tables with relational columns */
  await addColumnIfNotExists(store, 'inquiries', 'customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL', 'customer_id');
  await addColumnIfNotExists(store, 'inquiries', 'assigned_agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL', 'assigned_agent_id');
  await addColumnIfNotExists(store, 'inquiries', 'notes TEXT', 'notes');
  await addColumnIfNotExists(store, 'inquiries', 'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP', 'updated_at');
  await addColumnIfNotExists(store, 'properties', 'features TEXT', 'features');

  /* Defence in depth triggers for inquiries */
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

  /* Seed initial data if tables are empty */
  if (seedInitial) {
    await seedDatabase(store, rootDir, adminKey);
  }

  return store;
}

async function seedDatabase(db, rootDir, adminKey) {
  try {
    /* 1. Default Administrator and Agent accounts */
    const userCount = (await db.get('SELECT COUNT(*) AS n FROM users')).n;
    if (userCount === 0) {
      const defaultAdminPass = adminKey || process.env.ADMIN_KEY || 'AdminDanny2026!SecureKey';
      const adminPassHash = hashPassword(defaultAdminPass);
      await db.run(
        `INSERT INTO users (username, password_hash, name, email, phone, role, status)
         VALUES (?, ?, ?, ?, ?, 'admin', 'active')`,
        ['admin', adminPassHash, 'Head Administrator', 'admin@dannyagent.sl', '+232 76 683667']
      );

      const agentPassHash = hashPassword('AgentDanny2026!');
      await db.run(
        `INSERT INTO users (username, password_hash, name, email, phone, role, status)
         VALUES (?, ?, ?, ?, ?, 'agent', 'active')`,
        ['danny.agent', agentPassHash, 'Danny Senior Agent', 'dannyagento1@gmail.com', '+232 76 683667']
      );
    }

    /* 2. Default Categories & Locations */
    const catCount = (await db.get('SELECT COUNT(*) AS n FROM categories')).n;
    if (catCount === 0) {
      const defaultCats = [
        ['apartments-for-rent', 'Apartments for Rent', 'Apartment', 'Rent', 'Apartments and flats for rent across Freetown.'],
        ['houses-for-sale', 'Houses for Sale', 'House', 'Buy', 'Family homes, modern villas and residences for sale.'],
        ['offices-for-rent', 'Commercial Offices for Rent', 'Commercial', 'Rent', 'Office suites and business premises for rent.'],
        ['land-for-sale', 'Land for Sale', 'Land', 'Buy', 'Residential and commercial plots available to purchase.']
      ];
      for (const [slug, name, type, purpose, desc] of defaultCats) {
        await db.run('INSERT OR IGNORE INTO categories (slug, name, type, purpose, description) VALUES (?, ?, ?, ?, ?)', [slug, name, type, purpose, desc]);
      }
    }

    const locCount = (await db.get('SELECT COUNT(*) AS n FROM locations')).n;
    if (locCount === 0) {
      const defaultLocs = ['Wilberforce', 'Lumley', 'Hill Station', 'Congo Cross', 'Aberdeen', 'Juba', 'Waterloo', 'Central Freetown', 'Spur Loop', 'Goderich'];
      for (const loc of defaultLocs) {
        await db.run('INSERT OR IGNORE INTO locations (name, city, region) VALUES (?, ?, ?)', [loc, 'Freetown', 'Western Area']);
      }
    }

    /* 3. Initial Properties from public/js/properties.js */
    const propCount = (await db.get('SELECT COUNT(*) AS n FROM properties')).n;
    if (propCount === 0) {
      const propFilePath = path.join(rootDir, 'public', 'js', 'properties.js');
      if (fs.existsSync(propFilePath)) {
        const text = fs.readFileSync(propFilePath, 'utf8');
        const sandbox = {};
        vm.createContext(sandbox);
        vm.runInContext(text + '\n;this.__list = properties;', sandbox, { timeout: 2000 });
        const list = Array.from(sandbox.__list || []);

        for (const p of list) {
          const rawPrice = String(p.price || '').replace(/[^0-9.]/g, '');
          const priceAmount = Number(rawPrice) || 0;
          const isMonth = /month/i.test(p.price || '');
          const period = isMonth ? 'month' : (p.purpose === 'Rent' ? 'month' : null);

          const savedProp = await db.run(
            `INSERT INTO properties
             (id, title, slug, type, purpose, price_amount, price_currency, price_period, price_display, location, beds, baths, area, description, featured, status, published, agent_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [
              p.id,
              p.title,
              `property-${p.id}`,
              p.type,
              p.purpose,
              priceAmount,
              '$',
              period,
              p.price,
              p.location,
              p.beds || 0,
              p.baths || 0,
              p.area || '',
              p.description || '',
              p.id <= 6 ? 1 : 0,
              p.status || 'available',
              1
            ]
          );

          const images = p.images && p.images.length ? p.images : (p.image ? [p.image] : []);
          for (let i = 0; i < images.length; i++) {
            await db.run(
              `INSERT INTO property_images (property_id, url, sort_order, is_cover) VALUES (?, ?, ?, ?)`,
              [p.id, images[i], i, i === 0 ? 1 : 0]
            );
          }
        }
      }
    }

    /* 4. Default Site Settings */
    const settingsCount = (await db.get('SELECT COUNT(*) AS n FROM site_settings')).n;
    if (settingsCount === 0) {
      const defaults = {
        businessName: 'Danny Agent',
        phone: '+232 76 683667',
        whatsapp: '23276683667',
        email: 'dannyagento1@gmail.com',
        address: 'Freetown, Sierra Leone',
        openingHours: 'Mon - Sat: 8:30 AM - 6:00 PM',
        facebook: '',
        instagram: '',
        whatsappChannel: '',
        bannerText: 'Special Consultation Offer: Free Property Valuation this week in Freetown!',
        bannerActive: '0',
        aiAssistantActive: '1',
        aiDailyLimit: '400',
        emailNotificationsActive: '0',
        notificationEmail: 'dannyagento1@gmail.com'
      };
      for (const [key, val] of Object.entries(defaults)) {
        await db.run('INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)', [key, String(val)]);
      }
    }
  } catch (err) {
    console.error('Database seeding error:', err.message);
  }
}

module.exports = {
  openDatabase,
  SERVICES,
  STATUSES,
  PROPERTY_STATUSES,
  PROPERTY_TYPES,
  PROPERTY_PURPOSES,
  USER_ROLES,
  hashPassword,
  verifyPassword
};
