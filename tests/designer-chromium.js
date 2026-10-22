// Drives the built designer (index.html) in headless Chromium: no page errors, sounds play, ratings learn,
// save/load round-trips, and the designer's sounds are identical to the engine's.
const { chromium } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const B = require('../engine/blip-engine.js'), path = require('path');
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const br = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const pg = await br.newPage(), errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|ERR_INTERNET|ERR_NAME/.test(m.text())) errs.push(m.text()); });
  await pg.goto('file://' + path.resolve(__dirname, '../index.html')); await pg.waitForTimeout(500);
  ok(errs.length === 0, 'loads with no errors ' + errs.join('|'));
  const r = await pg.evaluate(async () => {
    const o = {}; const B2 = c => { K.forEach(k => { c.mu[k] = +c.mu[k].toFixed(4); c.sd[k] = +c.sd[k].toFixed(4) }); c.gain = +c.gain.toFixed(3) };
    const c = mkChar('Test'); S.chars.push(c); S.cid = c.id; c.quirk.amt = 0; B2(c);
    const s1 = mkSound(c, .5, .3, 1234), s2 = mkSound(c, .5, .3, 1234);
    o.det = JSON.stringify(s1.notes) === JSON.stringify(s2.notes);
    o.s = JSON.parse(JSON.stringify({ sn: s1.sn, par: s1.pa, x: s1.x, notes: s1.notes, durs: s1.durs, seed: s1.seed }));
    o.char = JSON.parse(JSON.stringify(ser(c)));
    play(s1); o.playing = !!S.out && !!S.play; const first = S.out; play(s2); o.one = S.out !== first;
    await new Promise(r => setTimeout(r, 300));
    S.cur = s2; const n0 = c.n; rate(true); o.rated = c.n === n0 + 1;
    c.quirk.amt = 1; c.quirk.types.stutter = true; c.quirk.types.hiccup = true;
    const q1 = mkSound(c, .5, .3, 77); c.quirk.amt = 0; const q0 = mkSound(c, .5, .3, 77);
    o.quirk = JSON.stringify(q1.notes) !== JSON.stringify(q0.notes) || JSON.stringify(q1.rest) !== JSON.stringify(q0.rest);
    const p = JSON.parse(JSON.stringify(proj())); const nChars = S.chars.length; load(JSON.stringify(p)); o.roundtrip = S.chars.length >= 1 && p.format === 'blip-project';
    c.minN = 3; c.maxN = 5; const sh = mkSound(c, 0, 0, 5); o.range = sh.notes.length >= 3 && sh.notes.length <= 5;
    return o;
  });
  ok(r.det, 'same seed gives same notes'); ok(r.playing, 'play() starts a voice'); ok(r.one, 'a second play replaces the first');
  ok(r.rated, 'rating is counted'); ok(r.quirk, 'quirks change the phrase'); ok(r.roundtrip, 'project save/load round-trip'); ok(r.range, 'phrase length range respected');
  const c = B.charFromJSON(r.char), e = B.generate({ char: c, v: .5, a: .3, seed: 1234, sn: r.s.sn, par: r.s.par });
  const near = (p, q) => p.length === q.length && p.every((v, i) => Math.abs(v - q[i]) <= 1e-9 * Math.max(1, Math.abs(v)));
  ok(near(e.notes, r.s.notes) && near(e.durs, r.s.durs), 'designer sound == engine sound for the same character file');
  ok(errs.length === 0, 'no page errors after use ' + errs.join('|'));
  // archetype buttons set the dials
  const ar = await pg.evaluate(() => { startWizard(); S.wiz.step = 2; renderWizard(); const b = [...document.querySelectorAll('[data-pick^="jung:"]')], s = [...document.querySelectorAll('[data-pick^="snd:"]')]; const j = b.find(x => x.dataset.pick === 'jung:Jester'); j.click(); return { n: b.length, sn: s.length, swing: wchar().mu.swing, arch: wchar().arch }; });
  ok(ar.n === 12 && ar.sn === 11 && Math.abs(ar.swing - .8) < .06 && ar.arch === 'Jester', 'wizard step 2 offers 12 archetypes and 11 sound types; Jester sets swing near .8 (' + ar.n + ',' + ar.sn + ',' + ar.swing + ')');
  const tr = await pg.evaluate(() => { const c = wchar(); S.wiz.step = 3; renderWizard(); document.querySelector('.pchoice label[data-i="0"][data-idx="0"]').click(); const sel = document.querySelector('select.exc'); const had = !!sel && sel.options.length === 4; sel.value = '0'; sel.dispatchEvent(new Event('change', { bubbles: true })); return { had, exc: c.exc[0], sdt: c.sd.tempo, tempo: c.mu.tempo }; });
  ok(tr.had && tr.exc === 0 && tr.sdt >= .17, 'a trait answer offers three "except when" choices; picking one widens the spread (' + JSON.stringify(tr) + ')');
  const nm = await pg.evaluate(() => { const mk = n => { const c = mkChar(n, {}); c.setup = false; compose(c); return JSON.stringify(c.mu); }; return { a: mk('Zorbo') === mk('Zorbo'), b: mk('Zorbo') !== mk('Mimi') }; });
  ok(nm.a && nm.b, 'unspecified dials come from the name: same name same voice, different name different voice');
  const sh = await pg.evaluate(() => { const c = wchar(); S.wiz.step = 4; renderWizard(); const s = document.querySelector('select[data-short="temper"]'); s.value = '3'; s.dispatchEvent(new Event('change', { bubbles: true })); return { drive: c.mu.drive, n: document.querySelectorAll('[data-emo]').length, shorts: document.querySelectorAll('select.sh').length }; });
  ok(sh.drive > .6 && sh.n === 7 && sh.shorts === 4, 'step 4 has 4 shortcuts and 7 mood buttons; Aggressive raises distortion (' + JSON.stringify(sh) + ')');
  await pg.evaluate(() => { document.querySelector('[data-emo="Sad"]').click(); });
  ok(/Sad/.test(await pg.textContent('#wznow')) && /notes/.test(await pg.textContent('#wznow')), 'a mood button says what sound is being made');
  const rg = await pg.evaluate(() => { const c = wchar(); S.wiz.step = 4; renderWizard(); const d = document.querySelector('.dr[data-dr=sec]'), lo = d.querySelector('.lo'), hi = d.querySelector('.hi'); lo.value = 250; hi.value = 450; lo.dispatchEvent(new Event('change', { bubbles: true })); const T = []; for (let i = 1; i <= 30; i++) T.push(secs(c, i * 7919)); T.sort((a, b) => a - b); const sub = document.querySelectorAll('#wzsubs button').length; document.querySelector('[data-emo="Happy"]').click(); return { lenSec: c.lenSec, med: T[15], sub: document.querySelectorAll('#wzsubs button').length, now: document.getElementById('wznow').textContent, mode: wzHearMode() }; });
  ok(rg.lenSec && Math.abs(rg.med - (rg.lenSec[0] + rg.lenSec[1]) / 2) < 1.2, 'sentence-length slider in seconds: median close to the middle (' + JSON.stringify([rg.lenSec, +rg.med.toFixed(2)]) + ')');
  ok(rg.sub === 4 && /giddy|content|proud|relieved/i.test(rg.now), 'a mood shows four sub-moods and describes the one played: ' + rg.now.slice(0, 70));
  await pg.evaluate(() => { document.getElementById('wzhearb').click(); }); ok((await pg.evaluate(() => wzHearMode())) === 'off', 'hear-as-you-choose toggle turns preview off');
  ok(errs.length === 0, 'no page errors in the wizard ' + errs.join('|'));
  // exports: click the buttons and inspect the downloaded zips with Python's zipfile
  const fs = require('fs'), os = require('os'), cp = require('child_process');
  for (const [btn, want] of [['#xsnd', ['.wav', '.mid', '.score.json']], ['#xbank', ['bank.json', 'blip_bank.h', 'wav/', 'midi/']]]) {
    await pg.evaluate(() => { S.cur = S.cur || mkSound(C(), .3, .3, 99); }); await pg.evaluate(() => { const t = document.querySelector('#tabs .tab:last-child'); if (t) t.click(); });
    const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 20000 }).catch(() => null), pg.evaluate(b => document.querySelector(b).click(), btn)]);
    if (!d) { ok(false, btn + ' downloads a file'); continue; }
    const f = path.join(os.tmpdir(), 'x-' + d.suggestedFilename()); await d.saveAs(f);
    const out = String(cp.spawnSync('python3', ['-c', `import zipfile;z=zipfile.ZipFile('${f}');print(z.testzip());print('\\n'.join(z.namelist()))`]).stdout);
    ok(out.startsWith('None') && want.every(w => out.includes(w)), btn + ' zip is valid and holds ' + want.join(', ') + ' (' + d.suggestedFilename() + ')');
  }
  await br.close(); console.log(fails ? fails + ' FAILED' : 'all designer checks passed'); process.exit(fails ? 1 : 0);
})();
