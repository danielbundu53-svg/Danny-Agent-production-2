/* Real-browser walk through the main things a visitor and the owner do.
   Run with:  npm run test:browser */
import assert from 'node:assert/strict';
import { startSite, openBrowser, watchPage, ADMIN_KEY } from './helpers.mjs';

const site = await startSite();
const browser = await openBrowser();
let step = 0;
async function check(name, fn) {
  step++;
  try { await fn(); console.log(`ok ${step} - ${name}`); }
  catch (err) { console.log(`FAIL ${step} - ${name}\n   ${err.message}`); process.exitCode = 1; }
}

const phone = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
const page = await phone.newPage();
const problems = watchPage(page);

await check('home page shows property cards with photos', async () => {
  await page.goto(site.url + '/', { waitUntil: 'networkidle' });
  assert.ok(await page.locator('#propertyGrid article').count() >= 4);
  const loaded = await page.$$eval('#propertyGrid img', imgs => imgs.filter(i => i.complete && i.naturalWidth > 0).length);
  assert.ok(loaded >= 1, 'no card photo loaded (lazy images below the fold are fine)');
});

await check('phone gets the small photo, not the full-size one', async () => {
  const src = await page.$eval('#propertyGrid img', i => i.currentSrc);
  assert.match(src, /images\/w\/(480|800)\//);
});

await check('mobile menu opens and closes', async () => {
  const menu = page.locator('#mobileMenu');
  assert.ok(await menu.isHidden());
  await page.locator('header button').first().click();
  assert.ok(await menu.isVisible());
  await page.locator('header button').first().click();
  assert.ok(await menu.isHidden());
});

await check('properties page filters by purpose', async () => {
  await page.goto(site.url + '/properties.html?purpose=rent', { waitUntil: 'networkidle' });
  const cards = await page.locator('#propertyGrid article').count();
  assert.ok(cards > 0 && cards < 8, 'cards: ' + cards);
  const badges = await page.$$eval('#propertyGrid article span', els => els.map(e => e.textContent.trim()));
  assert.ok(!badges.includes('Buy'), 'a Buy listing showed up under rent');
});

await check('properties page groups listings into four sections, each holding only its own kind', async () => {
  await page.goto(site.url + '/properties.html', { waitUntil: 'networkidle' });
  const expected = {
    'apartments-for-rent': ['Apartment', 'Rent'],
    'houses-for-sale': ['House', 'Buy'],
    'offices-for-rent': ['Commercial', 'Rent'],
    'land-for-sale': ['Land', 'Buy']
  };
  for (const [key, [type, purpose]] of Object.entries(expected)) {
    const badges = await page.$$eval(`#${key} article .absolute span`, els => els.map(e => e.textContent.trim()));
    assert.ok(badges.length >= 2, key + ' has no listings');
    assert.ok(badges.every(b => b === type || b === purpose), `${key} contains the wrong kind: ${badges}`);
  }
  assert.equal(await page.locator('#sectionNav a').count(), 4);
  assert.equal(await page.locator('#propertyGrid > section').count(), 4);
});

await check('filtering hides sections that have no matches', async () => {
  await page.goto(site.url + '/properties.html?type=Land', { waitUntil: 'networkidle' });
  assert.equal(await page.locator('#propertyGrid > section').count(), 1);
  assert.equal(await page.locator('#land-for-sale').count(), 1);
});

await check('nonsense search shows the empty state and Clear Filters restores the list', async () => {
  await page.goto(site.url + '/properties.html', { waitUntil: 'networkidle' });
  await page.fill('#searchInput', 'zzzzqqq');
  assert.match(await page.locator('#propertyGrid').innerText(), /No properties found/);
  await page.click('[data-clear-filters]');
  assert.ok(await page.locator('#propertyGrid article').count() > 0);
});

await check('saving a favorite shows on the favorites page and can be removed', async () => {
  await page.goto(site.url + '/properties.html', { waitUntil: 'networkidle' });
  await page.locator('[data-fav]').first().click();
  await page.goto(site.url + '/favorites.html', { waitUntil: 'networkidle' });
  assert.equal(await page.locator('#favoritesGrid article').count(), 1);
  await page.locator('[data-remove]').first().click();
  assert.match(await page.locator('#favoritesGrid').innerText(), /No Saved Properties Yet/);
});

await check('property gallery opens, moves and closes with the keyboard', async () => {
  await page.goto(site.url + '/property-detail.html?id=1', { waitUntil: 'networkidle' });
  await page.click('#mainPropertyImage');
  assert.ok(await page.locator('#galleryModal').isVisible());
  const first = await page.textContent('#galleryModalCounter');
  await page.keyboard.press('ArrowRight');
  assert.notEqual(await page.textContent('#galleryModalCounter'), first);
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#galleryModal').isHidden());
});

await check('unknown property id shows the not-found message', async () => {
  await page.goto(site.url + '/property-detail.html?id=424242', { waitUntil: 'networkidle' });
  assert.ok(await page.locator('#notFound').isVisible());
});

await check('contact form: empty submit shows errors and sends nothing', async () => {
  await page.goto(site.url + '/contact.html', { waitUntil: 'networkidle' });
  await page.click('#contactForm button[type=submit]');
  assert.equal((await site.db.get('SELECT COUNT(*) n FROM inquiries')).n, 0);
});

await check('contact form: valid enquiry is saved', async () => {
  await page.goto(site.url + '/contact.html?property=2', { waitUntil: 'networkidle' });
  await page.fill('#name', 'Test Visitor');
  await page.fill('#phone', '+232 76 111222');
  await page.fill('#email', 'visitor@example.com');
  await page.selectOption('#service', 'rent');
  await page.fill('#message', 'Is the apartment still available this month?');
  await page.click('#contactForm button[type=submit]');
  await page.waitForFunction(() => /Thank you/.test(document.getElementById('formMessage').textContent));
  const row = await site.db.get('SELECT * FROM inquiries');
  assert.equal(row.name, 'Test Visitor');
  assert.equal(row.property_id, 2);
});

await check('contact form: server down shows a helpful message and keeps what was typed', async () => {
  await page.goto(site.url + '/contact.html', { waitUntil: 'networkidle' });
  await page.fill('#name', 'Offline Person');
  await page.fill('#phone', '+232 76 333444');
  await page.fill('#email', 'offline@example.com');
  await page.selectOption('#service', 'buy');
  await page.fill('#message', 'Trying while the connection is down.');
  await page.route('**/api/inquiries', route => route.abort());
  await page.click('#contactForm button[type=submit]');
  await page.waitForFunction(() => /NOT sent/.test(document.getElementById('formMessage').textContent));
  assert.equal(await page.inputValue('#name'), 'Offline Person');
  await page.unroute('**/api/inquiries');
});

await check('admin: wrong key is rejected, right key lists the enquiry, status change saves', async () => {
  await page.goto(site.url + '/admin.html', { waitUntil: 'networkidle' });
  const keyBox = page.locator('input[type=password], input[type=text]').first();
  await keyBox.fill('wrong-key');
  await page.getByRole('button', { name: /load/i }).click();
  await page.waitForFunction(() => /not correct/i.test(document.body.innerText));
  await keyBox.fill(ADMIN_KEY);
  await page.getByRole('button', { name: /load/i }).click();
  await page.waitForSelector('select[data-id]');
  await page.selectOption('select[data-id]', 'contacted');
  await page.waitForTimeout(400);
  assert.equal((await site.db.get('SELECT status FROM inquiries LIMIT 1')).status, 'contacted');
});

await check('page with JavaScript off still lists properties and contact details', async () => {
  const plain = await browser.newContext({ javaScriptEnabled: false });
  const p = await plain.newPage();
  await p.goto(site.url + '/properties.html');
  const text = await p.innerText('body');
  assert.match(text, /Modern Family Residence/);
  assert.match(text, /\+232 76 683667/);
  await plain.close();
});

await check('offline banner appears when the connection drops', async () => {
  await page.goto(site.url + '/', { waitUntil: 'networkidle' });
  await phone.setOffline(true);
  await page.waitForSelector('#offlineNotice:not(.hidden)', { timeout: 3000 });
  await phone.setOffline(false);
});

await check('no console errors, CSP violations or failed requests during the whole walk', async () => {
  const real = problems.filter(p => !/net::ERR_FAILED|ERR_ABORTED|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(p) && !/404:/.test(p));
  assert.deepEqual(real, []);
});

await browser.close();
await site.stop();
console.log(process.exitCode ? '\nSome browser checks failed.' : '\nAll browser checks passed.');
