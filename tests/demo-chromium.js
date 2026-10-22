// Runs the Listen demo in headless Chromium with a fake microphone that plays tests/speech-synth.js output.
const { chromium } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const { execFileSync } = require('child_process'), path = require('path'), os = require('os');
const wav = path.join(os.tmpdir(), 'blip-fake-mic.wav'); execFileSync('node', [path.join(__dirname, 'speech-synth.js'), wav]);
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const br = await chromium.launch({ args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + wav, '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await br.newContext({ permissions: ['microphone'] }), pg = await ctx.newPage(), errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + path.resolve(__dirname, '../demo/listen.html')); await pg.waitForTimeout(300);
  await pg.click('#go'); await pg.waitForTimeout(9000);
  const log = await pg.evaluate(() => window.__blip.log()), heard = await pg.textContent('#heard'), dec = await pg.textContent('#dec');
  console.log(log.slice(0, 8).join('\n'));
  ok(errs.length === 0, 'no page errors ' + errs.join('|'));
  ok(log.some(l => /^[0-9:. APM]+ +You: /.test(l)), 'it heard an utterance through the microphone path');
  ok(/Pitch/.test(heard) && /Hz/.test(heard), 'heard panel filled: ' + heard.replace(/\s+/g, ' ').slice(0, 90));
  ok(dec.length > 20 && /Why/.test(dec), 'a decision with a reason is shown: ' + dec.slice(0, 80));
  const names = await pg.evaluate(() => window.__blip.chars());
  ok(names.length >= 13, 'character picker lists built-in and archetype characters: ' + names.length);
  await pg.click('#chars button:nth-child(8)'); await pg.click('#sim button[data-k=sad]'); await pg.waitForTimeout(200);
  ok(/Why/.test(await pg.textContent('#dec')), 'simulated situation gives a decision without a mic');
  await br.close(); console.log(fails ? fails + ' FAILED' : 'demo: all checks passed'); process.exit(fails ? 1 : 0);
})();
