// Runs the all-in-one app (halfblip.html) in headless Chromium: switching, Respond wizard, simulated situations, persistence, fake mic.
const { chromium } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const { execFileSync } = require('child_process'), path = require('path'), os = require('os');
const wav = path.join(os.tmpdir(), 'blip-fake-mic.wav'); execFileSync('node', [path.join(__dirname, 'speech-synth.js'), wav]);
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const br = await chromium.launch({ args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + wav, '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await br.newContext({ permissions: ['microphone'] }), pg = await ctx.newPage(), errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  const url = 'file://' + path.resolve(__dirname, '../halfblip.html');
  await pg.goto(url); await pg.waitForTimeout(400);
  const chips = await pg.$$('#hb-chars button'); ok(chips.length >= 2, 'dock lists characters: ' + chips.length);
  for (const v of ['studio', 'respond', 'listen', 'gallery']) { await pg.click(`#hb-nav [data-s=${v}]`); await pg.waitForTimeout(150); }
  await pg.click('#hb-nav [data-s=respond]'); await pg.waitForTimeout(200);
  const before = await pg.textContent('#rs-ui');
  await pg.click('#rs-ui .tp-q:nth-child(1) .tp-o:nth-child(4)'); await pg.waitForTimeout(150);
  ok(await pg.evaluate(() => /blip5/.test(localStorage.getItem('blip5') ? 'blip5' : '') && JSON.parse(localStorage.getItem('blip5')).chars.some(c => c.temperament)), 'wizard answer stored as temperament and saved');
  await pg.click('#rs-sim button >> nth=0'); await pg.waitForTimeout(300);
  ok((await pg.textContent('#view-respond')).includes('Why'), 'simulated situation shows a decision with a reason');
  await pg.click('#rs-30'); await pg.waitForTimeout(300); ok((await pg.textContent('#rs-hist')).length > 10, 'run 30x histogram filled');
  if (chips.length > 1) { const nm = await pg.textContent('#rs-name'); await pg.click('#hb-chars button >> nth=1'); await pg.waitForTimeout(200); ok(nm !== await pg.textContent('#rs-name'), 'switching character in the dock changes Respond page'); }
  await pg.reload(); await pg.waitForTimeout(400);
  ok(await pg.evaluate(() => JSON.parse(localStorage.getItem('blip5')).chars.some(c => c.temperament)), 'temperament survives reload');
  await pg.click('#hb-orbbtn'); await pg.waitForTimeout(9000);
  const log = await pg.evaluate(() => window.__hb.log());
  ok(log.some(l => /You/.test(l)), 'listening through the fake microphone logged: ' + (log[0] || '').slice(0, 60));
  ok(errs.length === 0, 'no page errors ' + errs.join('|'));
  await br.close(); console.log(fails ? fails + ' FAILED' : 'app: all checks passed'); process.exit(fails ? 1 : 0);
})();
