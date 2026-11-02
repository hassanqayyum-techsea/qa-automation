// THROWAWAY SPIKE: proves server-side Playwright + live screencast. Not production code.
// Run: node server.mjs  → open http://localhost:4000
// Optional real login: TEST_EMAIL=... TEST_PASSWORD=... node server.mjs
import http from 'node:http';
import { chromium, devices } from 'playwright';

const URL_UNDER_TEST = process.env.TARGET_URL || 'https://app.aijobexpert.com';
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;
const clients = new Set();
let running = false;

const send = (event, data) => {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
};

// The test case. In the real app this comes from the Markdown file.
const steps = [
  { name: 'Open the app (lands on login)', run: (p) => p.goto(URL_UNDER_TEST, { waitUntil: 'networkidle' }) },
  { name: 'Type email', run: (p) => p.locator('#email').pressSequentially(EMAIL || 'demo.user@example.com', { delay: 60 }) },
  { name: 'Type password', run: (p) => p.locator('#password').pressSequentially(PASSWORD || 'not-a-real-password', { delay: 60 }) },
  { name: 'Tap SHOW to reveal password', run: (p) => p.getByRole('button', { name: 'SHOW' }).tap() },
  ...(EMAIL && PASSWORD
    ? [
        { name: 'Tap "Sign in"', run: (p) => p.getByRole('button', { name: 'Sign in' }).tap() },
        { name: 'Wait to leave /login', run: (p) => p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }) },
        { name: 'Scroll to bottom', run: (p) => p.mouse.wheel(0, 4000).then(() => p.waitForTimeout(1500)) },
        { name: 'Count links on page', run: async (p) => `found ${await p.locator('a:visible').count()} links` },
      ]
    : [{ name: 'Stop before submit (no TEST_EMAIL/TEST_PASSWORD set)', run: (p) => p.waitForTimeout(1500) }]),
];

async function runTest() {
  running = true;
  send('steps', steps.map((s) => s.name));
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ ...devices['iPhone 15'] });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
      send('frame', data);
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 393, maxHeight: 852 });

    for (const [i, step] of steps.entries()) {
      send('step', { i, status: 'running' });
      const t = Date.now();
      try {
        const out = await step.run(page);
        send('step', { i, status: 'passed', ms: Date.now() - t, note: typeof out === 'string' ? out : '' });
        await page.waitForTimeout(400); // let the viewer see the result of each step
      } catch (e) {
        send('step', { i, status: 'failed', ms: Date.now() - t, note: e.message.split('\n')[0] });
        break;
      }
    }
    await cdp.send('Page.stopScreencast').catch(() => {});
  } finally {
    await browser.close();
    running = false;
    send('done', {});
  }
}

http
  .createServer((req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.url === '/run' && req.method === 'POST') {
      if (!running) runTest().catch((e) => send('error', e.message));
      res.writeHead(202).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(PAGE);
  })
  .listen(process.env.PORT || 4000, () => console.log(`Live runner spike → http://localhost:${process.env.PORT || 4000}  (target: ${URL_UNDER_TEST}, login: ${EMAIL ? 'real' : 'demo, no submit'})`));

const PAGE = `<!doctype html><meta charset="utf-8"><title>Live runner spike</title>
<style>
body{font:14px system-ui;margin:24px;display:flex;gap:32px;flex-wrap:wrap;background:#f6f7f9;color:#16202c}
.phone{width:393px;min-height:659px;border:10px solid #16202c;border-radius:44px;overflow:hidden;background:#fff}
.phone img{width:100%;display:block}
ol{padding-left:0;list-style:none;display:grid;gap:8px;min-width:320px}
li{padding:8px 12px;border-radius:8px;background:#fff;border:1px solid #d5dbe3}
li.running{border-color:#2563eb;background:#eff6ff} li.passed{border-color:#0b6e4f} li.failed{border-color:#b91c1c;background:#fef2f2}
li small{display:block;color:#5a6676}
button{font:inherit;padding:10px 18px;border-radius:8px;border:0;background:#0b6e4f;color:#fff;cursor:pointer}
button:disabled{opacity:.5}
</style>
<div class="phone"><img id="screen" alt="Live view of the test browser"></div>
<div><h2>Test: Login screen (iPhone 15)</h2><p><button id="play">▶ Run test</button></p><ol id="steps"></ol></div>
<script>
const $ = (id) => document.getElementById(id); // not bare ids: window.screen is a built-in and shadows id="screen"
const es = new EventSource('/events'), img = $('screen'), list = $('steps'), btn = $('play');
const icon = {running:'▶',passed:'✓',failed:'✗'};
btn.onclick = () => { btn.disabled = true; fetch('/run', {method:'POST'}); };
es.addEventListener('frame', e => img.src = 'data:image/jpeg;base64,' + JSON.parse(e.data));
let names = [];
es.addEventListener('steps', e => { names = JSON.parse(e.data); list.innerHTML = names.map(n => '<li>○ ' + n + '</li>').join(''); });
es.addEventListener('step', e => { const s = JSON.parse(e.data), li = list.children[s.i];
  li.className = s.status; li.textContent = icon[s.status] + ' ' + names[s.i];
  if (s.ms) { const sm = document.createElement('small'); sm.textContent = s.ms + ' ms ' + (s.note || ''); li.append(sm); } });
es.addEventListener('done', () => btn.disabled = false);
</script>`;
