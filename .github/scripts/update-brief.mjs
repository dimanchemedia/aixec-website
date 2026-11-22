// Keeps the hero phone mockup on the latest published brief.
//
// 1. Reads the Ghost RSS feed and takes the newest article.
// 2. If the hero already shows it, stops (unless FORCE=true).
// 3. Captures the article as an iPhone (390 px wide, 3x) with headless Chrome.
// 4. Saves assets/img/brief-screen.webp and updates the link / labels in index.html.
//
// Usage: node .github/scripts/update-brief.mjs
// Env:   CHROME_PATH (default: macOS Chrome), FORCE=true to recapture anyway.

import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RSS = 'https://brief.aiexecutivemedia.com/rss/';
const HTML = 'index.html';
const SCREEN = 'assets/img/brief-screen.webp';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FORCE = process.env.FORCE === 'true';

const setOutput = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// ---------- 1. Latest brief from RSS ----------
const xml = await (await fetch(RSS, { headers: { 'cache-control': 'no-cache' } })).text();
const item = xml.split('<item>')[1];
if (!item) throw new Error('No <item> found in RSS feed');
const pick = (tag) => {
  const m = item.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
  if (!m) throw new Error(`Missing <${tag}> in RSS item`);
  return decode(m[1].trim());
};
const title = pick('title');
const link = pick('link');
const published = new Date(pick('pubDate'));
// "19 Nov 2026" in Paris time (fixed month names: Intl's en-GB would give "Sept")
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const [y, mo, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(published).split('-');
const isoDate = `${y}-${mo}-${d}`;
const label = `${Number(d)} ${MONTHS[Number(mo) - 1]} ${y}`;
const slug = new URL(link).pathname.replace(/^\/|\/$/g, '');
console.log(`Latest brief: ${title}\n  ${link}\n  published ${label}`);

// ---------- 2. Already up to date? ----------
let html = readFileSync(HTML, 'utf8');
const dateRe = /<time class="device-chip__date" datetime="[^"]*">[^<]*<\/time>/;
const dateTag = `<time class="device-chip__date" datetime="${isoDate}">${label}</time>`;
const current = (html.match(/class="phone" href="([^"]+)"/) || [])[1];
if (current === link && !FORCE) {
  // same brief: still keep the badge date in sync (e.g. if the post date was edited in Ghost)
  if (dateRe.test(html) && !html.includes(dateTag)) {
    writeFileSync(HTML, html.replace(dateRe, dateTag));
    console.log(`Badge date updated to ${label}.`);
    setOutput('changed', 'true');
    setOutput('title', title.replace(/\n/g, ' '));
    process.exit(0);
  }
  console.log('Hero already shows this brief — nothing to do.');
  setOutput('changed', 'false');
  process.exit(0);
}

// ---------- 3. Capture as an iPhone via the DevTools protocol ----------
const profile = mkdtempSync(join(tmpdir(), 'brief-chrome-'));
const png = join(profile, 'brief.png');
const args = ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank'];
if (process.platform === 'linux') args.unshift('--no-sandbox');
const chrome = spawn(CHROME, args, { stdio: 'ignore' });

try {
  let ws;
  for (let i = 0; i < 80 && !ws; i++) {
    try {
      const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch { /* Chrome still starting */ }
    if (!ws) await sleep(250);
  }
  if (!ws) throw new Error('Could not connect to headless Chrome');
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let id = 0;
  const pending = new Map();
  const events = new Set();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); }
    else if (d.method) events.add(d.method);
  };
  const send = (method, params = {}) => new Promise((r) => {
    const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
  });

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 2400, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  // Ghost's theme follows the OS colour scheme: always capture the dark version to match the site
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  await send('Page.navigate', { url: link });
  for (let i = 0; i < 120 && !events.has('Page.loadEventFired'); i++) await sleep(250);
  await sleep(4000); // let fonts and images settle
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(png, Buffer.from(data, 'base64'));
  ws.close();
} finally {
  chrome.kill();
}

// ---------- 4. Optimise and update the page ----------
execFileSync('cwebp', ['-quiet', '-q', '78', '-resize', '780', '0', png, '-o', SCREEN]);
rmSync(profile, { recursive: true, force: true });

const t = attr(title);
const replace = (re, to, label) => {
  if (!re.test(html)) throw new Error(`Marker not found in index.html: ${label}`);
  html = html.replace(re, to);
};
replace(/class="phone" href="[^"]+"/, `class="phone" href="${attr(link)}"`, 'phone link');
replace(/aria-label="Read the brief: [^"]*"/, `aria-label="Read the brief: ${t}"`, 'phone aria-label');
replace(/alt="The AI Executive brief “[^”]*” shown on a phone"/, `alt="The AI Executive brief “${t}” shown on a phone"`, 'screen alt');
replace(dateRe, dateTag, 'badge date');
// cache-bust the screenshot so visitors get the new one
html = html.replace(/assets\/img\/brief-screen\.webp(\?v=[^"]*)?/g, `assets/img/brief-screen.webp?v=${encodeURIComponent(slug)}`);
writeFileSync(HTML, html);

console.log('Hero updated.');
setOutput('changed', 'true');
setOutput('title', title.replace(/\n/g, ' '));
