const B = require('../engine/blip-engine.js'), L = require('../engine/blip-listen.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const SR = 16000;
const speech = require('./speech-synth.js');
function run(buf, interp) {
  const ls = L.createListener({ sr: SR }), got = []; ls.on('utterance', u => got.push(u));
  for (let i = 0; i < buf.length; i += 1600) ls.push(buf.slice(i, i + 1600));
  return got;
}
// 1. silence and noise alone produce nothing
ok(run(speech({ dur: 0, lead: 1, tail: 2 })).length === 0, 'silence + room noise: no utterance');
// 2. one utterance is found, with sane summary
const u1 = run(speech({ f0: p => 150 + 80 * p, syll: 4 }));
ok(u1.length === 1, 'one utterance found');
const s1 = u1[0] && u1[0].summary;
ok(s1 && Math.abs(s1.pitch_mean_hz - 190) / 190 < .08, 'pitch mean ~190 Hz (got ' + (s1 && s1.pitch_mean_hz) + ')');
ok(s1 && s1.contour === 'rise', 'rising contour detected (got ' + (s1 && s1.contour) + ')');
ok(s1 && s1.dur_ms > 1000 && s1.dur_ms < 1800, 'duration plausible (' + (s1 && s1.dur_ms) + ' ms)');
ok(s1 && s1.rate_per_s >= 1.5 && s1.rate_per_s <= 3, 'syllable rate plausible (' + (s1 && s1.rate_per_s) + '/s for 2 pulses/s input)');
const fall = run(speech({ f0: p => 230 - 80 * p }))[0]; ok(fall && fall.summary.contour === 'fall', 'falling contour detected');
// 3. two utterances separated by silence stay separate
const two = Float32Array.from([...speech({ tail: .9 }), ...speech({ lead: .1, tail: 1, seed: 2 })]); ok(run(two).length === 2, 'two utterances, separated');
// 4. arousal: after a calm baseline, a louder/higher/faster one reads as more aroused, and vice versa
const pi = L.prosodyInterpreter();
for (let k = 0; k < 6; k++) pi(run(speech({ f0: p => 140 + 10 * p, syll: 3, amp: .12, seed: 10 + k }))[0]);
const hot = pi(run(speech({ f0: p => 220 + 70 * Math.sin(p * 6), syll: 6, amp: .5, seed: 30 }))[0]);
const cold = pi(run(speech({ f0: p => 120, syll: 2, amp: .05, seed: 31 }))[0]);
ok(hot.a > .3 && cold.a < -.2, `arousal separates (hot ${hot.a.toFixed(2)}, cold ${cold.a.toFixed(2)})`);
ok(hot.cv <= .15 && hot.ca > .3, 'valence is reported as weak, arousal as stronger (cv ' + hot.cv + ', ca ' + hot.ca.toFixed(2) + ')');
// 5. fuse trusts the confident source
const f = L.fuse([hot, L.lexiconInterpreter('thanks, that is great!')]);
ok(f.v > .3 && f.cv > hot.cv, 'text adds valence the voice could not give (v ' + f.v.toFixed(2) + ')');
ok(L.lexiconInterpreter('I hate this, it is terrible').v < -.5, 'lexicon: negative words read negative');
ok(L.parseLLM('sure: {"valence":-0.6,"arousal":0.7,"confidence":0.9} ok').v === -.6 && L.parseLLM('no json') === null, 'LLM reply parser');
// 6. temperament: the same moment, different characters, different reactions
const R = seed => B.rng(seed), kinds = Object.keys(L.SIM);
const hist = (arch, kind, n = 300) => { const h = {}; for (let i = 0; i < n; i++) { const br = L.createBrain({ temperament: L.temperamentFor(arch), rng: R(i * 17 + 3) }), u = L.fakeUtterance(kind), d = br.onUtterance({ summary: u.summary }, u.affect, 100000 + i); h[d.mode] = (h[d.mode] || 0) + 1 / n; } return h; };
const top = h => Object.entries(h).sort((a, b) => b[1] - a[1])[0];
ok(Object.keys(L.ARCH_TEMPER).length === 12 && Object.keys(L.ARCH_TEMPER).every(a => { const t = L.temperamentFor(a); return Object.keys(L.TEMPER_DEFAULT).every(k => k in t); }), 'twelve archetype temperaments, all complete');
ok(L.fixTemperament({ chatty: 9, moodV: -7, junk: 1 }).chatty === 1 && L.fixTemperament({ moodV: -7 }).moodV === -1, 'temperament values are clamped');
const hc = hist('Caregiver', 'sad'), hr = hist('Rebel', 'sad');
ok((hc.soothe || 0) > .4 && (hc.soothe || 0) > 2 * (hr.soothe || 0), `sad user: Caregiver soothes (${Math.round(100 * (hc.soothe || 0))}%), Rebel rarely does (${Math.round(100 * (hr.soothe || 0))}%)`);
const ra = hist('Rebel', 'angry'), ca = hist('Caregiver', 'angry'), sa = hist('Sage', 'angry');
ok(((ra.complain || 0) + (ra.contradict || 0)) > .35 && ((ca.complain || 0) + (ca.contradict || 0)) < .15, `angry user: Rebel pushes back (${Math.round(100 * ((ra.complain || 0) + (ra.contradict || 0)))}%), Caregiver does not (${Math.round(100 * ((ca.complain || 0) + (ca.contradict || 0)))}%)`);
ok((ca.soothe || 0) > .3, 'angry user: Caregiver de-escalates (' + Math.round(100 * (ca.soothe || 0)) + '%)');
const jh = hist('Jester', 'happy'), sh = hist('Sage', 'happy');
ok((jh.tease || 0) > .25 && (jh.tease || 0) > 3 * (sh.tease || 0), 'happy user: Jester teases (' + Math.round(100 * (jh.tease || 0)) + '%), Sage hardly (' + Math.round(100 * (sh.tease || 0)) + '%)');
ok((sh.silent || 0) > (jh.silent || 0) + .15, 'Sage stays quiet more often than Jester (' + Math.round(100 * (sh.silent || 0)) + '% vs ' + Math.round(100 * (jh.silent || 0)) + '%)');
const qh = hist('Explorer', 'question'); ok((qh.perk || 0) > .3, 'questions make an Explorer perk up (' + Math.round(100 * (qh.perk || 0)) + '%)');
// fingerprint: every pair of archetypes reacts measurably differently across all kinds
{ const names = Object.keys(L.ARCH_TEMPER), fp = names.map(a => kinds.flatMap(k => { const h = hist(a, k, 120); return L.MODES.map(m => h[m] || 0); })); let min = 9, pr = '';
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) { const d = fp[i].reduce((s, v, k) => s + Math.abs(v - fp[j][k]), 0) / kinds.length; if (d < min) { min = d; pr = names[i] + '/' + names[j]; } }
  ok(min > .15, 'all 12 archetypes react differently; closest pair ' + pr + ' (difference ' + min.toFixed(2) + ' of 2.0)'); }
// taste moves the bond: a Caregiver likes calm voices and dislikes shouting
{ const mk = () => L.createBrain({ temperament: L.temperamentFor('Caregiver'), rng: R(1) }); const b1 = mk(), b2 = mk(); for (let i = 0; i < 12; i++) { let u = L.fakeUtterance('calm'); b1.onUtterance({ summary: u.summary }, u.affect, 1e5 + i * 9000); u = L.fakeUtterance('shout'); b2.onUtterance({ summary: u.summary }, u.affect, 1e5 + i * 9000); }
  ok(b1.bond() > .15 && b2.bond() < b1.bond() - .2, `bond: calm voice ${b1.bond().toFixed(2)}, shouting ${b2.bond().toFixed(2)}`); }
// the wizard: options set the numbers
{ let t = L.temperamentFor('Sage'); t = L.applyTrait(t, 'upset', 3); ok(t.complain > .7 && t.empathy < .3, 'wizard: "Snaps back" makes it complain'); t = L.applyTrait(t, 'taste', 1); ok(t.like.energy > .5, 'wizard: taste sets what it likes in your voice'); }
// a long ramble tires an impatient character more than a short remark does
{ const rate = kind => { let c = 0; for (let i = 0; i < 300; i++) { const br = L.createBrain({ temperament: Object.assign(L.temperamentFor('Rebel'), { patience: .1 }), rng: R(i) }), u = L.fakeUtterance(kind), d = br.onUtterance({ summary: u.summary }, { ...u.affect, a: 0, v: 0, cv: 0 }, 1e5); if (d.mode === 'complain') c++; } return c / 300; };
  const rr = rate('ramble'), rh = rate('hello'); ok(rr > 1.5 * rh && rr > .15, `rambling irritates an impatient character (${Math.round(100 * rr)}% vs ${Math.round(100 * rh)}% for a short hello)`); }
const heard = { summary: { dur_ms: 1200, contour: 'flat' } }, aff = { v: 0, a: 0, cv: 0, ca: .3, detail: { p: 0, w: 0, l: 0, r: 0 } };
const bb = L.createBrain({ temperament: { chatty: 1, wild: 0 }, rng: () => .01 }); bb.onUtterance(heard, aff, 1000); ok(bb.onUtterance(heard, aff, 1500).why.includes('just spoke'), 'cooldown: it will not talk over itself');
const b3 = L.createBrain({ rng: () => .5 }); let m = null, tt = 0; while (!m && tt < 400000) { tt += 1000; m = b3.onIdle(tt); } ok(m && m.kind === 'murmur' && tt > 15000, 'idle murmur appears eventually (after ' + tt / 1000 + ' s)');
const sv = L.createBrain({ temperament: L.temperamentFor('Lover'), state: { moodV: .5, bond: .6 } }); ok(Math.abs(sv.bond() - .6) < 1e-9, 'a saved relationship is restored');
// every decision is explained and well-formed
{ let bad = 0; for (const a of Object.keys(L.ARCH_TEMPER)) for (const k of kinds) { const br = L.createBrain({ temperament: L.temperamentFor(a), rng: R(5) }), u = L.fakeUtterance(k), d = br.onUtterance({ summary: u.summary }, u.affect, 1e5); if (!(typeof d.why === 'string' && (d.kind === 'none' || (d.mimic >= 0 && d.mimic <= 1 && d.delay_ms >= 0)))) bad++; } ok(bad === 0, 'every decision is well-formed and explained'); }
// 7. mimic follows the speaker's contour at strength 1 and is the plain character at strength 0
const char = B.charFromJSON({ name: 'M', params: { chip: { mu: .9 } } });
const up = run(speech({ f0: p => 130 + 140 * p, syll: 4 }))[0], down = run(speech({ f0: p => 270 - 140 * p, syll: 4 }))[0];
const slope = s => { const n = s.notes.length, h = Math.floor(n / 2); const m1 = s.notes.slice(0, h).reduce((a, b) => a + Math.log2(b), 0) / h, m2 = s.notes.slice(n - h).reduce((a, b) => a + Math.log2(b), 0) / h; return m2 - m1; };
const mu_ = L.mimic({ heard: up, char, v: 0, a: 0, seed: 4, strength: 1 }), md = L.mimic({ heard: down, char, v: 0, a: 0, seed: 4, strength: 1 });
ok(slope(mu_) > .15 && slope(md) < -.15, `strength 1: rising speech -> rising phrase (${slope(mu_).toFixed(2)}), falling -> falling (${slope(md).toFixed(2)})`);
const plain = B.generate({ char, v: 0, a: 0, seed: 4 }); ok(JSON.stringify(L.mimic({ heard: up, char, v: 0, a: 0, seed: 4, strength: 0 }).notes) === JSON.stringify(plain.notes), 'strength 0 = the character\'s own phrase');
ok(B.toScore(mu_).events.length > 0 && B.renderScore(B.toScore(mu_), { sr: 8000 }).some(x => x !== 0), 'a mimicked phrase scores and renders like any other');
ok(L.mimic({ heard: up, char, v: 0, a: 0, seed: 4, strength: 1, len: 'short' }).notes.length <= 6, 'short backchannel stays short');
console.log(fails ? fails + ' FAILED' : 'listen: all checks passed'); process.exit(fails ? 1 : 0);
