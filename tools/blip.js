#!/usr/bin/env node
/* blip: command-line tool around the engine. No dependencies.
 *   node tools/blip.js new    <Archetype> [--name Oracle] [--out oracle.json]   start a character from a Jungian archetype (or 'list')
 *   node tools/blip.js say    <character.json> [--feeling Happy|--v .5 --a .3] [--seed N] [--out x.wav] [--mid x.mid] [--score x.json]
 *   node tools/blip.js bake   <character.json> [--per 3] [--out dir] [--sr 22050] [--no-wav] [--labels A,B] [--char Name]
 *   node tools/blip.js header <bank.json> [--out blip_bank.h]            C header for the Tier A player
 *   node tools/blip.js golden <bank.json> [--out dir]                    Tier A tone timelines, for player conformance tests
 *   node tools/blip.js emit   <score.json>                               protocol N lines, pipe to a serial port
 *   node tools/blip.js listen <speech.wav> <character.json> [--strength .6] [--text "words"] [--out reply.wav]
 */
const fs = require('fs'), path = require('path'), B = require('../engine/blip-engine.js'), L = require('../engine/blip-listen.js');
const argv = process.argv.slice(2), cmd = argv.shift(), pos = [], opt = {};
for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) { const k = argv[i].slice(2); opt[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; } else pos.push(argv[i]); }
const J = f => JSON.parse(fs.readFileSync(f, 'utf8')), W = (f, d) => { fs.mkdirSync(path.dirname(path.resolve(f)), { recursive: true }); fs.writeFileSync(f, d); console.log('wrote', f); };
function loadChar(f) {
  const o = J(f); let c, labels = [];
  if (o.format === 'blip-project') {
    const ch = o.chars.find(x => !opt.char || x.name === opt.char) || o.chars[0]; if (!ch) throw new Error('no such character');
    c = B.charFromJSON(ch); labels = (o.labels || []).map((l, i) => B.fixL({ id: i + 1, ...l, on: opt.labels ? opt.labels.split(',').includes(l.n) : false }));
  } else if (o.format === 'blip-character') c = B.charFromJSON(o);
  else throw new Error('expected a blip-character or blip-project file');
  return { c, pulls: B.pullsOf(labels) };
}
const need = (x, m) => { if (!x) { console.error(m); process.exit(2); } };
const feel = () => { if (opt.feeling) { const e = B.EM[opt.feeling]; need(e, 'feelings: ' + Object.keys(B.EM).join(', ')); return e; } return [+(opt.v || 0), +(opt.a || 0)]; };

if (cmd === 'new') {
  if (!pos[0] || pos[0] === 'list') { for (const [n, a] of Object.entries(B.ARCHETYPES)) console.log(n.padEnd(10), a.blurb); process.exit(0); }
  const ch = B.fromArchetype(pos[0], { name: opt.name }); if (L.ARCH_TEMPER && !ch.temperament) ch.temperament = L.temperamentFor(ch.archetype || pos[0]); W(opt.out || B.slug(ch.name) + '.character.json', JSON.stringify(ch, null, 1));
} else if (cmd === 'say') {
  need(pos[0], 'usage: say <character.json>'); const { c, pulls } = loadChar(pos[0]), [v, a] = feel(), seed = +(opt.seed || c.seed);
  const s = B.generate({ char: c, v, a, seed, pulls }), sc = B.toScore(s, { id: 'say', voice: B.slug(c.name) }), sr = +(opt.sr || 44100);
  W(opt.out || 'say.wav', B.wav(B.renderScore(sc, { sr }), sr)); if (opt.mid) W(opt.mid, B.midi(sc)); if (opt.score) W(opt.score, JSON.stringify(sc, null, 1));
  console.log(`${s.notes.length} notes, ${sc.dur_ms} ms, feeling ${s.em}`);
} else if (cmd === 'bake') {
  need(pos[0], 'usage: bake <character.json>'); const { c, pulls } = loadChar(pos[0]), dir = opt.out || 'bank-' + B.slug(c.name), sr = +(opt.sr || 22050);
  const bank = B.bake(c, { per: +(opt.per || 3), pulls }), files = {};
  files['bank.json'] = JSON.stringify(bank, null, 1);
  for (const s of bank.scores) { files[`midi/${s.id}.mid`] = B.midi(s.score); if (!opt['no-wav']) files[`wav/${s.id}.wav`] = B.wav(B.renderScore(s.score, { sr }), sr); }
  files['blip_bank.h'] = B.cHeader(bank);
  for (const [n, d] of Object.entries(files)) W(path.join(dir, n), d);
  if (opt.zip) W(dir + '.zip', B.zip(files));
  console.log(`baked ${bank.scores.length} scores for ${c.name}`);
} else if (cmd === 'header') {
  need(pos[0], 'usage: header <bank.json>'); W(opt.out || 'blip_bank.h', B.cHeader(J(pos[0])));
} else if (cmd === 'golden') {
  need(pos[0], 'usage: golden <bank.json>'); const bank = J(pos[0]), dir = opt.out || 'golden';
  for (const oct of [0, -1, 1]) { let txt = ''; for (const s of bank.scores) for (const [a, b, hz] of B.tierA(s.score, { oct })) txt += `${s.id} ${a} ${b} ${hz}\n`; W(path.join(dir, `tierA-oct${oct}.txt`), txt); }
} else if (cmd === 'emit') {
  need(pos[0], 'usage: emit <score.json>'); const o = J(pos[0]); B.encodeN(o.format === 'blip-bank' ? o.scores[0].score : o).forEach(l => console.log(l));
} else if (cmd === 'listen') {
  need(pos[1], 'usage: listen <speech.wav> <character.json>'); const { c, pulls } = loadChar(pos[1]), { samples, sr } = B.readWav(new Uint8Array(fs.readFileSync(pos[0])));
  // resample to 16 kHz by averaging (crude but fine for prosody)
  const k = Math.max(1, Math.round(sr / 16000)), x = new Float32Array(Math.floor(samples.length / k)); for (let i = 0; i < x.length; i++) { let s = 0; for (let j = 0; j < k; j++) s += samples[i * k + j]; x[i] = s / k; }
  const ls = L.createListener({ sr: sr / k }), utts = []; ls.on('utterance', u => utts.push(u));
  for (let i = 0; i < x.length; i += 1600) ls.push(x.slice(i, i + 1600)); ls.push(new Float32Array(Math.round(sr / k * 1.2)));
  if (!utts.length) { console.log('no speech found'); process.exit(0); }
  const pi = L.prosodyInterpreter(), brain = L.createBrain({ rng: () => .01, temperament: L.fixTemperament(c.temperament || L.temperamentFor(c.archetype)), state: c.relationship });
  utts.forEach((u, i) => {
    const est = [pi(u)]; if (opt.text) est.push(L.lexiconInterpreter(opt.text)); const aff = L.fuse(est), d = brain.onUtterance({ summary: u.summary }, aff, 60000 * (i + 1));
    console.log(`utterance ${i + 1}:`, JSON.stringify(u.summary)); console.log('  heard feeling:', `valence ${aff.v.toFixed(2)} (sure ${aff.cv.toFixed(2)}), arousal ${aff.a.toFixed(2)} (sure ${aff.ca.toFixed(2)}) from ${aff.src.join('+')}`);
    console.log('  decision:', d.kind === 'reply' ? d.label : 'stays quiet', '-', d.why || '');
    if (d.kind === 'reply') {
      const s = L.mimic({ heard: u, char: c, v: d.v, a: d.a, seed: c.seed + i, strength: opt.strength === undefined ? d.mimic : +opt.strength, len: d.len, exaggerate: d.exaggerate, pulls }), sc = B.toScore(s, { id: 'reply-' + (i + 1) });
      const out = (opt.out || 'reply.wav').replace(/(\.wav)?$/, utts.length > 1 ? `-${i + 1}.wav` : '.wav'); W(out, B.wav(B.renderScore(sc, { sr: 22050 }), 22050)); W(out.replace(/\.wav$/, '.score.json'), JSON.stringify(sc, null, 1));
      B.encodeN(sc).forEach(l => console.log('  ' + l));
    }
  });
} else { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 10).join('\n')); }
