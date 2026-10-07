const { chromium } = require('playwright');
const ADDR = '0x56957E411Ea83a0B4A0689C1fB0D1e5eA0d20149';
const shot = (p, n) => p.screenshot({ path: `${__dirname}/${n}.png` });
const amt = process.argv[2] || '10';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const app = await ctx.newPage();
  let log = false;
  app.on('console', (m) => { if (m.type() === 'error') console.log('[APP.error]', m.text().slice(0, 600)); });
  app.on('requestfailed', (r) => { if (!/coinbase|amplitude|datadog|fun\.xyz/.test(r.url())) console.log('[APP REQFAILED]', r.method(), r.url().slice(0, 150), r.failure()?.errorText); });
  app.on('request', (r) => { if (log && r.method() === 'POST' && !/aave\.com\/api\/rpc|graphql|fun\.xyz|datadog|amplitude|coinbase|sentry/.test(r.url())) console.log('[APP POST]', r.url().slice(0, 120), (r.postData() || '').slice(0, 200)); });
  app.on('response', (r) => { if (log && r.status() >= 400) console.log('[APP HTTP ' + r.status() + ']', r.url().slice(0, 150)); });
  await app.goto('https://app.aave.com/?marketName=proto_mainnet_v3', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await app.waitForTimeout(6000);
  let b = app.getByRole('button', { name: 'Opt-out' }); if (await b.count()) await b.click();
  await app.getByRole('button', { name: /connect wallet/i }).first().click();
  await app.waitForTimeout(2000);
  await app.getByRole('button', { name: 'Other Wallets' }).click();
  await app.waitForTimeout(4000);
  await app.getByRole('button', { name: 'Copy to Clipboard' }).click();
  const uri = await app.evaluate(() => navigator.clipboard.readText());
  console.log('URI', uri.slice(0, 60));

  const imp = await ctx.newPage();
  imp.on('console', (m) => { if (m.type() === 'error') console.log('[IMP.error]', m.text().slice(0, 300)); });
  await imp.goto('https://impersonator.xyz/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await imp.waitForTimeout(4000);
  await imp.getByPlaceholder('vitalik.eth').fill(ADDR);
  await imp.getByPlaceholder('wc:xyz123').fill(uri);
  await imp.waitForTimeout(1000);
  await imp.getByRole('button', { name: 'Connect' }).click();
  await imp.waitForTimeout(12000);
  await shot(imp, 'wcf-imp1');
  await app.bringToFront();
  await app.waitForTimeout(8000);
  await shot(app, 'wcf-01');
  log = true;
  // dump WC session namespaces
  const sess = await app.evaluate(async () => {
    const dbs = await indexedDB.databases();
    const out = { dbs };
    for (const d of dbs) {
      const db = await new Promise((res, rej) => { const r = indexedDB.open(d.name); r.onsuccess = () => res(r.result); r.onerror = rej; });
      for (const st of db.objectStoreNames) {
        const tx = db.transaction(st); const os = tx.objectStore(st);
        const keys = await new Promise(r => { const q = os.getAllKeys(); q.onsuccess = () => r(q.result); });
        for (const k of keys) if (/session/.test(String(k))) { const v = await new Promise(r => { const q = os.get(k); q.onsuccess = () => r(q.result); }); out[d.name + '/' + k] = v; }
      }
    }
    return out; });
  require('fs').writeFileSync(__dirname + '/session.json', JSON.stringify(sess, null, 1)); if (process.argv[4]==='stop') { await browser.close(); return; }
  await app.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('WALLET_CONNECT_V2_INDEXED_DB'); r.onsuccess = () => res(r.result); r.onerror = rej; });
    const st = db.objectStoreNames[0];
    const k = 'wc@2:client:0.3:session';
    const raw = await new Promise(r => { const q = db.transaction(st).objectStore(st).get(k); q.onsuccess = () => r(q.result); });
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    for (const s of arr) s.namespaces.eip155.methods = s.optionalNamespaces.eip155.methods.filter(m => !m.startsWith('wallet_sendCalls') && !m.startsWith('wallet_getCap'));
    await new Promise(r => { const tx = db.transaction(st, 'readwrite'); tx.objectStore(st).put(typeof raw === 'string' ? JSON.stringify(arr) : arr, k); tx.oncomplete = r; });
  });
  console.log('patched session methods; reloading app');
  await app.reload({ waitUntil: 'domcontentloaded' });
  await app.waitForTimeout(12000);
  b = app.getByRole('button', { name: 'Opt-out' }); if (await b.count()) await b.click();
  await shot(app, 'wcf-reloaded');
  const mode = process.argv[3] || 'withdraw';
  console.log('=== CLICK', mode);
  if (mode === 'supply') { await app.getByRole('button', { name: /^Supply$/ }).first().click(); }
  else await app.getByRole('button', { name: /^Withdraw$/ }).first().click();
  await app.waitForTimeout(4000);
  if (amt === 'max') await app.getByText('Max', { exact: true }).first().click();
  else await app.getByPlaceholder('0.00').first().fill(amt);
  await app.waitForTimeout(8000);
  console.log('=== CLICK ACTION');
  await app.getByRole('button', { name: mode==='supply' ? /^Supply ETH/i : /Withdraw USDC/i }).last().click();
  await app.waitForTimeout(25000);
  await shot(app, 'wcf-02-' + amt);
  const cb = app.getByRole('button', { name: /Copy error text/i }); if (await cb.count()) { await cb.click(); console.log('ERRTEXT', (await app.evaluate(() => navigator.clipboard.readText())).slice(0, 1500)); }
  console.log('MODAL', (await app.locator('.MuiModal-root').last().innerText().catch(() => '?')).replace(/\n+/g, ' | '));
  await imp.bringToFront(); await imp.waitForTimeout(2000);
  await shot(imp, 'wcf-imp2');
  console.log('IMP', (await imp.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 1500));
  await browser.close();
})();
