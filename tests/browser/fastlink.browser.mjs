/**
 * Real-browser smoke/regression scenarios. Install Playwright and Firefox, then:
 * PLAYWRIGHT_BROWSERS_PATH=... node tests/browser/fastlink.browser.mjs
 * FASTLINK_PLAYWRIGHT_MODULE may point to a temporary Playwright installation.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const { firefox } = await import(process.env.FASTLINK_PLAYWRIGHT_MODULE || 'playwright');
const runtime = readFileSync(new URL('../../client/fastlink.js', import.meta.url));
const staticExample = readFileSync(new URL('../../examples/static-html/index.html', import.meta.url));
const collectorRequests = [];
let unsafeRequests = 0;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/fastlink.js' || url.pathname === '/client/fastlink.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(runtime);
    return;
  }
  if (url.pathname === '/api/v1/events' && req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    collectorRequests.push({ contentType: req.headers['content-type'], payload: JSON.parse(body) });
    res.writeHead(url.searchParams.has('fail') ? 503 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: url.searchParams.has('fail') ? 'failed' : 'received' }));
    return;
  }
  if (url.pathname === '/demo/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(staticExample);
    return;
  }
  if (url.pathname === '/api/submit-lead' && req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const submitted = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const isSuccess = submitted.email.startsWith('verified@');
    res.writeHead(submitted.email.startsWith('fail@') ? 422 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ verified: isSuccess, lead_id: isSuccess ? 'lead-123' : undefined }));
    return;
  }
  if (url.searchParams.has('add-to-cart')) unsafeRequests++;
  if (url.pathname === '/verified-lead' || url.pathname === '/verified-purchase') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ verified: true, transaction_id: 'test-transaction' }));
    return;
  }
  if (url.pathname === '/failed-lead') {
    res.writeHead(422, { 'Content-Type': 'application/json' });
    res.end('{"verified":false}');
    return;
  }
  if (url.pathname === '/page') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><h1 id="destination">Destination</h1>');
    return;
  }
  const collectorSetting = url.searchParams.has('noCollector') ? '' :
    (url.searchParams.has('failCollector') ? "collector:'/api/v1/events?fail=1'," : "collector:'/api/v1/events',");
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 40px; height: 1500px; font: 18px sans-serif }
    a,button { display: block; margin: 24px; padding: 12px; width: max-content }
  </style>
  <a id="safe" href="/page?view=1">Same origin</a>
  <a id="unsafe" href="/?add-to-cart=123">Add to cart</a>
  <a id="external" href="https://wa.me/1234567890" data-fl-event="Contact">WhatsApp</a>
  <button id="cta" data-fl-event="Contact">Contact</button>
  <form id="lead" data-fl-form="lead-gen"><button type="submit">Send</button></form>
  <script>
    window.__consent = false;
    window.__pixels = [];
    window.fbq = (...args) => window.__pixels.push(['meta', ...args]);
    window.ttq = {track:(...args) => window.__pixels.push(['tiktok', ...args])};
    window.dataLayer = [];
    window.__FAST_LINK_CONFIG__ = {
      mode:'safe', navigation:{prefetch:'same-origin'},
      signals:{${collectorSetting} consent:()=>window.__consent, providers:{meta:true,tiktok:true,gtm:true}}
    };
  </script><script src="/fastlink.js"></script>`);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await firefox.launch({ headless: true });
const context = await browser.newContext();
let count = 0;

async function scenario(name, fn) {
  const page = await context.newPage();
  try {
    await page.goto(base);
    await fn(page);
    count++;
    console.log(`PASS ${name}`);
  } finally {
    await page.close();
  }
}

async function press(page, selector) {
  const rect = await page.locator(selector).boundingBox();
  assert(rect, `element missing: ${selector}`);
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
}

try {
  await scenario('safe pointerdown prefetches without navigating until click', async (page) => {
    await press(page, '#safe');
    assert.equal(new URL(page.url()).pathname, '/');
    const urls = await page.evaluate(() => window.__FAST_LINK_INSTANCE__.core.getPrefetchedUrls());
    assert(urls.some((url) => url.includes('/page?view=1')), 'no prefetch scheduled');
    await page.mouse.up();
    await page.waitForURL('**/page?view=1');
  });

  await scenario('mouse drag-away does not navigate', async (page) => {
    await press(page, '#safe');
    await page.mouse.move(10, 10, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(60);
    assert.equal(new URL(page.url()).pathname, '/');
  });

  await scenario('approved fast route waits for release and respects drag-away', async (page) => {
    await page.evaluate(() => {
      window.__FAST_LINK_INSTANCE__.core.setMode('fast');
      document.querySelector('#safe').setAttribute('data-fl-fast', 'true');
    });
    await press(page, '#safe');
    assert.equal(new URL(page.url()).pathname, '/', 'fast route navigated on pointerdown');
    await page.mouse.move(10, 10, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(60);
    assert.equal(new URL(page.url()).pathname, '/', 'cancelled fast navigation');

    await press(page, '#safe');
    assert.equal(new URL(page.url()).pathname, '/', 'fast route navigated before release');
    await page.mouse.up();
    await page.waitForURL('**/page?view=1');
  });

  await scenario('mutating query URL never prefetches, even after cancellation', async (page) => {
    const before = unsafeRequests;
    await press(page, '#unsafe');
    await page.mouse.move(10, 10);
    await page.mouse.up();
    await page.waitForTimeout(120);
    assert.equal(unsafeRequests, before);
    assert.equal(new URL(page.url()).pathname, '/');
    const prefetched = await page.evaluate(() => window.__FAST_LINK_INSTANCE__.core.getPrefetchedUrls());
    assert(!prefetched.some((url) => url.includes('add-to-cart')));
  });

  await scenario('modifier-click keeps native behavior', async (page) => {
    page.on('popup', (popup) => popup.close());
    await page.locator('#safe').click({ modifiers: ['Control'] });
    assert.equal(new URL(page.url()).pathname, '/');
    const urls = await page.evaluate(() => window.__FAST_LINK_INSTANCE__.core.getPrefetchedUrls());
    assert.equal(urls.length, 0);
  });

  await scenario('middle-click keeps native behavior', async (page) => {
    page.on('popup', (popup) => popup.close());
    await page.locator('#safe').click({ button: 'middle' });
    assert.equal(new URL(page.url()).pathname, '/');
    const urls = await page.evaluate(() => window.__FAST_LINK_INSTANCE__.core.getPrefetchedUrls());
    assert.equal(urls.length, 0);
  });

  await scenario('keyboard Enter activates normal link', async (page) => {
    await page.locator('#safe').focus();
    await page.keyboard.press('Enter');
    await page.waitForURL('**/page?view=1');
  });

  await scenario('touch pointer intent does not prefetch', async (page) => {
    await page.locator('#safe').dispatchEvent('pointerdown', { button: 0, pointerType: 'touch' });
    await page.mouse.wheel(0, 100);
    assert.equal(new URL(page.url()).pathname, '/');
    const urls = await page.evaluate(() => window.__FAST_LINK_INSTANCE__.core.getPrefetchedUrls());
    assert.equal(urls.length, 0);
  });

  await scenario('WhatsApp CTA is Contact, never Lead, with consent', async (page) => {
    await page.evaluate(() => { window.__consent = true; });
    await page.route('https://wa.me/**', (route) => route.abort());
    await page.locator('#external').click({ noWaitAfter: true });
    await page.waitForTimeout(70);
    const events = await page.evaluate(() => window.__pixels.map((event) => event[2]));
    assert(events.includes('Contact'));
    assert(!events.includes('Lead'));
  });

  await scenario('form attempt and failed response never create Lead', async (page) => {
    await page.evaluate(async () => {
      window.__consent = true;
      document.querySelector('#lead').addEventListener('submit', (event) => event.preventDefault());
      document.querySelector('#lead button').click();
      await fetch('/failed-lead');
    });
    const events = await page.evaluate(() => window.__pixels.map((event) => event[2]));
    assert(events.includes('FormAttempt'));
    assert(!events.includes('Lead'));
  });

  await scenario('verified lead and purchase use matching platform IDs', async (page) => {
    await page.evaluate(async () => {
      window.__consent = true;
      const lead = await (await fetch('/verified-lead')).json();
      if (lead.verified) window.FastLink.recordVerifiedLead({ form: 'lead' }, 'lead-test-id');
      const purchase = await (await fetch('/verified-purchase')).json();
      if (purchase.verified) window.FastLink.recordVerifiedPurchase({ transaction_id: purchase.transaction_id }, 'purchase-test-id');
    });
    const events = await page.evaluate(() => ({ pixels: window.__pixels, gtm: window.dataLayer }));
    const metaLead = events.pixels.find((event) => event[0] === 'meta' && event[2] === 'Lead');
    const ttLead = events.pixels.find((event) => event[0] === 'tiktok' && event[1] === 'Lead');
    assert.equal(metaLead[4].eventID, 'lead-test-id');
    assert.equal(ttLead[3].event_id, 'lead-test-id');
    assert(events.gtm.some((event) => event.event === 'Purchase' && event.event_id === 'purchase-test-id'));
    await page.waitForTimeout(120);
    assert(collectorRequests.some((request) => request.payload.event_id === 'lead-test-id'));
    assert(collectorRequests.some((request) => request.payload.event_id === 'purchase-test-id'));
  });

  await scenario('consent denied blocks all advertising adapters', async (page) => {
    await page.locator('#cta').click();
    assert.equal(await page.evaluate(() => window.__pixels.length), 0);
    assert.equal(await page.evaluate(() => window.dataLayer.length), 0);
  });

  await scenario('sendBeacon false falls back to JSON fetch', async (page) => {
    await page.evaluate(() => { navigator.sendBeacon = () => false; });
    const start = collectorRequests.length;
    await page.locator('#cta').click();
    await page.waitForTimeout(150);
    assert(collectorRequests.length > start);
    assert(collectorRequests.at(-1).contentType.startsWith('application/json'));
  });

  await scenario('collector-less deployment makes no collector requests', async (page) => {
    await page.goto(`${base}/?noCollector=1`);
    const before = collectorRequests.length;
    await page.locator('#cta').click();
    await page.waitForTimeout(120);
    assert.equal(collectorRequests.length, before);
  });

  await scenario('collector failure does not break local click handling', async (page) => {
    await page.goto(`${base}/?failCollector=1`);
    const before = collectorRequests.length;
    await page.locator('#cta').click();
    await page.waitForTimeout(120);
    assert(collectorRequests.length > before);
    assert.equal(new URL(page.url()).pathname, '/');
  });

  await scenario('real static example does not synthesize leads from failed HTTP and unverified 200', async (page) => {
    await page.goto(`${base}/demo/`);
    await page.locator('#marketing-consent').check();
    await page.locator('#lead-name').fill('Test Customer');
    for (const email of ['fail@example.com', 'unverified@example.com']) {
      await page.locator('#lead-email').fill(email);
      await page.locator('#demo-lead-form button').click();
      await page.waitForTimeout(80);
      const logs = await page.locator('#console').innerText();
      assert(!logs.includes('track -> Lead'), `unexpected lead on ${email}`);
    }
  });

  await scenario('real static example emits Lead only after verified HTTP response', async (page) => {
    await page.goto(`${base}/demo/`);
    await page.locator('#marketing-consent').check();
    await page.locator('#lead-name').fill('Test Customer');
    await page.locator('#lead-email').fill('verified@example.com');
    await page.locator('#demo-lead-form button').click();
    await page.waitForFunction(() => document.querySelector('#console').textContent.includes('track -> Lead'));
    const logs = await page.locator('#console').innerText();
    assert(logs.includes('Lead verified by backend'));
  });

  console.log(`${count} browser regression scenarios passed (Firefox ${browser.version()})`);
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
