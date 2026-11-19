/* Property management service: CRUD, search, filtering, and image optimization. */

const fs = require('fs');
const path = require('path');
const { clean } = require('./inquiries');
let sharp = null;
try { sharp = require('sharp'); } catch (_) { /* fallback if sharp not available */ }

const PROPERTY_TYPES = ['House', 'Apartment', 'Land', 'Commercial', 'Office', 'Villa'];
const PROPERTY_PURPOSES = ['Buy', 'Rent'];
const PROPERTY_STATUSES = ['available', 'under offer', 'under_offer', 'sold', 'rented', 'archived'];

function createPropertyService({ db, publicDir, log }) {
  const uploadsDir = path.join(publicDir, 'images', 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  async function listProperties({
    purpose,
    type,
    location,
    minPrice,
    maxPrice,
    beds,
    status,
    search,
    includeUnpublished = false,
    limit = 100,
    offset = 0
  } = {}) {
    let sql = `
      SELECT p.*,
        (SELECT url FROM property_images pi WHERE pi.property_id = p.id ORDER BY is_cover DESC, sort_order ASC, id ASC LIMIT 1) AS image,
        u.name as agent_name, u.phone as agent_phone, u.email as agent_email
      FROM properties p
      LEFT JOIN users u ON p.agent_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (!includeUnpublished) {
      sql += ' AND p.published = 1 AND p.status != "archived"';
    }

    if (status && status !== 'all') {
      sql += ' AND p.status = ?';
      params.push(status);
    }

    if (purpose) {
      sql += ' AND LOWER(p.purpose) = ?';
      params.push(purpose.toLowerCase());
    }

    if (type) {
      sql += ' AND LOWER(p.type) = ?';
      params.push(type.toLowerCase());
    }

    if (location) {
      sql += ' AND LOWER(p.location) LIKE ?';
      params.push(`%${location.toLowerCase()}%`);
    }

    if (Number(beds) > 0) {
      sql += ' AND p.beds >= ?';
      params.push(Number(beds));
    }

    if (Number(minPrice) > 0) {
      sql += ' AND p.price_amount >= ?';
      params.push(Number(minPrice));
    }

    if (Number(maxPrice) > 0) {
      sql += ' AND p.price_amount <= ?';
      params.push(Number(maxPrice));
    }

    if (search) {
      const term = `%${search.toLowerCase().trim()}%`;
      sql += ' AND (LOWER(p.title) LIKE ? OR LOWER(p.location) LIKE ? OR LOWER(p.description) LIKE ?)';
      params.push(term, term, term);
    }

    sql += ' ORDER BY p.featured DESC, p.id DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = await db.all(sql, params);

    /* Fetch all images for these properties in one query */
    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      const placeholders = ids.map(() => '?').join(',');
      const images = await db.all(
        `SELECT * FROM property_images WHERE property_id IN (${placeholders}) ORDER BY is_cover DESC, sort_order ASC, id ASC`,
        ids
      );
      const imgMap = new Map();
      images.forEach(img => {
        if (!imgMap.has(img.property_id)) imgMap.set(img.property_id, []);
        imgMap.get(img.property_id).push(img.url);
      });

      rows.forEach(r => {
        r.images = imgMap.get(r.id) || (r.image ? [r.image] : ['images/property-1.jpg']);
        if (!r.image) r.image = r.images[0];
      });
    }

    return rows;
  }

  async function getPropertyById(id) {
    const propertyId = Number(id);
    if (!Number.isInteger(propertyId) || propertyId <= 0) return null;

    const property = await db.get(
      `SELECT p.*, u.name as agent_name, u.phone as agent_phone, u.email as agent_email
       FROM properties p
       LEFT JOIN users u ON p.agent_id = u.id
       WHERE p.id = ?`,
      [propertyId]
    );
    if (!property) return null;

    const images = await db.all(
      'SELECT * FROM property_images WHERE property_id = ? ORDER BY is_cover DESC, sort_order ASC, id ASC',
      [propertyId]
    );

    property.images = images.map(i => i.url);
    property.imageDetails = images;
    property.image = property.images[0] || 'images/property-1.jpg';
    property.price = property.price_display || '';
    if (property.features) {
      try {
        property.features = typeof property.features === 'string' ? JSON.parse(property.features) : property.features;
      } catch (_) {
        property.features = typeof property.features === 'string' ? property.features.split(',').map(s => s.trim()).filter(Boolean) : [];
      }
    } else {
      property.features = [];
    }
    return property;
  }

  async function createProperty(data, userId) {
    const title = clean(data.title, 200);
    const type = clean(data.type, 50);
    const purpose = clean(data.purpose, 50);
    const location = clean(data.location, 200);
    const area = clean(data.area, 100);
    const description = clean(data.description, 4000);
    const priceDisplay = clean(data.price_display || data.price, 100);
    const priceAmount = Number(data.price_amount || String(priceDisplay).replace(/[^0-9.]/g, '')) || 0;
    const priceCurrency = clean(data.price_currency, 10) || '$';
    const pricePeriod = purpose.toLowerCase() === 'rent' ? clean(data.price_period, 20) || 'month' : null;
    const beds = Math.max(0, parseInt(data.beds, 10) || 0);
    const baths = Math.max(0, parseInt(data.baths, 10) || 0);
    const featured = data.featured ? 1 : 0;
    const status = PROPERTY_STATUSES.includes(data.status) ? data.status : 'available';
    const published = data.published === false || data.published === 0 || data.published === '0' ? 0 : 1;
    const agentId = Number(data.agent_id) || userId || null;

    if (!title || title.length < 3) throw new Error('Title must be at least 3 characters.');
    const matchedType = PROPERTY_TYPES.find(t => t.toLowerCase() === type.toLowerCase());
    if (!matchedType) throw new Error(`Type must be one of: ${PROPERTY_TYPES.join(', ')}`);
    const matchedPurpose = PROPERTY_PURPOSES.find(p => p.toLowerCase() === purpose.toLowerCase());
    if (!matchedPurpose) throw new Error(`Purpose must be one of: ${PROPERTY_PURPOSES.join(', ')}`);
    if (!location) throw new Error('Location is required.');
    if (!priceDisplay) throw new Error('Price is required.');

    const propSlug = data.slug ? clean(data.slug, 200).toLowerCase().replace(/[^a-z0-9-]+/g, '-') : `prop-${Date.now()}`;
    const featuresJson = Array.isArray(data.features) ? JSON.stringify(data.features) : (typeof data.features === 'string' ? data.features : null);

    const result = await db.run(
      `INSERT INTO properties
       (title, slug, type, purpose, price_amount, price_currency, price_period, price_display, location, beds, baths, area, description, features, featured, status, published, agent_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        title,
        propSlug,
        matchedType,
        matchedPurpose,
        priceAmount,
        priceCurrency,
        pricePeriod,
        priceDisplay,
        location,
        beds,
        baths,
        area,
        description,
        featuresJson,
        featured,
        status,
        published,
        agentId
      ]
    );

    const newId = result.lastID;

    /* Add images if provided */
    if (Array.isArray(data.images) && data.images.length > 0) {
      for (let i = 0; i < data.images.length; i++) {
        const url = clean(data.images[i], 500);
        if (url) {
          await db.run(
            'INSERT INTO property_images (property_id, url, sort_order, is_cover) VALUES (?, ?, ?, ?)',
            [newId, url, i, i === 0 ? 1 : 0]
          );
        }
      }
    } else if (data.image) {
      await db.run(
        'INSERT INTO property_images (property_id, url, sort_order, is_cover) VALUES (?, ?, 0, 1)',
        [newId, clean(data.image, 500)]
      );
    }

    if (userId) {
      await db.run('INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)', [
        userId, 'property_create', 'property', newId, `Created property: ${title}`
      ]);
    }

    return getPropertyById(newId);
  }

  async function updateProperty(id, data, userId) {
    const existing = await getPropertyById(id);
    if (!existing) return null;

    const title = data.title !== undefined ? clean(data.title, 200) : existing.title;
    const type = data.type !== undefined ? (PROPERTY_TYPES.find(t => t.toLowerCase() === clean(data.type, 50).toLowerCase()) || existing.type) : existing.type;
    const purpose = data.purpose !== undefined ? (PROPERTY_PURPOSES.find(p => p.toLowerCase() === clean(data.purpose, 50).toLowerCase()) || existing.purpose) : existing.purpose;
    const location = data.location !== undefined ? clean(data.location, 200) : existing.location;
    const area = data.area !== undefined ? clean(data.area, 100) : existing.area;
    const description = data.description !== undefined ? clean(data.description, 4000) : existing.description;
    const priceDisplay = data.price_display !== undefined ? clean(data.price_display, 100) : (data.price !== undefined ? clean(data.price, 100) : existing.price_display);
    const priceAmount = data.price_amount !== undefined ? Number(data.price_amount) : (data.price_display ? Number(String(priceDisplay).replace(/[^0-9.]/g, '')) : existing.price_amount);
    const beds = data.beds !== undefined ? Math.max(0, parseInt(data.beds, 10) || 0) : existing.beds;
    const baths = data.baths !== undefined ? Math.max(0, parseInt(data.baths, 10) || 0) : existing.baths;
    const featured = data.featured !== undefined ? (data.featured ? 1 : 0) : existing.featured;
    const status = data.status !== undefined && PROPERTY_STATUSES.includes(data.status) ? data.status : existing.status;
    const published = data.published !== undefined ? (data.published ? 1 : 0) : existing.published;
    const agentId = data.agent_id !== undefined ? (Number(data.agent_id) || null) : existing.agent_id;
    const featuresJson = data.features !== undefined
      ? (Array.isArray(data.features) ? JSON.stringify(data.features) : clean(data.features, 1000))
      : (Array.isArray(existing.features) ? JSON.stringify(existing.features) : existing.features);

    await db.run(
      `UPDATE properties
       SET title = ?, type = ?, purpose = ?, price_amount = ?, price_display = ?, location = ?,
           beds = ?, baths = ?, area = ?, description = ?, features = ?, featured = ?, status = ?, published = ?,
           agent_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [title, type, purpose, priceAmount, priceDisplay, location, beds, baths, area, description, featuresJson, featured, status, published, agentId, id]
    );

    if (Array.isArray(data.images)) {
      await db.run('DELETE FROM property_images WHERE property_id = ?', [id]);
      for (let i = 0; i < data.images.length; i++) {
        const url = clean(data.images[i], 500);
        if (url) {
          await db.run(
            'INSERT INTO property_images (property_id, url, sort_order, is_cover) VALUES (?, ?, ?, ?)',
            [id, url, i, i === 0 ? 1 : 0]
          );
        }
      }
    }

    if (userId) {
      await db.run('INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)', [
        userId, 'property_update', 'property', id, `Updated property: ${title}`
      ]);
    }

    return getPropertyById(id);
  }

  async function deleteProperty(id, userId, { hard = false } = {}) {
    const existing = await getPropertyById(id);
    if (!existing) return false;

    if (hard) {
      await db.run('DELETE FROM property_images WHERE property_id = ?', [id]);
      await db.run('DELETE FROM properties WHERE id = ?', [id]);
    } else {
      /* Soft archive */
      await db.run('UPDATE properties SET status = "archived", published = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
    }

    if (userId) {
      await db.run('INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)', [
        userId, hard ? 'property_delete' : 'property_archive', 'property', id, `${hard ? 'Deleted' : 'Archived'} property: ${existing.title}`
      ]);
    }

    return true;
  }

  async function addImage(propertyId, url, { isCover = false, sortOrder = 0 } = {}) {
    if (isCover) {
      await db.run('UPDATE property_images SET is_cover = 0 WHERE property_id = ?', [propertyId]);
    }
    const result = await db.run(
      'INSERT INTO property_images (property_id, url, sort_order, is_cover) VALUES (?, ?, ?, ?)',
      [propertyId, url, sortOrder, isCover ? 1 : 0]
    );
    return result.lastID;
  }

  async function deleteImage(propertyId, imageId) {
    await db.run('DELETE FROM property_images WHERE property_id = ? AND id = ?', [propertyId, imageId]);
    /* If no cover image remains, set first one as cover */
    const hasCover = await db.get('SELECT id FROM property_images WHERE property_id = ? AND is_cover = 1', [propertyId]);
    if (!hasCover) {
      const first = await db.get('SELECT id FROM property_images WHERE property_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1', [propertyId]);
      if (first) {
        await db.run('UPDATE property_images SET is_cover = 1 WHERE id = ?', [first.id]);
      }
    }
  }

  async function reorderImages(propertyId, orderedIds) {
    for (let index = 0; index < orderedIds.length; index++) {
      await db.run(
        'UPDATE property_images SET sort_order = ?, is_cover = ? WHERE property_id = ? AND id = ?',
        [index, index === 0 ? 1 : 0, propertyId, Number(orderedIds[index])]
      );
    }
  }

  /* Process uploaded image buffer and store in public/images/uploads/ */
  async function saveUploadedBuffer(buffer, originalName) {
    const ext = path.extname(originalName).toLowerCase() || '.jpg';
    const baseName = `prop-up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fileName = `${baseName}${ext === '.png' || ext === '.webp' ? ext : '.jpg'}`;
    const targetPath = path.join(uploadsDir, fileName);

    if (sharp) {
      await sharp(buffer)
        .rotate()
        .resize({ width: 1600, withoutEnlargement: true })
        .jpeg({ quality: 80, progressive: true })
        .toFile(targetPath);
    } else {
      fs.writeFileSync(targetPath, buffer);
    }

    return `images/uploads/${fileName}`;
  }

  return {
    listProperties,
    getPropertyById,
    createProperty,
    updateProperty,
    deleteProperty,
    addImage,
    deleteImage,
    reorderImages,
    saveUploadedBuffer
  };
}

module.exports = { createPropertyService, PROPERTY_TYPES, PROPERTY_PURPOSES, PROPERTY_STATUSES };
