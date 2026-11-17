/* How heavy is each page, and how long does it take on a slow phone connection?
   Run with:  node tests/slow-network.test.mjs */
import { startSite, openBrowser } from './helpers.mjs';

const PROFILES = [
  ['Slow 3G', 400 * 1024 / 8, 400],      // 400 kbit/s, 400 ms delay
  ['Regular 4G', 9 * 1024 * 1024 / 8, 170]
];
const BUDGET_KB = 600;   // first load of any page, transferred
const site = await startSite();
const browser = await openBrowser();
let failed = false;

for (const [name, bytesPerSecond, latency] of PROFILES) {
  console.log(`\n${name}`);
  for (const url of ['/', '/properties.html', '/property-detail.html?id=1', '/contact.html']) {
    const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency, downloadThroughput: bytesPerSecond, uploadThroughput: bytesPerSecond });
    let bytes = 0;
    cdp.on('Network.loadingFinished', e => { bytes += e.encodedDataLength; });
    const started = Date.now();
    await page.goto(site.url + url, { waitUntil: 'load', timeout: 90000 });
    await page.waitForLoadState('networkidle', { timeout: 90000 });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const kb = Math.round(bytes / 1024);
    const over = name === 'Regular 4G' && kb > BUDGET_KB;
    if (over) failed = true;
    console.log(`  ${url.padEnd(28)} ${String(kb).padStart(5)} KB  loaded in ${seconds}s${over ? '  OVER BUDGET' : ''}`);
    await context.close();
  }
}
await browser.close();
await site.stop();
process.exit(failed ? 1 : 0);
