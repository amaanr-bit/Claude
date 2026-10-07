const { chromium } = require('playwright');
const ADDR = '0x56957E411Ea83a0B4A0689C1fB0D1e5eA0d20149';
const RPC = 'https://ethereum-rpc.publicnode.com';
let window_log=false;
const shot = (p, n) => p.screenshot({ path: `${__dirname}/${n}.png` });
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--ignore-certificate-errors'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, ignoreHTTPSErrors: true });
  await ctx.exposeFunction('__rpc', async (method, params) => {
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    return JSON.stringify(await r.json());
  });
  await ctx.exposeFunction('__log', (s) => console.log('[WALLET]', s));
  await ctx.addInitScript(({ ADDR }) => {
    const listeners = {};
    const provider = {
      isMetaMask: true,
      on: (e, f) => { (listeners[e] ||= []).push(f); return provider; },
      removeListener: () => provider,
      request: async ({ method, params }) => {
        window.__log(method + ' ' + JSON.stringify(params || []).slice(0, 600));
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ADDR];
        if (method === 'eth_chainId') return '0x1';
        if (method === 'net_version') return '1';
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_requestPermissions' || method === 'wallet_revokePermissions') return null;
        if (method === 'wallet_getPermissions') return [{ parentCapability: 'eth_accounts' }];
        if (method === 'eth_sendTransaction') { window.__log('!!! SEND_TX REACHED WALLET'); throw Object.assign(new Error('User rejected (test harness)'), { code: 4001 }); }
        const r = JSON.parse(await window.__rpc(method, params || []));
        if (r.error) throw Object.assign(new Error(r.error.message), r.error);
        return r.result;
      },
    };
    window.ethereum = provider;
    const info = { uuid: 'b1f1c7a0-0000-4000-8000-000000000001', name: 'Impersonator', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', rdns: 'io.metamask' };
    const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
    window.addEventListener('eip6963:requestProvider', announce);
    announce();
  }, { ADDR });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('[CONSOLE.' + m.type() + ']', m.text().slice(0, 800)); });
  page.on('requestfailed', (r) => console.log('[REQFAILED]', r.method(), r.url().slice(0, 200), r.failure()?.errorText));
  page.on('response', (r) => { if (r.status() >= 400) console.log('[HTTP ' + r.status() + ']', r.request().method(), r.url().slice(0, 200)); });
  page.on('request', (r) => { if (window_log && /rpc-proxy/.test(r.url())) console.log('[REQ]', r.url().slice(0,120), (r.postData()||'').slice(0, 300)); });
  await page.goto('https://app.aave.com/?marketName=proto_mainnet_v3', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(8000);
  await shot(page, '01-home');

  const b = page.getByRole('button', { name: 'Opt-out' }); if (await b.count()) await b.click();
  console.log('=== CLICK WITHDRAW'); window_log=true;
  await page.getByRole('button', { name: /^Withdraw$/ }).first().click();
  await page.waitForTimeout(4000);
  await shot(page, '02-modal');
  const amt = process.argv[2] || '10';
  console.log('=== ENTER AMOUNT', amt);
  if (amt === 'max') await page.getByText('Max', { exact: true }).first().click();
  else await page.getByPlaceholder('0.00').first().fill(amt);
  await page.waitForTimeout(8000);
  await shot(page, '03-amount-' + amt);
  console.log('DIALOG TEXT', (await page.locator('.MuiModal-root').last().innerText().catch(e=>'?')).replace(/\n+/g,' | '));
  console.log('=== CLICK ACTION');
  await page.getByRole('button', { name: /Withdraw USDC/i }).last().click();
  await page.waitForTimeout(15000);
  await shot(page, '04-after-' + amt);
  console.log('DIALOG TEXT', (await page.locator('.MuiModal-root').last().innerText().catch(e=>'?')).replace(/\n+/g,' | '));
  await browser.close();
})();
