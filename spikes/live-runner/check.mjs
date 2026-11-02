// Repro: does the live <img> actually receive frames in a real browser?
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage();
p.on('pageerror', e => console.log('PAGE ERROR:', e.message));
await p.goto(process.env.URL || 'http://localhost:4000');
console.log('global `screen` is:', await p.evaluate(() => Object.prototype.toString.call(window.screen)));
await p.click('#play');
await p.waitForTimeout(8000);
const src = await p.$eval('#screen', el => el.src.slice(0, 30));
const steps = await p.$$eval('#steps li', l => l.map(x => x.className));
console.log('img src after 8s:', JSON.stringify(src));
console.log('step states:', steps.join(','));
await b.close();
process.exit(src.startsWith('data:image/jpeg') ? 0 : 1);
