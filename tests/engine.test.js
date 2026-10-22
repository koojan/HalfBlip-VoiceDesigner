const B = require('../engine/blip-engine.js'), fs = require('fs'), os = require('os'), path = require('path');
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const char = B.charFromJSON({ name: 'Chirp', params: { pitch: { mu: .8 }, chip: { mu: .9 }, piano: { mu: .2 }, drum: { mu: .3 } }, quirk: { amt: .3, types: { stutter: true, squeak: true } } });
const g = (v, a, seed) => B.generate({ char, v, a, seed });

ok(JSON.stringify(g(.5, .3, 9).notes) === JSON.stringify(g(.5, .3, 9).notes), 'generate is deterministic');
ok(JSON.stringify(g(.5, .3, 9).notes) !== JSON.stringify(g(.5, .3, 10).notes), 'different seeds differ');
const sad = g(-.7, -.6, 3), exc = g(.7, .9, 3);
ok(B.sched(exc).T < B.sched(sad).T, 'excited is faster than sad (' + B.sched(exc).T.toFixed(2) + 's vs ' + B.sched(sad).T.toFixed(2) + 's)');

// score
const s = g(.8, .4, 21), sc = B.toScore(s);
ok(sc.format === 'blip-score' && sc.events.length === s.notes.length, 'score has one event per note');
ok(sc.events.every((e, i) => i === 0 || e.t >= sc.events[i - 1].t), 'events sorted by onset');
ok(sc.events.every(e => e.hz === null || e.k || (e.hz >= 50 && e.hz <= 3300)), 'pitches in range');
ok(JSON.stringify(JSON.parse(JSON.stringify(sc))) === JSON.stringify(sc), 'score survives JSON');

// render
const pcm = B.renderScore(sc, { sr: 22050 });
let pk = 0, e0 = 0; for (const x of pcm) { pk = Math.max(pk, Math.abs(x)); e0 += x * x; }
ok(pk > .05 && pk <= 1 && !pcm.some(x => !isFinite(x)), 'render is audible, finite, unclipped (peak ' + pk.toFixed(2) + ')');
ok(JSON.stringify(Array.from(B.renderScore(sc, { sr: 8000 }).slice(0, 2000))) === JSON.stringify(Array.from(B.renderScore(sc, { sr: 8000 }).slice(0, 2000))), 'render is deterministic');
ok(B.renderScore(sc, { sr: 8000 }).length < B.renderScore(sc, { sr: 22050 }).length, 'sample rate changes length');
const silence = B.renderScore(Object.assign({}, sc, { events: [] }), { sr: 8000 }); ok(silence.every(x => x === 0), 'empty score is silent');

// wav
const w = B.wav(pcm, 22050), back = B.readWav(w);
ok(String.fromCharCode(...w.slice(0, 4)) === 'RIFF' && back.sr === 22050 && back.samples.length === pcm.length, 'WAV header and length');
ok(Math.abs(back.samples[5000] - pcm[5000]) < 1e-3, 'WAV round-trips samples');

// midi: parse our own file back
function parseMidi(b) {
  const dv = new DataView(b.buffer); if (String.fromCharCode(...b.slice(0, 4)) !== 'MThd') throw 1;
  let p = 14; if (String.fromCharCode(...b.slice(p, p + 4)) !== 'MTrk') throw 2; const len = dv.getUint32(p + 4); p += 8; const end = p + len, ev = []; let t = 0, st = 0;
  while (p < end) { let d = 0, c; do { c = b[p++]; d = d << 7 | c & 127; } while (c & 128); t += d; let s = b[p]; if (s === 0xFF) { const ty = b[p + 1], n = b[p + 2]; p += 3 + n; ev.push({ t, meta: ty }); continue; } s = b[p++]; const hi = s & 0xF0; const n = hi === 0xC0 || hi === 0xD0 ? 1 : 2; ev.push({ t, s: hi, ch: s & 15, a: b[p], b: n > 1 ? b[p + 1] : 0 }); p += n; }
  return { ev, end: p === end };
}
const mid = parseMidi(B.midi(sc)), ons = mid.ev.filter(e => e.s === 0x90 || e.s === 0x99), offs = mid.ev.filter(e => e.s === 0x80 || e.s === 0x89);
ok(mid.end && mid.ev.some(e => e.meta === 0x2F), 'MIDI parses and ends with end-of-track');
ok(ons.length === sc.events.filter(e => e.hz !== null).length && ons.length === offs.length, 'MIDI has matching note on/off for every sounding event (' + ons.length + ')');
ok(ons.every(e => e.b >= 1 && e.b <= 127), 'MIDI velocities valid');

// tier A
const spans = B.tierA(sc); ok(spans.length === ons.length && spans.every(p => p[1] > p[0] && p[2] > 0), 'tierA: one span per sound, positive length');
ok(spans.every((p, i) => i === 0 || p[0] >= spans[i - 1][1] - 1), 'tierA: spans do not overlap (monophonic)');

// zip: check with Python's zipfile
const bank = B.bake(char, { per: 2, date: '2026-01-01T00:00:00Z' });
ok(bank.scores.length === 12 && bank.scores.every(x => x.score.events.length > 1), 'bake: 6 feelings x 2 scores');
const files = { 'a.txt': 'hello', 'bank.json': JSON.stringify(bank), 'x.wav': w.slice(0, 300) }, z = B.zip(files), zp = path.join(os.tmpdir(), 'blip-z.zip'); fs.writeFileSync(zp, z);
const py = require('child_process').spawnSync('python3', ['-c', `import zipfile,sys;z=zipfile.ZipFile('${zp}');print(z.testzip(),len(z.namelist()),z.read('a.txt').decode())`]);
ok(String(py.stdout).trim() === 'None 3 hello', 'zip is readable by Python (' + String(py.stdout).trim() + String(py.stderr).slice(0, 80) + ')');
const near = B.pick(bank, -.7, -.6, () => 0); ok(near.tags[0] === 'Sad', 'pick() finds the nearest feeling (' + near.tags[0] + ')');
ok(B.encodeN(sc).every(l => l.length <= 256 && /^N\+? /.test(l)), 'N lines fit in 256 bytes');
// learning: locked/off dials never move; a liked sound pulls its dial; a rejected one pushes away
{ const c = B.charFromJSON({ name: 'L' }); c.lock.pitch = true; c.off.vib = true; c.n = 0; c.b = 0; const s = B.generate({ char: c, v: 0, a: 0, seed: 5 }), before = { ...c.mu };
  B.learn(c, s, true, 1); ok(c.mu.pitch === before.pitch && c.mu.vib === before.vib && c.n === 1, 'learn: locked and off dials do not move');
  const k = B.K.find(k => !c.lock[k] && !c.off[k] && Math.abs(s.z[k]) > .5), up = c.mu[k] - before[k], c2 = B.charFromJSON({ name: 'L' }); c2.n = 0; c2.b = 0; B.learn(c2, s, false, 1);
  ok(Math.sign(up) === Math.sign(s.z[k]) && Math.sign(c2.mu[k] - before[k]) === -Math.sign(s.z[k]), 'learn: like moves toward the draw, nope moves away (' + k + ')'); }
// archetypes: twelve voices that really differ from each other
{ const names = Object.keys(B.ARCHETYPES), means = names.map(n => { const c = B.charFromJSON(B.fromArchetype(n)), vs = [1, 2, 3, 4, 5, 6].map(i => B.FEAT(B.generate({ char: c, v: 0, a: 0, seed: i * 31 })).v); return vs[0].map((_, j) => vs.reduce((a, v) => a + v[j], 0) / vs.length); });
  let min = 9, pair = ''; for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) { const d = Math.sqrt(means[i].reduce((a, v, k) => a + (v - means[j][k]) ** 2, 0) / means[i].length); if (d < min) { min = d; pair = names[i] + '/' + names[j]; } }
  ok(names.length === 12 && min > .03, 'archetypes: 12 voices, closest pair ' + pair + ' differs by ' + min.toFixed(3)); }
console.log(fails ? fails + ' FAILED' : 'engine: all checks passed'); process.exit(fails ? 1 : 0);
