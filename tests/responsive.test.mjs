/* Opens every page in a real browser at phone, tablet and desktop sizes and checks that
   nothing overflows, breaks or logs errors.  Run with:  npm run test:responsive
   Screenshots go to tests/shots/ so you can look at them. */
import fs from 'node:fs';
import path from 'node:path';
import { startSite, openBrowser, watchPage, shotsDir } from './helpers.mjs';

const VIEWPORTS = [
  ['phone-320', 320, 568], ['phone-360', 360, 640], ['phone-375', 375, 667], ['phone-390', 390, 844],
  ['phone-414', 414, 896], ['phone-landscape', 667, 375], ['tablet-768', 768, 1024], ['tablet-landscape', 1024, 768],
  ['laptop-1280', 1280, 800], ['desktop-1440', 1440, 900], ['wide-1920', 1920, 1080]
];
const PAGES = ['/', '/properties.html', '/property-detail.html?id=1', '/property-detail.html?id=99', '/contact.html',
  '/favorites.html', '/about.html', '/admin.html', '/nothing-here'];
const MIN_TAP = 44;

const site = await startSite();
const browser = await openBrowser();
fs.mkdirSync(shotsDir, { recursive: true });
const failures = [];
const warnings = [];
let checks = 0;

for (const [label, width, height] of VIEWPORTS) {
  const phone = width < 768;
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone
  });
  for (const url of PAGES) {
    const page = await context.newPage();
    const problems = watchPage(page);
    await page.goto(site.url + url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(150);
    checks++;
    const where = `${label} ${url}`;

    const report = await page.evaluate(({ MIN_TAP }) => {
      const doc = document.documentElement;
      const out = { overflow: doc.scrollWidth - doc.clientWidth, wide: [], smallInputs: [], smallTaps: [], brokenImages: [] };

      /* which element sticks out to the right */
      for (const el of document.body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width && r.right > doc.clientWidth + 1 && getComputedStyle(el).position !== 'fixed' && !el.closest('.overflow-x-auto, [class*="overflow-hidden"], noscript, svg')) {
          out.wide.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).slice(0, 40)}`);
          if (out.wide.length > 4) break;
        }
      }
      for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea')) {
        if (el.offsetParent !== null && parseFloat(getComputedStyle(el).fontSize) < 16) out.smallInputs.push(el.id || el.name || el.tagName);
      }
      for (const el of document.querySelectorAll('a[href], button, select, input:not([type=hidden])')) {
        if (el.closest("[aria-hidden=true]")) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || el.offsetParent === null) continue;
        if (el.closest('footer, nav') && el.tagName === 'A' && r.height < MIN_TAP) {
          // text links inside paragraphs and footers are allowed to be smaller
        }
        if (r.height < MIN_TAP - 4 || r.width < MIN_TAP - 4) {
          const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
          if (!inline) out.smallTaps.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}"`);
        }
      }
      for (const img of document.images) {
        if (img.complete && img.naturalWidth === 0 && img.currentSrc && !img.src.startsWith('data:') && !img.hasAttribute('data-failed')) out.brokenImages.push(img.currentSrc);
      }
      return out;
    }, { MIN_TAP });

    if (report.overflow > 0) failures.push(`${where}: page is ${report.overflow}px wider than the screen (${report.wide.join(' | ')})`);
    if (report.smallInputs.length) failures.push(`${where}: form fields under 16px text (iPhones zoom in): ${report.smallInputs.join(', ')}`);
    if (report.brokenImages.length) failures.push(`${where}: broken images: ${report.brokenImages.join(', ')}`);
    if (report.smallTaps.length && phone) warnings.push(`${where}: small tap targets: ${[...new Set(report.smallTaps)].slice(0, 6).join('; ')}`);
    const real = problems.filter(p => !(url === '/property-detail.html?id=99' || url === '/nothing-here') || !p.startsWith('HTTP 404'));
    for (const p of real.filter(p => !p.includes('Failed to load resource') || !/(404)/.test(p))) failures.push(`${where}: ${p}`);

    if (['phone-375', 'tablet-768', 'desktop-1440'].includes(label)) {
      const name = `${label}-${url.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home'}.png`;
      await page.screenshot({ path: path.join(shotsDir, name), fullPage: true });
    }
    await page.close();
  }
  await context.close();
}

await browser.close();
await site.stop();

console.log(`\nChecked ${checks} page/size combinations (${VIEWPORTS.length} sizes x ${PAGES.length} pages).`);
if (warnings.length) {
  console.log(`\nTap-target notes (${warnings.length}), not failures:`);
  warnings.slice(0, 40).forEach(w => console.log('  - ' + w));
}
if (failures.length) {
  console.log(`\nFAILED (${failures.length}):`);
  [...new Set(failures)].forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\nAll responsive checks passed.');
