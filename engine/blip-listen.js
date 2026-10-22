/* Blip listener: turns microphone audio into a rough sense of the situation, and the situation into a reply.
 *
 *   audio --Listener--> utterance (blip-heard summary + frames)
 *   utterance --interpreters--> affect { v, a, cv, ca }   (each source states how sure it is)
 *   affect + mood + personality --Brain--> decision { reply | murmur | none, target feeling, mimic strength }
 *   utterance + character --mimic--> a phrase that echoes the speaker's pitch contour and rhythm
 *
 * Honest limits are in docs/listener.md. In short: arousal (calm vs. energised) is readable from prosody;
 * valence (good vs. bad feeling) is mostly not, so it is reported with low confidence unless another
 * interpreter (text, an LLM, a camera) supplies it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./blip-engine.js'));
  else root.BlipListen = factory(root.Blip);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const cl = E.cl, st = hz => 12 * Math.log2(hz / 100);               // semitones above 100 Hz
  const pct = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + .5))]; };
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;

  // ------------------------------------------------------------ pitch (normalised autocorrelation)
  function pitch(buf, off, n, sr) {
    const lo = Math.floor(sr / 450), hi = Math.min(Math.floor(sr / 70), n - 2);
    let e0 = 0; for (let i = 0; i < n - hi; i++) e0 += buf[off + i] * buf[off + i];
    if (e0 < 1e-9) return { f0: 0, r: 0 };
    const r = new Float32Array(hi + 2);
    for (let l = lo - 1; l <= hi + 1; l++) {
      let s = 0, e1 = 0; const m = n - hi;
      for (let i = 0; i < m; i++) { const b = buf[off + i + l]; s += buf[off + i] * b; e1 += b * b; }
      r[l] = s / Math.sqrt(e0 * e1 + 1e-12);
    }
    let best = lo, bv = -1; for (let l = lo; l <= hi; l++) if (r[l] > bv) { bv = r[l]; best = l; }
    const half = Math.round(best / 2); if (half >= lo && r[half] > .9 * bv) { best = half; bv = r[half]; }
    const a = r[best - 1], b = r[best], c = r[best + 1], d = a - 2 * b + c, sh = d ? .5 * (a - c) / d : 0;
    return { f0: sr / (best + cl(sh, -1, 1)), r: bv };
  }

  // ------------------------------------------------------------ listener: frames -> utterances
  function createListener(o = {}) {
    const sr = o.sr || 16000, hop = Math.round(sr * .02), win = Math.round(sr * .04), hang = (o.hangMs || 500) / 20, minRms = o.minRms || .008, fk = o.floorFactor || 2.8;
    const h = { utterance: [], start: [], noise: [], frame: [] }; let buf = new Float32Array(0), floor = .005, run = 0, silent = 0, inUtt = false, frames = [], pre = [], t = 0, lastEnd = null;
    const emit = (k, x) => h[k].forEach(f => f(x));
    function frame(x, off) {
      let s = 0; for (let i = 0; i < hop; i++) s += x[off + i] * x[off + i]; const rms = Math.sqrt(s / hop);
      floor = rms < floor ? floor * .9 + rms * .1 : floor * 1.002;       // fast down, slow up: tracks room noise
      const speech = rms > Math.max(floor * fk, minRms);
      let f0 = 0; if (speech) { const p = pitch(x, off, win, sr); if (p.r > .5) f0 = p.f0; }
      const fr = { rms, f0, speech }; emit('frame', fr);
      if (!inUtt) {
        pre.push(fr); if (pre.length > 4) pre.shift(); run = speech ? run + 1 : 0;
        if (run >= 3) { inUtt = true; frames = pre.slice(); silent = 0; emit('start', { t_ms: t * 20 }); }
      } else {
        frames.push(fr); silent = speech ? 0 : silent + 1;
        if (silent >= hang) {
          const body = frames.slice(0, frames.length - silent + 3), voiced = body.filter(f => f.f0).length; inUtt = false; run = 0; pre = [];
          if (voiced >= 5) { lastEnd = t * 20; emit('utterance', { t_ms: (t - body.length) * 20, frames: body, summary: summarize(body) }); } else emit('noise', { frames: body });
        }
      }
      t++;
    }
    return {
      push(chunk) { const m = new Float32Array(buf.length + chunk.length); m.set(buf); m.set(chunk, buf.length); let p = 0; while (p + win <= m.length && p + hop <= m.length) { if (m.length - p < win) break; frame(m, p); p += hop; } buf = m.slice(p); },
      on(k, f) { h[k].push(f); return this; },
      get time_ms() { return t * 20; }, get lastEnd_ms() { return lastEnd; }, get noiseFloor() { return floor; },
    };
  }

  // blip-heard summary
  function summarize(frames) {
    const n = frames.length, v = frames.filter(f => f.f0), sp = frames.filter(f => f.speech);
    let a = frames.findIndex(f => f.speech), b = n - 1; while (b > 0 && !frames[b].speech) b--;
    const inner = a >= 0 ? frames.slice(a, b + 1) : [], gaps = inner.filter(f => !f.speech).length;
    const tr = v.map(f => st(f.f0)), rms = sp.map(f => f.rms);
    // syllable-ish rate: peaks of smoothed energy
    const sm = frames.map((f, i) => mean(frames.slice(Math.max(0, i - 1), i + 2).map(g => g.rms)));
    let peaks = 0, lastP = -9; const th = mean(rms) * .8;
    for (let i = 2; i < n - 2; i++) if (sm[i] > th && sm[i] >= sm[i - 1] && sm[i] > sm[i + 1] && sm[i] >= sm[i - 2] && sm[i] > sm[i + 2] && i - lastP >= 4) { peaks++; lastP = i; }
    const dur = n * .02, third = k => mean(tr.slice(Math.floor(k * tr.length / 3), Math.max(Math.floor(k * tr.length / 3) + 1, Math.floor((k + 1) * tr.length / 3))));
    let contour = 'flat';
    if (tr.length >= 6) {
      const d1 = third(1) - third(0), d2 = third(2) - third(1), T = 1.2;
      contour = d1 > T && d2 < -T ? 'rise-fall' : d1 < -T && d2 > T ? 'fall-rise' : third(2) - third(0) > T ? 'rise' : third(2) - third(0) < -T ? 'fall' : 'flat';
    }
    return {
      n_frames: n, dur_ms: Math.round(dur * 1000), voiced_ratio: +(v.length / n).toFixed(3), pause_ratio: +(inner.length ? gaps / inner.length : 0).toFixed(3),
      pitch_mean_hz: v.length ? +(100 * 2 ** (mean(tr) / 12)).toFixed(1) : 0, pitch_range_semitones: +(pct(tr, .9) - pct(tr, .1)).toFixed(2),
      rms_mean: +mean(rms).toFixed(4), rms_range: +(pct(rms, .9) - pct(rms, .1)).toFixed(4), rate_per_s: +(peaks / Math.max(.3, dur)).toFixed(2), contour,
    };
  }

  // ------------------------------------------------------------ interpreters (each says how sure it is)
  // contract: (heard, ctx) => { v, a, cv, ca, src }  (or a Promise of that). v, a in -1..1; cv, ca in 0..1.
  function prosodyInterpreter() {
    const prior = { pm: 170, rg: 4, rms: .05, rate: 3.5 }; let n = 0, base = { ...prior };
    const f = heard => {
      const s = heard.summary, vf = heard.frames ? heard.frames.filter(x => x.f0).length : 30;
      const z = [st(s.pitch_mean_hz || base.pm) - st(base.pm), (s.pitch_range_semitones - base.rg) / 1.5, Math.log(s.rms_mean / base.rms + 1e-6) / .6, (s.rate_per_s - base.rate) / 1.5];
      const A = Math.tanh(.8 * (.3 * z[0] / 2.5 + .2 * z[1] + .3 * z[2] + .2 * z[3]));
      const known = Math.min(1, n / 6), ca = (.15 + .55 * known) * Math.min(1, vf / 25);
      const rise = s.contour === 'rise' || s.contour === 'fall-rise', fall = s.contour === 'fall';
      const V = rise ? .15 : fall && A < 0 ? -.15 : 0;
      const out = { v: V, a: A, cv: V ? .12 : 0, ca, src: 'prosody', detail: { p: cl(z[0] / 2.5, -1, 1), w: cl(z[1] / 2, -1, 1), l: cl(z[2] / 1.5, -1, 1), r: cl(z[3] / 2, -1, 1) } };
      // learn this speaker's normal voice so "louder / higher / faster than usual" means something
      const al = n < 3 ? .5 : .15; n++;
      base = { pm: base.pm * (1 - al) + (s.pitch_mean_hz || base.pm) * al, rg: base.rg * (1 - al) + s.pitch_range_semitones * al, rms: base.rms * (1 - al) + s.rms_mean * al, rate: base.rate * (1 - al) + s.rate_per_s * al };
      return out;
    };
    f.baseline = () => ({ ...base, n });
    return f;
  }
  // A toy word list so you can see a text interpreter plugged in. Replace it with real speech-to-text + a real model.
  const POS = 'thanks thank great good love nice awesome happy yes wonderful cool well done hello hi hey friend'.split(' '), NEG = 'no bad hate stop sad angry wrong terrible shut ugh annoying broken die never'.split(' '), HOT = 'now hurry quick fast stop wow no yes go'.split(' ');
  function lexiconInterpreter(text) {
    const w = String(text || '').toLowerCase().match(/[a-z']+/g) || [], p = w.filter(x => POS.includes(x)).length, g = w.filter(x => NEG.includes(x)).length, h = w.filter(x => HOT.includes(x)).length + (String(text).match(/!/g) || []).length;
    const hits = p + g; return { v: hits ? cl((p - g) / hits, -1, 1) : 0, a: cl(h * .35 - .1, -1, 1), cv: Math.min(.6, .25 * hits), ca: h ? Math.min(.4, .15 * h) : 0, src: 'lexicon' };
  }
  const llmPrompt = (transcript, s) => `A person said to a small robot: "${transcript}". Their voice: ${s.pitch_mean_hz} Hz average, ${s.pitch_range_semitones} semitone range, rms ${s.rms_mean}, ${s.rate_per_s} syllables/s, contour ${s.contour}. ` +
    `Reply with only JSON: {"valence": -1..1, "arousal": -1..1, "confidence": 0..1} describing how they seem to feel.`;
  function parseLLM(text) {
    const m = String(text).match(/\{[^{}]*\}/); if (!m) return null;
    try { const j = JSON.parse(m[0]), c = cl(+j.confidence || .5); return { v: cl(+j.valence || 0, -1, 1), a: cl(+j.arousal || 0, -1, 1), cv: .8 * c, ca: .6 * c, src: 'llm' }; } catch (e) { return null; }
  }
  // combine whatever sources are available, trusting each by its own confidence
  function fuse(list) {
    let sv = 0, wv = 0, sa = 0, wa = 0, nv = 1, na = 1, detail = null; const src = [];
    for (const e of list) { if (!e) continue; sv += e.v * e.cv; wv += e.cv; sa += e.a * e.ca; wa += e.ca; nv *= 1 - e.cv; na *= 1 - e.ca; src.push(e.src); if (e.detail && !detail) detail = e.detail; }
    return { v: wv ? sv / wv : 0, a: wa ? sa / wa : 0, cv: 1 - nv, ca: 1 - na, src, detail: detail || { p: 0, w: 0, l: 0, r: 0 } };
  }

  // ------------------------------------------------------------ temperament: who this character is when someone talks to it
  // A character does not just echo you. It has moods, taste, a temper and a relationship with you. Everything below is plain
  // numbers (0..1 unless noted) so it can be designed, saved in the character file, and read by any client.
  const TEMPER_DEFAULT = {
    chatty: .55, mirror: .5, empathy: .5, echo: .45, curiosity: .5, tease: .2,        // how it joins in
    contrary: .15, complain: .2, sulk: .15, patience: .5,                              // how it pushes back
    moodV: .1, moodA: -.1, inertia: .6, reactivity: .5,                                // its own weather (moodV, moodA in -1..1)
    delay: .4, wild: .3,                                                               // timing and unpredictability
    like: { energy: 0, pitch: 0, pace: 0, loud: 0 },                                   // taste in your voice, -1 dislikes high, +1 likes high
  };
  const TKEYS = Object.keys(TEMPER_DEFAULT).filter(k => k !== 'like');
  const SIGNED = { moodV: 1, moodA: 1 };
  function fixTemperament(o) {
    const t = { like: {} }; o = o || {};
    TKEYS.forEach(k => { const v = +o[k]; t[k] = isFinite(v) && o[k] !== null && o[k] !== '' ? cl(v, SIGNED[k] ? -1 : 0, 1) : TEMPER_DEFAULT[k]; });
    Object.keys(TEMPER_DEFAULT.like).forEach(k => { const v = o.like && +o.like[k]; t.like[k] = isFinite(v) ? cl(v, -1, 1) : 0; });
    return t;
  }
  // starting temperaments for the twelve archetypes (each overrides the defaults)
  const L0 = (e, p, r, l) => ({ energy: e || 0, pitch: p || 0, pace: r || 0, loud: l || 0 });
  const ARCH_TEMPER = {
    Innocent: { chatty: .7, mirror: .7, empathy: .7, echo: .6, curiosity: .8, tease: .15, contrary: .02, complain: .05, sulk: .2, moodV: .5, moodA: .15, like: L0(.3, .3) },
    Everyman: { chatty: .5, mirror: .6, empathy: .6, echo: .4, curiosity: .5, tease: .2, contrary: .1, complain: .15, moodV: .2 },
    Hero: { chatty: .55, mirror: .5, empathy: .7, echo: .3, curiosity: .4, tease: .15, contrary: .25, complain: .2, sulk: .05, patience: .4, moodV: .3, moodA: .3, like: L0(.4, 0, 0, .2) },
    Caregiver: { chatty: .6, mirror: .45, empathy: .95, echo: .3, curiosity: .6, tease: .1, contrary: .02, complain: .05, sulk: .15, inertia: .7, moodV: .35, moodA: -.1, like: L0(-.4, 0, 0, -.5) },
    Explorer: { chatty: .65, mirror: .4, empathy: .4, echo: .5, curiosity: .95, tease: .3, contrary: .2, complain: .1, moodV: .3, moodA: .3, wild: .5 },
    Rebel: { chatty: .55, mirror: .25, empathy: .2, echo: .35, curiosity: .3, tease: .45, contrary: .75, complain: .65, sulk: .2, patience: .25, moodV: -.05, moodA: .25, wild: .6, like: L0(.4, 0, .3, .5) },
    Lover: { chatty: .55, mirror: .65, empathy: .8, echo: .6, curiosity: .5, tease: .4, contrary: .1, complain: .1, sulk: .45, inertia: .4, reactivity: .8, moodV: .3, like: L0(-.2, -.3, -.5) },
    Creator: { chatty: .6, mirror: .3, empathy: .4, echo: .7, curiosity: .8, tease: .35, contrary: .3, complain: .2, sulk: .1, moodV: .25, wild: .7 },
    Jester: { chatty: .85, mirror: .7, empathy: .4, echo: .85, curiosity: .6, tease: .85, contrary: .35, complain: .15, sulk: .1, patience: .3, moodV: .5, moodA: .45, wild: .7, like: L0(.6, .3, .5) },
    Sage: { chatty: .3, mirror: .15, empathy: .6, echo: .1, curiosity: .6, tease: .1, contrary: .35, complain: .2, sulk: .1, inertia: .85, patience: .85, delay: .8, moodV: .15, moodA: -.35, like: L0(-.4, 0, -.6, -.4) },
    Magician: { chatty: .45, mirror: .35, empathy: .45, echo: .5, curiosity: .7, tease: .35, contrary: .3, complain: .15, sulk: .2, moodV: .2, delay: .6, wild: .8 },
    Ruler: { chatty: .35, mirror: .1, empathy: .3, echo: .1, curiosity: .3, tease: .05, contrary: .6, complain: .6, sulk: .3, inertia: .8, patience: .35, delay: .7, moodV: 0, moodA: -.1, like: L0(-.3, 0, -.3, -.5) },
  };
  const temperamentFor = arch => fixTemperament(Object.assign({}, ARCH_TEMPER[arch] || {}));

  // The questions of the response wizard. Each option sets a few numbers; the sliders below the wizard fine-tune them.
  const TEMPER_TRAITS = [
    { id: 'upset', q: 'When you sound upset, it…', opts: [
      { label: 'Soothes you', over: { empathy: .9, contrary: .03, complain: .05, sulk: .1 } },
      { label: 'Feels it too', over: { mirror: .8, empathy: .6, sulk: .3 } },
      { label: 'Sulks', over: { sulk: .8, mirror: .35, empathy: .4 } },
      { label: 'Snaps back', over: { complain: .75, contrary: .55, empathy: .2 } }] },
    { id: 'excited', q: 'When you sound excited, it…', opts: [
      { label: 'Joins in', over: { mirror: .85, tease: .25 } },
      { label: 'Teases you', over: { tease: .85, mirror: .5, echo: .75 } },
      { label: 'Stays cool', over: { mirror: .15, contrary: .45 } },
      { label: 'Gets overwhelmed', over: { complain: .55, patience: .3 } }] },
    { id: 'talk', q: 'How talkative is it?', opts: [
      { label: 'Silent type', over: { chatty: .15, patience: .85, delay: .8 } },
      { label: 'Quiet', over: { chatty: .4, patience: .65, delay: .6 } },
      { label: 'Chatty', over: { chatty: .72, patience: .4, delay: .3 } },
      { label: 'Never stops', over: { chatty: .95, patience: .2, delay: .15 } }] },
    { id: 'echo', q: 'Does it copy how you talk?', opts: [
      { label: 'Never', over: { echo: 0 } }, { label: 'A little', over: { echo: .3 } },
      { label: 'Often', over: { echo: .65 } }, { label: 'Like a parrot', over: { echo: .95 } }] },
    { id: 'push', q: 'Does it ever disagree?', opts: [
      { label: 'Never', over: { contrary: 0, complain: .03 } }, { label: 'Gently', over: { contrary: .3, complain: .2 } },
      { label: 'Openly', over: { contrary: .6, complain: .5 } }, { label: 'Constantly', over: { contrary: .85, complain: .75 } }] },
    { id: 'mood', q: 'What is its own mood like?', opts: [
      { label: 'Sunny', over: { moodV: .55, moodA: .2, inertia: .6 } }, { label: 'Even', over: { moodV: .1, moodA: -.1, inertia: .6 } },
      { label: 'Moody', over: { moodV: 0, moodA: .05, inertia: .25, reactivity: .85, wild: .6 } }, { label: 'Gloomy', over: { moodV: -.35, moodA: -.3, inertia: .75 } }] },
    { id: 'taste', q: 'What does it like in your voice?', opts: [
      { label: 'Calm and soft', over: { like: { energy: -.7, loud: -.6, pitch: 0, pace: -.2 } } },
      { label: 'Lively and bright', over: { like: { energy: .7, pitch: .4, pace: .3, loud: .2 } } },
      { label: 'Slow and low', over: { like: { pace: -.7, pitch: -.6, energy: -.3, loud: -.2 } } },
      { label: 'Quick and high', over: { like: { pace: .7, pitch: .6, energy: .3, loud: 0 } } }] },
  ];
  function applyTrait(t, trait, optIndex) { const o = TEMPER_TRAITS.find(x => x.id === trait).opts[optIndex].over, n = fixTemperament(t); Object.keys(o).forEach(k => { if (k === 'like') Object.assign(n.like, o.like); else n[k] = o[k]; }); return n; }

  // ------------------------------------------------------------ brain: what to do about it
  // Each reaction mode gets a score from the character's temperament and what just happened; one is chosen (with some
  // randomness from "wild"), and `why` explains. Modes: match, soothe, cheer, tease, contradict, complain, sulk, perk,
  // backchannel, own (speaks from its own mood), silent.
  const MODES = ['match', 'soothe', 'cheer', 'tease', 'contradict', 'complain', 'sulk', 'perk', 'backchannel', 'own', 'silent'];
  const MODE_NAME = { match: 'Matches you', soothe: 'Soothes you', cheer: 'Cheers you up', tease: 'Teases you', contradict: 'Disagrees', complain: 'Grumbles', sulk: 'Sulks', perk: 'Perks up', backchannel: 'Quick reply', own: 'Says its own thing', silent: 'Stays quiet' };
  function createBrain(o = {}) {
    const T = fixTemperament(o.temperament), r = o.rng || Math.random, st0 = o.state || {};
    let mood = { v: cl(+st0.moodV, -1, 1) || T.moodV, a: cl(+st0.moodA, -1, 1) || T.moodA }, bond = cl(+st0.bond || 0, -1, 1);
    let lastSpeech = null, lastAct = -1e9, idleAt = null, unanswered = 0, recent = [];
    const fin = (v, a) => [cl(v * .75 + mood.v * .25, -1, 1), cl(a * .75 + mood.a * .25, -1, 1)];
    return {
      temperament: T, state: () => ({ moodV: +mood.v.toFixed(3), moodA: +mood.a.toFixed(3), bond: +bond.toFixed(3) }),
      mood: () => ({ ...mood }), bond: () => bond,
      // an utterance just ended at time `now` (ms). Returns a decision: { kind: 'reply'|'none', mode, v, a, mimic, ... }
      onUtterance(heard, affect, now) {
        const s = heard.summary, d = affect.detail || { p: 0, w: 0, l: 0, r: 0 }, uv = affect.v, ua = affect.a, cv = affect.cv, ca = affect.ca, why = {};
        const gap = lastSpeech === null ? 1e9 : now - lastSpeech; lastSpeech = now;
        const isQ = s.contour === 'rise' || s.contour === 'fall-rise', secs = (s.dur_ms || 0) / 1000, long = secs > 2 + 8 * T.patience, short = (s.dur_ms || 0) < 450;
        // taste: how much it likes how you sounded
        const L = T.like, lw = Math.abs(L.energy) + Math.abs(L.pitch) + Math.abs(L.pace) + Math.abs(L.loud);
        const pleasure = lw ? cl((L.energy * ua * ca + L.pitch * d.p + L.pace * d.r + L.loud * d.l) / Math.max(.6, lw) * 1.6, -1, 1) : 0;
        // its own mood and its feeling for you move, slowly
        const k = T.reactivity * (1 - T.inertia) + .06;
        mood.v += k * (cl(T.moodV + .5 * pleasure + .35 * uv * cv + .2 * bond, -1, 1) - mood.v);
        mood.a += k * (cl(T.moodA + T.mirror * ca * ua * .6, -1, 1) - mood.a);
        bond = cl((bond + .06 * pleasure + .04 * uv * cv) * .995, -1, 1);
        recent.push(ua * ca); if (recent.length > 4) recent.shift();
        const loudStreak = recent.length >= 3 && recent.slice(-3).every(x => x > .4);
        const upset = Math.max(0, -uv * cv) + .25 * Math.max(0, ua * ca - .6), neglect = Math.min(1, unanswered / 3);
        // reasons are collected as we score so the explanation matches the decision
        const sc = {}, rs = {}; const add = (m, w, text) => { if (w > .02) { sc[m] = (sc[m] || 0) + w; (rs[m] = rs[m] || []).push([w, text]); } };
        add('match', T.mirror * (.2 + .6 * ca) * (1 - .8 * upset), 'it likes to follow your energy');
        add('soothe', T.empathy * 2.2 * upset, 'you sounded upset and it cares');
        add('cheer', T.empathy * .7 * Math.max(0, -ua * ca - .3) * (mood.v > -.3 ? 1 : .3), 'you sounded low and it wants to lift you');
        add('tease', T.tease * (ua > -.3 && uv > -.1 ? .8 : .15) * (1 + Math.max(0, bond)) * (1 - upset), 'you sounded fine and it likes poking fun');
        add('perk', T.curiosity * (isQ ? 1.1 : .2), isQ ? 'that sounded like a question' : 'it is curious');
        add('contradict', T.contrary * 1.3 * (.15 + .5 * Math.abs(ua) * ca + (cv > .3 ? .35 * Math.abs(uv) : 0)), 'it tends to push the other way');
        add('complain', T.complain * 1.5 * (.5 * Math.max(0, ua * ca) + .6 * Math.max(0, -pleasure) + (long ? .45 : 0) + .3 * Math.max(0, -bond) + .3 * Math.max(0, -mood.v) + (loudStreak ? .4 : 0)),
          pleasure < -.15 ? 'it does not like how you sounded' : long ? 'you went on for a long time' : 'it is out of sorts');
        add('sulk', T.sulk * (.6 * upset + .6 * neglect + .3 * Math.max(0, -bond)), neglect > .3 ? 'you keep talking without it getting a word in' : 'it takes bad feeling to heart');
        add('backchannel', short || secs < .9 ? .55 * T.chatty : 0, 'short remark, short answer');
        add('own', (1 - T.mirror) * .45 + .12, 'it follows its own mood');
        add('silent', (1 - T.chatty) * .9 + (short ? .25 : 0) + (now - lastAct < 1200 ? 2 : 0), now - lastAct < 1200 ? 'it just spoke' : 'it is not much of a talker');
        if (pleasure > .3) rs.match && rs.match.push([pleasure * .3, 'it likes the way you sound']);
        const noise = .1 + T.wild * .3, names = Object.keys(sc), w = names.map(m => Math.exp(sc[m] / noise)), tot = w.reduce((a, b) => a + b, 0);
        let x = r() * tot, pick = names[names.length - 1]; for (let i = 0; i < names.length; i++) { x -= w[i]; if (x <= 0) { pick = names[i]; break; } }
        const reasons = (rs[pick] || []).sort((a, b) => b[0] - a[0]).slice(0, 2).map(a => a[1]);
        const scores = names.map(m => [m, +sc[m].toFixed(2)]).sort((a, b) => b[1] - a[1]);
        const base = { why: reasons.join('; '), scores, pleasure: +pleasure.toFixed(2), state: this.state() };
        if (pick === 'silent') { unanswered++; return { kind: 'none', mode: pick, ...base }; }
        unanswered = 0; lastAct = now;
        const echo = T.echo, bc = pick === 'backchannel';
        let v, a, mimic, exag = 2, len = bc ? 'short' : 'normal', tags = [], delay = 250 + 650 * T.delay * (.4 + r() * .6);
        if (pick === 'match') { v = uv * Math.max(.3, cv) + .1; a = ua * ca * .9; mimic = echo; }
        else if (pick === 'soothe') { v = .25 + .25 * T.empathy; a = Math.min(-.15, ua * ca * .3 - .3); mimic = echo * .3; tags = ['Calm', 'Tender']; }
        else if (pick === 'cheer') { v = .65; a = .45; mimic = echo * .3; tags = ['Playful']; }
        else if (pick === 'tease') { v = .5; a = .55; mimic = echo > .05 ? .85 : 0; exag = 3; tags = ['Playful', 'Teasing']; delay *= .5; }
        else if (pick === 'perk') { v = .15; a = .35; mimic = echo * .8; exag = 2.4; tags = ['Question']; }
        else if (pick === 'contradict') { v = -uv * .4 * Math.min(1, cv * 1.5); a = -ua * ca * .8; mimic = 0; tags = ['Disagree']; }
        else if (pick === 'complain') { v = -.55; a = .45; mimic = echo * .2; tags = ['Annoyed']; len = 'normal'; }
        else if (pick === 'sulk') { v = -.55; a = -.6; mimic = 0; len = 'short'; tags = ['Sad']; delay += 600; }
        else if (bc) { v = uv * cv * .6 + .1; a = ua * ca * .5; mimic = echo * .6; }
        else { v = mood.v; a = mood.a; mimic = 0; }
        if (isQ) tags.push('Question'); if (gap > 60000) tags.push('Greeting');
        [v, a] = fin(v, a);
        return { kind: 'reply', mode: pick, label: MODE_NAME[pick], v, a, tags, mimic: cl(mimic), exaggerate: exag, len, delay_ms: Math.round(delay), ...base };
      },
      // call about once a second while nothing is being said. Now and then it returns something to do on its own.
      onIdle(now) {
        if (now - lastAct < 15000) return null;
        if (idleAt === null) idleAt = now + (25000 + r() * 50000) / (.3 + T.chatty);
        if (now < idleAt) return null; idleAt = null; lastAct = now;
        mood.a += (T.moodA - mood.a) * .2;
        const lonely = T.sulk > .35 && unanswered === 0 && lastSpeech !== null && now - lastSpeech > 120000, fond = bond > .35 && T.curiosity > .4;
        const [v, a] = lonely ? fin(-.5, -.5) : fond ? fin(.3, .25) : fin(mood.v * .6, -.45 + .2 * r());
        return { kind: 'murmur', mode: lonely ? 'sulk' : fond ? 'perk' : 'own', label: lonely ? 'Misses you' : fond ? 'Wants attention' : 'Murmurs', v, a, tags: ['Idle chatter'], mimic: 0, exaggerate: 2, len: 'short', delay_ms: 0, why: lonely ? 'you have been quiet for a long while' : fond ? 'it is fond of you and curious' : 'quiet for a while', scores: [], state: this.state() };
      },
    };
  }

  // A fake utterance for trying reactions without a microphone. `kind` names a way someone might talk.
  const SIM = {
    happy: { dur: 1.4, f0: p => 190 + 40 * Math.sin(p * 9), rate: 4.2, rms: .08, v: .7, a: .4, d: { p: .3, w: .4, l: .2, r: .2 }, c: 'rise-fall' },
    excited: { dur: 1.6, f0: p => 230 + 60 * Math.sin(p * 14), rate: 6, rms: .16, v: .5, a: .85, d: { p: .7, w: .7, l: .7, r: .8 }, c: 'rise' },
    calm: { dur: 1.8, f0: p => 150 - 10 * p, rate: 2.4, rms: .035, v: .2, a: -.55, d: { p: -.3, w: -.5, l: -.6, r: -.6 }, c: 'flat' },
    sad: { dur: 1.7, f0: p => 140 - 25 * p, rate: 2, rms: .03, v: -.65, a: -.5, d: { p: -.5, w: -.6, l: -.7, r: -.7 }, c: 'fall' },
    angry: { dur: 1.3, f0: p => 200 + 30 * Math.sin(p * 20), rate: 5.2, rms: .22, v: -.7, a: .85, d: { p: .4, w: .5, l: .9, r: .6 }, c: 'flat' },
    question: { dur: 1.1, f0: p => 160 + 90 * p, rate: 4, rms: .07, v: .1, a: .2, d: { p: .2, w: .5, l: 0, r: .1 }, c: 'rise' },
    ramble: { dur: 6.5, f0: p => 165 + 25 * Math.sin(p * 30), rate: 4, rms: .06, v: 0, a: .1, d: { p: 0, w: .1, l: 0, r: .1 }, c: 'flat' },
    whisper: { dur: 1.2, f0: p => 170, rate: 3, rms: .012, v: 0, a: -.7, d: { p: -.1, w: -.6, l: -.9, r: -.3 }, c: 'flat' },
    shout: { dur: .8, f0: p => 260 - 40 * p, rate: 3, rms: .3, v: -.2, a: .95, d: { p: .8, w: .6, l: 1, r: .4 }, c: 'fall' },
    hello: { dur: .9, f0: p => 180 + 50 * Math.sin(p * 5), rate: 3, rms: .07, v: .4, a: .2, d: { p: .2, w: .3, l: .1, r: 0 }, c: 'rise-fall' },
  };
  function fakeUtterance(kind, o = {}) {
    const k = SIM[kind]; if (!k) throw new Error('kinds: ' + Object.keys(SIM).join(', '));
    const n = Math.round(k.dur / .02), frames = [], per = 50 / k.rate; // frames per syllable
    for (let i = 0; i < n; i++) { const ph = i / n, pulse = Math.pow(Math.max(0, Math.sin(Math.PI * i / per)), .6), sp = pulse > .12; frames.push({ rms: sp ? k.rms * (.5 + pulse * .6) : .002, f0: sp ? k.f0(ph) : 0, speech: sp }); }
    const tr = frames.filter(f => f.f0).map(f => st(f.f0)), sp = frames.filter(f => f.speech);
    const summary = { n_frames: n, dur_ms: Math.round(k.dur * 1000), voiced_ratio: +(tr.length / n).toFixed(3), pause_ratio: .2, pitch_mean_hz: +(100 * 2 ** (mean(tr) / 12)).toFixed(1), pitch_range_semitones: +(pct(tr, .9) - pct(tr, .1)).toFixed(2), rms_mean: +mean(sp.map(f => f.rms)).toFixed(4), rms_range: +k.rms.toFixed(3), rate_per_s: k.rate, contour: k.c };
    const known = o.knowsMood !== false;
    return { summary, frames, affect: { v: known ? k.v : 0, a: k.a, cv: known ? .7 : 0, ca: .7, src: ['simulated'], detail: k.d } };
  }

  // ------------------------------------------------------------ mimic: echo the speaker in the character's voice
  const PE = [0, 2, 4, 7, 9, 12];
  function contourNotes(heard) {
    const fr = heard.frames, sm = fr.map((f, i) => mean(fr.slice(Math.max(0, i - 1), i + 2).map(g => g.rms))), sp = fr.filter(f => f.speech), th = mean(sp.map(f => f.rms)) * .8;
    const ph = fr.map(f => f.f0 ? st(f.f0) : null), med = pct(ph.filter(x => x !== null), .5), pk = [];
    for (let i = 1; i < fr.length - 1; i++) if (fr[i].speech && sm[i] > th && sm[i] >= sm[i - 1] && sm[i] > sm[i + 1] && (!pk.length || i - pk[pk.length - 1] >= 4)) pk.push(i);
    if (!pk.length) pk.push(Math.max(0, fr.findIndex(f => f.speech)));
    const notes = pk.map((i, k) => {
      let s = null; for (let d = 0; d < 6 && s === null; d++) s = ph[i + d] ?? ph[i - d] ?? null; if (s === null) s = med;
      const next = k + 1 < pk.length ? pk[k + 1] : Math.min(fr.length - 1, i + 8), gap = (next - i) * .02;
      return { st: s - med, dur: cl(gap, .09, .6), rest: k + 1 < pk.length ? Math.max(0, gap - .6) : 0, vel: sm[i] };
    });
    const mv = mean(notes.map(n => n.vel)) || 1; notes.forEach(n => n.vel = cl(n.vel / mv, .3, 1.8));
    return notes;
  }
  // strength 0 = the character's own phrase, 1 = pure echo of the speaker's contour and rhythm (in the character's timbre)
  function mimic(o) {
    const strength = cl(o.strength === undefined ? .6 : o.strength), exag = o.exaggerate || 2, c = o.char;
    const base = o.len === 'short' ? Object.assign({}, c, { minN: 2, maxN: 5 }) : c;
    const gen = E.generate({ char: base, v: o.v || 0, a: o.a || 0, seed: o.seed | 0, depth: o.depth || 0, pulls: o.pulls || [], par: o.par });
    if (strength <= 0 || !o.heard || !o.heard.frames) return gen;
    const mn = contourNotes(o.heard), u = 60 / (40 + 160 * gen.x.tempo) / 2, center = Math.exp(gen.notes.reduce((a, b) => a + Math.log(b), 0) / gen.notes.length);
    const nG = gen.notes.length, nM = mn.length, n = Math.max(1, Math.round(nG + (nM - nG) * strength)), lerp = (a, b, k) => a + (b - a) * k;
    const idx = (i, m) => n === 1 ? 0 : Math.round(i * (m - 1) / (n - 1)), notes = [], durs = [], vel = [], rest = [], first = [], last = [], hit = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const g = idx(i, nG), m = mn[idx(i, nM)], gs = 12 * Math.log2(gen.notes[g] / center), ms = m.st * exag;
      let q = lerp(gs, ms, strength), sec = lerp(gen.durs[g] * u, m.dur, strength);
      if (gen.sn) { const oc = Math.floor(q / 12), r = q - oc * 12; let bm = 0, bd = 99; for (const p of PE) if (Math.abs(p - r) < bd) { bd = Math.abs(p - r); bm = p; } q = oc * 12 + bm; }
      notes.push(cl(center * 2 ** (q / 12), 50, 3200)); durs.push(sec / u); vel.push(lerp(gen.vel[g], m.vel, strength)); total += sec;
      rest.push(strength > .5 ? false : gen.rest[g]); hit.push(strength > .5 ? 0 : gen.hit[g]); first.push(i === 0); last.push(i === n - 1);
    }
    const cap = o.maxSeconds || 3.5; if (total > cap) durs.forEach((d, i) => durs[i] = d * cap / total);
    return Object.assign({}, gen, { notes, durs, vel, rest, hit, first, last, mimic: strength });
  }

  return { pitch, createListener, summarize, prosodyInterpreter, lexiconInterpreter, llmPrompt, parseLLM, fuse, createBrain, contourNotes, mimic, fixTemperament, temperamentFor, applyTrait, TEMPER_DEFAULT, TEMPER_TRAITS, ARCH_TEMPER, MODES, MODE_NAME, SIM, fakeUtterance };
});
