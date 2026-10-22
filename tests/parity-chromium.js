// Renders the same sound two ways and compares them:
//   (a) the ORIGINAL Web Audio code in the old designer, through an OfflineAudioContext in headless Chromium
//   (b) this repo's plain-code synth
// Usage: node tests/parity-chromium.js path/to/old-designer.html
const { chromium } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const B = require('../engine/blip-engine.js');
const SR = 44100;
const cases = [
  { name: 'chip+drums', x: { chip: .9, drum: .4, kit: .5, noise: 0, drive: 0, vib: .2, gliss: .3 } },
  { name: 'flute+choir', x: { chip: 0, flute: .8, choir: .6, noise: 0, drive: 0, vib: .5, gliss: .6, bendA: .3 } },
  { name: 'piano+bass', x: { chip: 0, piano: .7, bass: .5, noise: 0, drive: 0, swing: .5 } },
  { name: 'trumpet gritty', x: { chip: 0, trump: .9, drive: .6, noise: 0, bendZ: .8 } },
  { name: 'noisy kit', x: { chip: .6, noise: .5, drive: .1, drum: .6, kit: .2 } },
];
function envelope(a, win) { const o = []; for (let i = 0; i + win <= a.length; i += win) { let s = 0; for (let j = 0; j < win; j++) s += a[i + j] ** 2; o.push(Math.sqrt(s / win)); } return o; }
function corr(a, b) { const n = Math.min(a.length, b.length); let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n; let s = 0, sa = 0, sb = 0; for (let i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return s / Math.sqrt(sa * sb || 1); }
const rmsAll = a => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
function centroid(a) { // zero-crossing based brightness proxy
  let z = 0; for (let i = 1; i < a.length; i++) if ((a[i - 1] < 0) !== (a[i] < 0)) z++; return z / a.length * SR / 2; }
(async () => {
  const file = process.argv[2];
  const br = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
  const pg = await br.newPage(); await pg.goto('file://' + require('path').resolve(file)); await pg.waitForTimeout(400);
  let worst = 1, rows = [];
  for (const [ci, c] of cases.entries()) {
    const x = B.fixX(Object.assign({ pitch: .5, len: .5, tempo: .5, pause: .3 }, c.x));
    const s = B.hydrate({ x, seed: 100 + ci, pa: 'any', sn: true, oc: 0, minN: 4, maxN: 12, qk: null });
    const sc = B.toScore(s), mine = B.renderScore(sc, { sr: SR });
    const theirs = await pg.evaluate(async ({ s, SR }) => {
      ctx = new OfflineAudioContext(1, SR * 8, SR); W2 = null; S.master = null; S.volv = 100;
      s.notes = s.notes.slice(); play(s);
      const buf = await ctx.startRendering(); ctx = null; S.master = null; W2 = null; return Array.from(buf.getChannelData(0));
    }, { s: JSON.parse(JSON.stringify(s)), SR });
    const t0 = Math.round(.05 * SR), ref = Float32Array.from(theirs.slice(t0)); // the old code starts 50 ms in
    const win = Math.round(SR * .02), ea = envelope(mine, win), eb = envelope(ref, win);
    const r = corr(ea, eb), dB = 20 * Math.log10(rmsAll(mine.slice(0, ref.length)) / (rmsAll(ref.slice(0, mine.length)) || 1e-9));
    rows.push({ case: c.name, env_corr: +r.toFixed(3), level_diff_dB: +dB.toFixed(1), zero_cross_hz_mine: Math.round(centroid(mine.slice(0, 3 * SR))), zero_cross_hz_ref: Math.round(centroid(ref.slice(0, 3 * SR))) });
    if (!/noisy/.test(c.name)) worst = Math.min(worst, r);
  }
  console.table(rows); await br.close();
  const bad = rows.filter(r => r.env_corr < .9 || Math.abs(r.level_diff_dB) > 3);
  console.log(bad.length ? 'PARITY FAIL: ' + bad.map(b => b.case).join(', ') : 'parity ok (env corr >= .9, level within 3 dB)');
  process.exit(bad.length ? 1 : 0);
})();
