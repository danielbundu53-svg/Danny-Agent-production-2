/* The chat window in a real browser: phone and desktop sizes.  Run with:  npm run test:chat */
import assert from 'node:assert/strict';
import path from 'node:path';
import { startSite, openBrowser, watchPage, shotsDir } from './helpers.mjs';

const script = [];
const calls = [];
async function fetchImpl(url, options) {
  calls.push(JSON.parse(options.body));
  const next = script.shift();
  if (!next) return { ok: false, status: 500, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => next };
}
const say = text => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
const tool = (name, input) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name, input }] });

const site = await startSite({ env: { ANTHROPIC_API_KEY: 'sk-test', CHAT_DAILY_LIMIT: '500' }, fetchImpl });
const off = await startSite();   // no key: the assistant must not appear
const browser = await openBrowser();
let step = 0;
async function check(name, fn) {
  step++;
  try { await fn(); console.log(`ok ${step} - ${name}`); }
  catch (err) { console.log(`FAIL ${step} - ${name}\n   ${err.message}`); process.exitCode = 1; }
}

await check('no chat button anywhere when the assistant is switched off', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(off.url + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#chatButton').count(), 0);
  await ctx.close();
});

for (const [label, width, height, mobile] of [['phone-320', 320, 568, true], ['phone-375', 375, 667, true], ['tablet-768', 768, 1024, false], ['desktop-1440', 1440, 900, false]]) {
  await check(`${label}: opens, fits the screen, has readable text size and tappable buttons`, async () => {
    const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
    const page = await ctx.newPage();
    const problems = watchPage(page);
    await page.goto(site.url + '/properties.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('#chatButton');
    await page.click('#chatButton');
    assert.ok(await page.locator('#chatPanel').isVisible());
    const box = await page.locator('#chatPanel').boundingBox();
    assert.ok(box.x >= -1 && box.x + box.width <= width + 1, `panel sticks out horizontally (${box.x}, ${box.width})`);
    assert.ok(box.y >= -1 && box.y + box.height <= height + 1, `panel sticks out vertically (${box.y}, ${box.height})`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(overflow, 0, 'page scrolls sideways');
    assert.ok(parseFloat(await page.$eval('#chatInput', e => getComputedStyle(e).fontSize)) >= 16, 'input text under 16px (iPhone zooms)');
    const small = await page.$$eval('#chatPanel button, #chatPanel a', els => els.filter(e => e.offsetParent && (e.getBoundingClientRect().height < 40 || e.getBoundingClientRect().width < 40)).map(e => e.textContent.trim() || e.getAttribute('aria-label')));
    assert.deepEqual(small, []);
    await page.screenshot({ path: path.join(shotsDir, `chat-${label}.png`) });
    assert.deepEqual(problems.filter(p => !/ERR_ABORTED/.test(p)), []);
    await ctx.close();
  });
}

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const problems = watchPage(page);

await check('asking a question shows the answer with a working property link', async () => {
  script.push(say('Try Luxury City Apartment [[2]], $1,200 / month.'));
  await page.goto(site.url + '/', { waitUntil: 'networkidle' });
  await page.click('#chatButton');
  await page.click('#chatChips button >> text=What is available for rent?');
  await page.waitForSelector('#chatLog a[href="property-detail.html?id=2"]');
  assert.match(await page.locator('#chatLog').innerText(), /Luxury City Apartment/);
  assert.equal(await page.locator('#chatChips').isHidden(), true);
  assert.equal(calls[0].messages[0].content, 'What is available for rent?');
});

await check('conversation survives moving to another page', async () => {
  await page.goto(site.url + '/about.html', { waitUntil: 'networkidle' });
  await page.click('#chatButton');
  assert.match(await page.locator('#chatLog').innerText(), /What is available for rent\?/);
  assert.match(await page.locator('#chatLog').innerText(), /Luxury City Apartment/);
});

await check('on a property page the assistant is told which property is open', async () => {
  script.push(say('Yes, it has 3 bedrooms.'));
  await page.goto(site.url + '/property-detail.html?id=2', { waitUntil: 'networkidle' });
  await page.click('#chatButton');
  await page.fill('#chatInput', 'How many bedrooms?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('text=Yes, it has 3 bedrooms.');
  assert.match(calls.at(-1).system, /currently looking at listing \[\[2\]\] Luxury City Apartment/);
});

await check('saving an enquiry in chat shows the confirmation and lands in the admin list', async () => {
  script.push(tool('save_enquiry', { name: 'Ibrahim Conteh', phone: '+232 76 222333', email: 'ibrahim@example.com', service: 'rent', message: 'Wants to view the Hill Station apartment.', property_id: 2 }), say('Saved! The team will contact you.'));
  await page.fill('#chatInput', 'My name is Ibrahim, please contact me');
  await page.click('#chatSend');
  await page.waitForSelector('text=Saved! The team will contact you.');
  assert.match(await page.locator('#chatLog').innerText(), /Enquiry ENQ-\d+ saved/);
  assert.equal((await site.db.get('SELECT name FROM inquiries')).name, 'Ibrahim Conteh');
});

await check('hand-over to WhatsApp shows a green button with the right link', async () => {
  script.push(tool('whatsapp_handoff', { summary: 'Wants to speak to Danny about land.' }), say('Tap below to message the team.'));
  await page.fill('#chatInput', 'I want a person');
  await page.click('#chatSend');
  await page.waitForSelector('#chatLog a[href^="https://wa.me/"]');
  const href = await page.getAttribute('#chatLog a[href^="https://wa.me/"]', 'href');
  assert.match(decodeURIComponent(href), /speak to Danny about land/);
});

await check('Escape closes the chat and the button comes back with focus', async () => {
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#chatPanel').isHidden());
  assert.ok(await page.locator('#chatButton').isVisible());
  assert.equal(await page.evaluate(() => document.activeElement.id), 'chatButton');
});

await check('assistant failure shows a helpful message with the phone number', async () => {
  await page.click('#chatButton');
  await page.fill('#chatInput', 'Another question');
  await page.click('#chatSend');   // script is empty, so the stand-in API answers 500
  await page.waitForSelector('text=cannot answer right now');
  assert.match(await page.locator('#chatLog').innerText(), /\+232 76 683667/);
  assert.equal(await page.locator('#chatSend').isDisabled(), false);
});

await check('offline: tells the visitor the message was not answered and keeps the page working', async () => {
  await ctx.setOffline(true);
  await page.fill('#chatInput', 'Are you there?');
  await page.click('#chatSend');
  await page.waitForSelector('text=could not connect');
  await ctx.setOffline(false);
});

await check('a message containing HTML is shown as plain text, not run', async () => {
  script.push(say('<img src=x onerror=alert(1)> [[2]]'));
  await page.fill('#chatInput', '<b>hi</b>');
  await page.click('#chatSend');
  await page.waitForSelector('#chatLog >> text=onerror');
  assert.equal(await page.locator('#chatLog img').count(), 0);
  assert.equal(await page.locator('#chatLog b').count(), 0);
});

await check('no console errors or CSP violations during the walk', async () => {
  const real = problems.filter(p => !/ERR_ABORTED|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(p));
  assert.deepEqual(real, []);
});

await browser.close();
await site.stop();
await off.stop();
console.log(process.exitCode ? '\nSome chat checks failed.' : '\nAll chat checks passed.');
