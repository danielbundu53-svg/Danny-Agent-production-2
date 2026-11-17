/* Sends the website's pages.
   Pages are plain HTML files in /public. Before sending, the server:
     - fills in the contact details inside the "JavaScript is off" notice,
     - adds a version to css/ and js/ links, so browsers keep files for a year but
       fetch a new copy the moment a file changes,
     - for a property page, writes that property's title, photo and price into the page
       so WhatsApp and Facebook previews are correct. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const PAGE_NAME = /^[a-z0-9-]+$/i;
const HIDDEN_PAGES = new Set(['404', '500']);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function createPages({ publicDir, config, log }) {
  const textCache = new Map();
  const parsedCache = new Map();
  const versionCache = new Map();

  /* Reads a file, keeping the text until the file changes on disk. */
  function readText(rel) {
    const full = path.join(publicDir, rel);
    let stat;
    try { stat = fs.statSync(full); } catch (_) { return null; }
    if (!stat.isFile()) return null;
    const cached = textCache.get(rel);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.text;
    const text = fs.readFileSync(full, 'utf8');
    textCache.set(rel, { mtimeMs: stat.mtimeMs, size: stat.size, text });
    return text;
  }

  /* Runs a parser on a file once per change. Failures are logged and give the fallback. */
  function parsed(rel, parse, fallback) {
    const text = readText(rel);
    if (text === null) return fallback;
    const cached = parsedCache.get(rel);
    if (cached && cached.text === text) return cached.value;
    try {
      const value = parse(text);
      parsedCache.set(rel, { text, value });
      return value;
    } catch (err) {
      log.error('could not read ' + rel, { error: err.message });
      return cached ? cached.value : fallback;
    }
  }

  const DEFAULT_SETTINGS = { businessName: 'Property Agent', phone: '', whatsapp: '', email: '', address: '' };

  function settings() {
    return parsed('js/site-config.js', text => {
      const match = /const siteConfig = (\{[\s\S]*?\n\});/.exec(text);
      if (!match) throw new Error('siteConfig not found');
      return { ...DEFAULT_SETTINGS, ...vm.runInNewContext('(' + match[1] + ')', {}, { timeout: 1000 }) };
    }, DEFAULT_SETTINGS);
  }

  function properties() {
    return parsed('js/properties.js', text => {
      const sandbox = {};
      vm.createContext(sandbox);
      vm.runInContext(text + '\n;this.__list = properties; this.__sections = propertySections.map(s => ({ title: s.title, ids: s.list.map(p => p.id) }));', sandbox, { timeout: 1000 });
      const list = Array.from(sandbox.__list);
      list.sections = Array.from(sandbox.__sections, s => ({ title: String(s.title), ids: Array.from(s.ids) }));
      return list;
    }, []);
  }

  function findProperty(id) {
    return properties().find(item => item.id === id);
  }

  function baseUrl(req) {
    return config.siteUrl || `${req.protocol}://${req.get('host')}`;
  }

  /* ---------- Contact links used in the "JavaScript is off" notice ---------- */
  function contactLinksHtml() {
    const s = settings();
    const parts = [];
    const phoneDigits = String(s.phone || '').replace(/\D/g, '');
    const whatsappDigits = String(s.whatsapp || '').replace(/\D/g, '');
    if (phoneDigits) parts.push(`<a class="underline font-semibold" href="tel:+${phoneDigits}">${escapeHtml(s.phone)}</a>`);
    if (whatsappDigits) parts.push(`<a class="underline font-semibold" href="https://wa.me/${whatsappDigits}">WhatsApp</a>`);
    if (s.email) parts.push(`<a class="underline font-semibold" href="mailto:${escapeHtml(s.email)}">${escapeHtml(s.email)}</a>`);
    return parts.length ? parts.join(' &middot; ') : '<a class="underline font-semibold" href="contact.html">Contact page</a>';
  }

  function listingsHtml() {
    const all = properties();
    const item = p =>
      `<li><a class="text-navy underline" href="property-detail.html?id=${encodeURIComponent(p.id)}">${escapeHtml(p.title)}</a>, ${escapeHtml(p.location)}, ${escapeHtml(p.price)}</li>`;
    const sections = all.sections || [];
    if (!sections.length) return `<ul class="list-disc pl-6 space-y-2 text-gray-700">${all.map(item).join('')}</ul>`;
    return sections.map(section => {
      const rows = section.ids.map(id => all.find(p => p.id === id)).filter(Boolean).map(item);
      if (!rows.length) return '';
      return `<h3 class="text-xl font-bold text-navy mt-8 mb-3">${escapeHtml(section.title)}</h3><ul class="list-disc pl-6 space-y-2 text-gray-700">${rows.join('')}</ul>`;
    }).join('');
  }

  function detailFallbackHtml(property) {
    const s = settings();
    const facts = [property.type, property.purpose === 'Buy' ? 'For sale' : 'For rent', property.location, property.area]
      .filter(Boolean).map(escapeHtml).join(' &middot; ');
    return `
      <div class="max-w-3xl mx-auto px-6 py-10">
        <h1 class="text-3xl font-bold text-navy">${escapeHtml(property.title)}</h1>
        <p class="text-gray-600 mt-2">${facts}</p>
        <p class="text-2xl font-bold text-navy mt-3">${escapeHtml(property.price)}</p>
        <img class="w-full rounded-2xl mt-5" src="images/w/800/${encodeURIComponent(String(property.image).replace(/^images\//, ''))}" alt="${escapeHtml(property.title)}">
        <p class="text-gray-700 leading-relaxed mt-5">${escapeHtml(property.description)}</p>
        <p class="mt-6 font-semibold text-navy">To enquire about this property: ${contactLinksHtml()}</p>
        <p class="mt-2 text-sm text-gray-500">${escapeHtml(s.businessName)}</p>
      </div>`;
  }

  /* ---------- Versioned asset links ---------- */
  function assetVersion(rel) {
    const full = path.join(publicDir, rel);
    let stat;
    try { stat = fs.statSync(full); } catch (_) { return null; }
    if (!stat.isFile()) return null;
    const cached = versionCache.get(rel);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.version;
    const version = crypto.createHash('md5').update(fs.readFileSync(full)).digest('hex').slice(0, 10);
    versionCache.set(rel, { mtimeMs: stat.mtimeMs, size: stat.size, version });
    return version;
  }

  function versionAssets(html) {
    return html.replace(/\b(href|src)="((?:css|js)\/[A-Za-z0-9._\/-]+\.(?:css|js))"/g, (match, attr, rel) => {
      const version = assetVersion(rel);
      return version ? `${attr}="${rel}?v=${version}"` : match;
    });
  }

  function applyTokens(html, extra = {}) {
    const tokens = {
      '%%CONTACT_LINKS%%': () => contactLinksHtml(),
      '%%NOSCRIPT_LISTINGS%%': () => listingsHtml(),
      ...extra
    };
    return html.replace(/%%[A-Z_]+%%/g, token => (tokens[token] ? tokens[token]() : ''));
  }

  /* ---------- Public functions ---------- */
  function isPage(name) {
    return PAGE_NAME.test(name) && !HIDDEN_PAGES.has(name.toLowerCase()) && readText(`${name}.html`) !== null;
  }

  function render(name, extra) {
    const html = readText(`${name}.html`);
    if (html === null) return null;
    return versionAssets(applyTokens(html, extra));
  }

  function renderPropertyPage(req) {
    const property = findProperty(Number(req.query.id));
    const base = readText('property-detail.html');
    if (base === null) return null;

    if (!property) {
      return { status: 404, html: versionAssets(applyTokens(base, { '%%NOSCRIPT_DETAIL%%': () => '' })) };
    }

    const s = settings();
    const label = property.purpose === 'Buy' ? 'For sale' : 'For rent';
    const title = `${property.title} | ${s.businessName}`;
    const description = `${label}: ${property.type} in ${property.location}. ${property.price}. ${property.description}`.slice(0, 200);
    const root = baseUrl(req);
    const imageFile = String(property.image).replace(/^images\//, '');
    const image = new URL(`images/w/1200/${encodeURIComponent(imageFile)}`, root + '/').href;
    const url = `${root}/property-detail.html?id=${property.id}`;

    const tags = [
      `<title>${escapeHtml(title)}</title>`,
      `<link rel="canonical" href="${escapeHtml(url)}">`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="${escapeHtml(s.businessName)}">`,
      `<meta property="og:title" content="${escapeHtml(`${property.title} - ${property.price}`)}">`,
      `<meta property="og:description" content="${escapeHtml(description)}">`,
      `<meta property="og:image" content="${escapeHtml(image)}">`,
      `<meta property="og:url" content="${escapeHtml(url)}">`,
      `<meta name="twitter:card" content="summary_large_image">`
    ].join('\n    ');

    let html = base
      .replace(/<title>.*?<\/title>/s, () => tags)
      .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/, (m, a, b) => a + escapeHtml(description) + b);

    html = versionAssets(applyTokens(html, { '%%NOSCRIPT_DETAIL%%': () => detailFallbackHtml(property) }));
    return { status: 200, html };
  }

  /* An error page. Falls back to a bare page if the page file itself is missing. */
  function renderError(status) {
    const html = render(String(status));
    if (html) return html;
    const text = status === 404 ? 'Page not found' : 'Something went wrong';
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${text}</title></head><body style="font-family:sans-serif;text-align:center;padding:4rem 1rem"><h1>${text}</h1><p><a href="/">Back to the home page</a></p></body></html>`;
  }

  function sitemapXml(req) {
    const root = baseUrl(req);
    const urls = ['/', '/properties.html', '/about.html', '/contact.html']
      .concat(properties().map(p => `/property-detail.html?id=${p.id}`));
    const entries = urls.map(u => `  <url><loc>${escapeHtml(root + u)}</loc></url>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
  }

  return { isPage, render, renderPropertyPage, renderError, sitemapXml, settings, properties, baseUrl };
}

module.exports = { createPages, escapeHtml };
