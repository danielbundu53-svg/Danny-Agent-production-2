/* Checks and saves an enquiry. Used by the contact form and by the chat assistant,
   so both follow exactly the same rules. */

const { SERVICES } = require('./db');

const DUPLICATE_WINDOW_MINUTES = 10;
const HOURLY_INSERT_CAP = 200;

function clean(value, max = 1000) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return '';
  return String(value).trim().slice(0, max);
}

function createInquiryService({ db, log }) {
  /* Returns one of:
       { result: 'spam' }                      hidden field filled (a bot)
       { result: 'invalid', fields: [...] }    something is wrong; fields names them
       { result: 'busy' }                      too many enquiries this hour
       { result: 'saved', id }                 saved (or an identical one was saved moments ago) */
  async function submit(body, { source = 'form' } = {}) {
    body = body && typeof body === 'object' && !Array.isArray(body) ? body : {};

    if (clean(body.website, 200)) return { result: 'spam' };

    const name = clean(body.name, 100);
    const phone = clean(body.phone, 50);
    const email = clean(body.email, 150).toLowerCase();
    const service = clean(body.service, 50).toLowerCase();
    const budget = clean(body.budget, 100);
    const location = clean(body.location, 150);
    let message = clean(body.message, 2000);

    const rawId = clean(body.propertyId, 10);
    const propertyId = /^\d+$/.test(rawId) && Number(rawId) > 0 ? Number(rawId) : null;
    const propertyTitle = clean(body.propertyTitle, 200) || null;
    const propertyLocation = clean(body.propertyLocation, 200) || null;

    const phoneDigits = phone.replace(/\D/g, '');
    const fields = [];
    if (name.length < 2) fields.push('name');
    if (!/^\+?[\d\s().-]+$/.test(phone) || phoneDigits.length < 8 || phoneDigits.length > 15) fields.push('phone');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fields.push('email');
    if (!SERVICES.includes(service)) fields.push('service');
    if (message.length < 10) fields.push('message');
    if (fields.length) return { result: 'invalid', fields };

    /* Enquiries that came from the chat assistant are marked, so the owner knows */
    if (source === 'chat') message = `[Sent through the website chat assistant]\n${message}`.slice(0, 2000);

    /* Double-clicks and retries after a slow connection must not create two enquiries */
    const duplicate = await db.get(
      `SELECT id FROM inquiries WHERE phone = ? AND message = ?
       AND datetime(created_at) > datetime('now', ?) ORDER BY id DESC LIMIT 1`,
      [phone, message, `-${DUPLICATE_WINDOW_MINUTES} minutes`]
    );
    if (duplicate) return { result: 'saved', id: duplicate.id };

    /* Last line of defence against a flood that gets past the per-visitor limits */
    const recent = await db.get(`SELECT COUNT(*) AS n FROM inquiries WHERE datetime(created_at) > datetime('now', '-1 hour')`);
    if (recent.n >= HOURLY_INSERT_CAP) {
      log.error('hourly enquiry cap reached');
      return { result: 'busy' };
    }

    const saved = await db.run(
      `INSERT INTO inquiries
       (name, phone, email, service, budget, location, message, property_id, property_title, property_location)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, phone, email, service, budget, location, message, propertyId, propertyTitle, propertyLocation]
    );
    log.info('enquiry saved', { enquiry: saved.lastID, source });
    return { result: 'saved', id: saved.lastID };
  }

  return { submit };
}

module.exports = { createInquiryService, clean };
