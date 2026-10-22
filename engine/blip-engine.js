/* Blip engine: one source of truth for the voice generator, the renderer and the exporters.
 * Runs unchanged in browsers, Node, Deno and Bun. No dependencies.
 *
 *   character + feeling + seed  --generate-->  sound  --toScore-->  blip-score (plain JSON)
 *   blip-score  --renderScore-->  samples  --wav-->  .wav        (plain-code synth, no Web Audio)
 *   blip-score  --midi-->  .mid           (lossy: no choir, noise or distortion)
 *   blip-score  --tierA-->  tone timeline  (what a one-buzzer player must do)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Blip = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- basics
  const cl = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const num = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
  function rng(s) {
    return () => {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const gauss = r => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(6.2832 * r());

  // ---------------------------------------------------------------- dials
  const GROUPS = [
    ['Melody', ['pitch', 'slope', 'wobble', 'span', 'leap', 'len']],
    ['Time', ['tempo', 'pause', 'meter', 'swing', 'chaos', 'noteLen']],
    ['Bend', ['gliss', 'bendA', 'bendZ', 'vib']],
    ['Timbre', ['chip', 'flute', 'bass', 'trump', 'piano', 'choir']],
    ['Grit', ['noise', 'drive']],
    ['Drums', ['drum', 'kit']],
    ['Volume', ['dyn', 'swell', 'accent']],
  ];
  const K = GROUPS.flatMap(g => g[1]);
  const INS = ['chip', 'flute', 'bass', 'trump', 'piano'];
  const EM = { Sad: [-.7, -.6], Happy: [.8, .4], Curious: [.1, .25], Excited: [.7, .9], Grumpy: [-.6, .6], Sleepy: [.2, -.8] };
  const QK = { stutter: 'repeats a note', squeak: 'a note jumps an octave', hiccup: 'a note drops out', waver: 'a note detunes briefly' };

  // Feeling (valence v, arousal a, depth d) -> a target for every dial.
  function emoT(v, a, d = 0) {
    const m = Math.max, dp = cl(d, -1, 1), o = {
      pitch: .5 + .22 * v + .2 * a - .12 * dp, tempo: .5 + .42 * a - .12 * dp,
      pause: .5 - .38 * a - .1 * v + .15 * m(dp, 0),
      vib: .2 + .3 * Math.abs(a) + .15 * m(v, 0) - .12 * dp, slope: .5 + .4 * v,
      wobble: .2 + .5 * (1 - Math.abs(v)) * (.4 + .3 * (a + 1)), span: .45 + .2 * a + .15 * m(dp, 0),
      leap: .1 + .25 * (a + 1) / 2 * (v > 0 ? 1 : .5), gliss: .25 + .3 * (1 - Math.abs(v)) + .1 * a,
      bendA: .5 - .25 * v, bendZ: .5 + .3 * v, meter: .3 + .4 * (1 - Math.abs(v)) + .1 * a,
      len: .5 + .25 * a, noteLen: .5 - .18 * a,
      swing: .15 + .4 * m(v, 0) * (a + 1) / 2, chaos: .1 + .35 * m(-v, 0) * (a + 1) / 2,
      drum: .05 + .3 * m(a, 0), kit: .5 - .3 * v,
      noise: .05 + .3 * m(-v, 0) * (a + 1) / 2 - .1 * m(dp, 0),
      drive: .08 + .4 * m(a, 0) * (v < 0 ? 1 : .3) + .1 * m(dp, 0),
      choir: .2 + .3 * m(v, 0) * (1 - a) / 2 + .25 * m(dp, 0),
      flute: .25 - .15 * a + .2 * v - .15 * m(dp, 0), bass: .25 - .3 * v + .1 * a + .35 * m(dp, 0),
      trump: .2 + .35 * a + .2 * v, piano: .35 + .1 * v, chip: .3 - .3 * m(dp, 0),
      dyn: .2 + .25 * Math.abs(a), swell: .5 + .2 * v + .1 * dp, accent: .25 + .3 * m(a, 0),
    };
    K.forEach(k => o[k] = cl(o[k]));
    return o;
  }
  const fixX = t => { const b = emoT(0, 0), o = {}; K.forEach(k => o[k] = cl(num(t && t[k], b[k]))); return o; };
  function nearest(v, a) {
    let best = 'Custom', d = .55;
    for (const [k, [x, y]] of Object.entries(EM)) { const q = Math.hypot(x - v, y - a); if (q < d) { d = q; best = k; } }
    return best;
  }
  const fixQK = q => {
    const t = {}; Object.keys(QK).forEach(k => t[k] = !!(q && q.types && q.types[k]));
    return { amt: cl(num(q && q.amt, .12)), types: t };
  };

  // ---------------------------------------------------------------- characters (plain data, no UI)
  // Accepts a saved blip-character (v1) object and returns what generate() needs.
  function charFromJSON(o) {
    const base = emoT(0, 0), mu = {}, sd = {}, lock = {}, off = {};
    K.forEach(k => {
      const p = (o.params || {})[k] || {};
      mu[k] = cl(num(p.mu, base[k])); sd[k] = cl(num(p.sd, .08), .01, .4); lock[k] = !!p.lock; off[k] = !!p.off;
    });
    const minN = cl(Math.round(num(o.minN, 4)), 2, 24);
    return {
      name: String(o.name || 'Unnamed').slice(0, 18), mu, sd, lock, off,
      pull: cl(num(o.pull !== undefined ? o.pull : o.gain, .8)),   // "gain" in v1 files; renamed to avoid clashing with volume
      oct: cl(Math.round(num(o.octave, 0)), -2, 2), seed: num(o.seed, 1),
      minN, maxN: cl(Math.round(num(o.maxN, 14)), minN + 2, 30), quirk: fixQK(o.quirk),
      book: Array.isArray(o.book) ? o.book : [],
      archetype: typeof o.archetype === 'string' ? o.archetype.slice(0, 20) : null,
      temperament: o.temperament && typeof o.temperament === 'object' ? o.temperament : null,   // validated by blip-listen's fixTemperament
      relationship: o.relationship && typeof o.relationship === 'object' ? o.relationship : null,
    };
  }

  // ---------------------------------------------------------------- labels: learned meaning
  function fixL(l) {
    return {
      id: l.id, n: String(l.n || 'label').slice(0, 16), cat: l.cat || 'Custom', s: cl(num(l.s, 1), 0, 2), on: !!l.on,
      ex: (Array.isArray(l.ex) ? l.ex : []).filter(e => e && e.x).slice(-40).map(e => ({ key: String(e.key), x: fixX(e.x), y: e.y < 0 ? -1 : 1 })),
    };
  }
  function meaning(l) {
    const P = l.ex.filter(e => e.y > 0), N = l.ex.filter(e => e.y < 0), wt = e => e.key === 'prior' ? 3 : 1;
    const n = P.reduce((a, e) => a + wt(e), 0), m = {}, w = {}, nn = N.length;
    K.forEach(k => {
      const mean = (P.reduce((a, e) => a + wt(e) * e.x[k], 0) + .5) / (n + 1);
      const sd = Math.sqrt((P.reduce((a, e) => a + wt(e) * (e.x[k] - mean) ** 2, 0) + .09) / (n + 1));
      m[k] = mean;
      let r = n / (n + 1) * cl(1 - sd / .3) * (.3 + .7 * cl(Math.abs(mean - .5) * 3.2));
      if (nn) { const mn = N.reduce((a, e) => a + e.x[k], 0) / nn; r *= 1 + cl(Math.abs(mean - mn) * 2) * .5; }
      w[k] = cl(r);
    });
    return { m, w, n, c: n / (n + 1) };
  }
  // labels the caller switched on -> pulls for generate()
  const pullsOf = labels => labels.filter(l => l.on).map(l => ({ id: l.id, s: l.s, M: meaning(l) }));

  // ---------------------------------------------------------------- generator
  // generate: draw every dial from its bell curve, then turn the dials into notes.
  function generate(o) {
    const c = o.char, v = o.v || 0, a = o.a || 0, seed = o.seed | 0, depth = o.depth || 0, adv = o.adv === undefined ? 1 : o.adv;
    const pulls = o.pulls || [], r = rng(seed), sh = emoT(v, a, depth), nu = emoT(0, 0), pull = num(c.pull !== undefined ? c.pull : c.gain, .8);
    const x = {}, z = {};
    K.forEach(k => {
      const g = gauss(r);
      if (c.off[k]) { z[k] = 0; x[k] = nu[k]; return; }
      let m = c.mu[k];
      if (c.lock[k]) { z[k] = 0; x[k] = m; return; }
      m += pull * (sh[k] - nu[k]);
      pulls.forEach(p => m += cl(p.s * p.M.w[k]) * (p.M.m[k] - m));
      z[k] = g; x[k] = cl(m + c.sd[k] * adv * g);
    });
    return hydrate({
      cid: c.id, v, a, seed, x, z, act: pulls.map(p => p.id), em: nearest(v, a), pa: o.par || 'any', sn: o.sn !== false,
      oc: c.oct, minN: c.minN, maxN: c.maxN, qk: { amt: c.quirk.amt, ...c.quirk.types },
    });
  }

  function hydrate(s) {
    const f = s.x, r = rng(s.seed ^ 0x5bd1e995), ph = r() * 6.28, fr = 1 + r() * 1.5, mn = s.minN || 4, mx = s.maxN || 14;
    let n = Math.round(mn + f.len * (mx - mn));
    if (s.pa === 'odd' && n % 2 === 0) n += n < mx ? 1 : -1;
    if (s.pa === 'even' && n % 2) n += n < mx ? 1 : -1;
    const f0 = 100 * 10 ** f.pitch * 2 ** (s.oc || 0), tot = (f.slope - .5) * (1.2 + f.span * 3.6), PE = [0, 2, 4, 7, 9, 12];
    const notes = [], durs = [], first = [], last = [], rest = [], hit = [], vel = [], rv = rng(s.seed ^ 0x9e3779b9);
    for (let i = 0; i < n; i++) {
      const xx = i / (n - 1);
      let q = (tot * (xx - .5) + f.wobble * (.2 + f.span * .5) * Math.sin(xx * 6.28 * fr + ph) + (r() - .5) * .3) * 12;
      if (r() < f.leap * .5) q += r() < .5 + (f.slope - .5) * .6 ? 12 : -12;
      if (s.sn) {
        const oc = Math.floor(q / 12), m = q - oc * 12; let bm = 0, bd = 99;
        for (const p of PE) if (Math.abs(p - m) < bd) { bd = Math.abs(p - m); bm = p; }
        q = oc * 12 + bm;
      }
      notes.push(cl(f0 * 2 ** (q / 12), 50, 3200));
    }
    let i = 0, odd = false;
    while (i < n) {
      const o = f.meter > .55 || (f.meter >= .4 && r() < .5);
      if (!i) odd = o;
      let g = o ? (r() < .6 ? 3 : 5) : (r() < .6 ? 2 : 4);
      g = Math.min(g, n - i); if (n - i - g === 1) g = n - i;
      for (let j = 0; j < g; j++) {
        let d = o ? (j ? 1 : 1.5) : (r() < .2 ? 2 : 1);
        d *= .4 + 1.6 * f.noteLen;
        if (!o) d *= j % 2 ? 1 - .5 * f.swing : 1 + .5 * f.swing;
        d = d * (1 - f.chaos) + (.25 + r() * 2.2) * f.chaos;
        vel.push(cl((1 + (f.swell - .5) * 1.4 * (2 * durs.length / (n - 1) - 1)) * (1 + (rv() - .5) * f.dyn * 1.4) * (j === 0 ? 1 + .6 * f.accent : 1 - .2 * f.accent), .15, 1.8));
        durs.push(d); first.push(j === 0); last.push(j === g - 1); rest.push(r() < f.chaos * .22);
        const kv = f.kit + (r() - .5) * .5; hit.push(r() < f.drum ? (kv < .33 ? 1 : kv < .66 ? 2 : 3) : 0);
      }
      i += g;
    }
    if (s.qk && s.qk.amt > 0) {
      const qr = rng(s.seed ^ 0xC0FFEE), en = Object.keys(QK).filter(k => s.qk[k]);
      if (en.length) for (let i = 0; i < notes.length; i++) {
        if (qr() >= s.qk.amt * .3) continue;
        const ty = en[qr() * en.length | 0];
        if (ty === 'stutter' && i > 0 && !hit[i]) notes[i] = notes[i - 1];
        else if (ty === 'squeak' && !hit[i]) { notes[i] = cl(notes[i] * 2, 50, 3200); vel[i] = Math.min(1.8, vel[i] * 1.3); }
        else if (ty === 'hiccup') rest[i] = true;
        else if (ty === 'waver' && !hit[i]) notes[i] = notes[i] * (1 + (qr() - .5) * .12);
      }
    }
    return Object.assign(s, { notes, durs, first, last, rest, hit, vel, odd });
  }

  // seconds: onset and length of every note, plus the total length
  function sched(s) {
    const u = 60 / (40 + 160 * s.x.tempo) / 2, o = []; let t = 0;
    s.notes.forEach((_, i) => {
      const d = u * s.durs[i]; o.push([t, d]); t += d;
      if (s.last[i] && i < s.notes.length - 1) t += (50 + 450 * s.x.pause) / 1000;
    });
    return { o, T: t };
  }

  // 17 numbers that describe how a sound feels; used for sensitivity and label learning
  function FEAT(s) {
    const n = s.notes, lm = n.reduce((a, b) => a + Math.log2(b), 0) / n.length, rg = Math.log2(Math.max(...n) / Math.min(...n)), T = sched(s).T, d = s.durs;
    const dm = d.reduce((a, b) => a + b, 0) / d.length, dv = Math.sqrt(d.reduce((a, b) => a + (b - dm) ** 2, 0) / d.length), x = s.x;
    const tw = INS.reduce((a, k) => a + x[k], 0) || 1, br = INS.reduce((a, k, i) => a + x[k] * [.9, .35, .25, .7, .5][i], 0) / tw;
    const dr = s.hit.filter((h, i) => h && !s.rest[i]).length / n.length, rs = s.rest.filter(Boolean).length / n.length;
    const gr = (x.noise + x.drive) / 2, mo = (x.gliss + Math.abs(x.bendA - .5) * 2 + Math.abs(x.bendZ - .5) * 2 + x.vib) / 4;
    return {
      lm, rg, T, br, gr, dr, rs, mo,
      v: [lm / 6, rg / 3, n.length / 14, cl(T / 8), dv, dr, br, gr, mo, rs, (Math.log2(n[n.length - 1] / n[0]) + 3) / 6, x.bendA * .6, x.bendZ * .6, x.choir * .6, x.kit * dr,
        Math.sqrt(s.vel.reduce((a, b) => a + (b - 1) ** 2, 0) / n.length), (s.vel[n.length - 1] - s.vel[0]) * .5 + .5],
    };
  }
  // how much each dial actually changes the sound (0 .. ~1)
  function sens(c, opt = {}) {
    const seeds = [11, 23, 37, 51, 73], o = {};
    K.forEach(k => {
      if (c.off[k]) { o[k] = 0; return; }
      let d = 0;
      seeds.forEach(sd => {
        const a = { ...c.mu }, b = { ...c.mu }; a[k] = 0; b[k] = 1;
        const H = x => FEAT(hydrate({ x, seed: sd, pa: opt.par || 'any', sn: true, oc: c.oct, minN: c.minN, maxN: c.maxN })).v, fa = H(a), fb = H(b);
        d += Math.sqrt(fa.reduce((s, v, i) => s + (v - fb[i]) ** 2, 0) / fa.length);
      });
      o[k] = d / seeds.length;
    });
    return o;
  }

  // ---------------------------------------------------------------- learning (the Like / Nope update)
  // REINFORCE for a Gaussian policy with a running baseline. Every free dial is a bell curve (mu, sd); a sound that was
  // liked pulls each dial's centre toward the value it drew (z = how many sd it was off), a rejected one pushes away, and
  // the spread narrows when liked draws cluster. Locked and off dials never learn. Mutates `c`, returns [[dial, change]].
  function learn(c, s, up, adv = 1, lr = .25) {
    const R = up ? 1 : -1, A = R - (c.b || 0), ch = [];
    c.b = (c.b || 0) + .2 * (R - (c.b || 0)); c.n = (c.n || 0) + 1;
    K.forEach(k => {
      if (c.lock[k] || c.off[k]) return;
      const z = s.z[k] || 0, m0 = c.mu[k], s0 = c.sd[k];
      c.mu[k] = cl(m0 + lr * A * z * s0 * Math.max(1, adv)); c.sd[k] = cl(s0 * Math.exp(.1 * A * (z * z - 1)), .01, .4);
      const d = c.mu[k] - m0; if (Math.abs(d) > .003) ch.push([k, d]);
    });
    return ch;
  }

  // ---------------------------------------------------------------- Jungian archetypes as starting voices
  // Twelve classic archetypes, each a set of dial centres. They are starting points: the designer's rating loop and the
  // dials then make the character its own. Associations of sound with archetype are a design choice, not a measurement.
  const ARCHETYPES = {
    Innocent: { blurb: 'Light, bright, trusting', d: { pitch: .72, tempo: .55, chip: .55, flute: .3, vib: .3, gliss: .35, bendZ: .7, noise: 0, drive: 0, drum: 0, len: .4, pause: .35, swing: .1 } },
    Everyman: { blurb: 'Plain, friendly, easy to be around', d: { pitch: .5, tempo: .5, chip: .6, piano: .3, meter: .35, drum: .1, vib: .2, swing: .15 } },
    Hero: { blurb: 'Bold, brassy, rising', d: { pitch: .4, tempo: .6, trump: .9, chip: .1, drive: .15, drum: .35, kit: .3, slope: .65, accent: .6, leap: .3, bendZ: .7 } },
    Caregiver: { blurb: 'Warm, slow, soothing', d: { pitch: .64, tempo: .38, pause: .45, flute: .5, choir: .55, piano: .25, vib: .4, gliss: .5, bendZ: .65, swell: .6, dyn: .15, swing: .2, noteLen: .65 } },
    Explorer: { blurb: 'Curious, wandering, wide-ranging', d: { pitch: .6, tempo: .65, leap: .5, span: .7, wobble: .6, flute: .4, chip: .4, gliss: .4, chaos: .2, slope: .6 } },
    Rebel: { blurb: 'Rough, loud, off-beat', d: { pitch: .3, tempo: .7, drive: .6, noise: .3, bass: .5, chip: .5, drum: .5, kit: .2, chaos: .45, swing: .4, accent: .7 } },
    Lover: { blurb: 'Sliding, breathy, lingering', d: { pitch: .5, tempo: .3, pause: .55, choir: .7, flute: .5, vib: .65, gliss: .75, bendA: .35, swell: .7, noteLen: .8 } },
    Creator: { blurb: 'Playful melodies that never repeat', d: { pitch: .55, tempo: .5, piano: .6, flute: .3, chip: .3, wobble: .7, span: .65, leap: .4, swing: .45, chaos: .3, meter: .7 } },
    Jester: { blurb: 'Quick, bouncy, full of surprises', d: { pitch: .8, tempo: .8, chip: .7, piano: .3, drum: .4, kit: .8, swing: .8, chaos: .55, leap: .5, gliss: .5, bendZ: .85, vib: .3 } },
    Sage: { blurb: 'Slow, airy, thoughtful', d: { pitch: .36, tempo: .2, pause: .85, bass: .45, flute: .6, choir: .1, chip: 0, vib: .3, gliss: .2, span: .3, len: .35 } },
    Magician: { blurb: 'Shimmering, gliding, a little strange', d: { pitch: .65, tempo: .4, pause: .5, choir: .6, flute: .4, piano: .3, vib: .7, gliss: .8, bendA: .3, bendZ: .75, noise: .2, wobble: .6, span: .75 } },
    Ruler: { blurb: 'Deep, measured, commanding', d: { pitch: .25, tempo: .3, pause: .6, bass: .7, trump: .5, chip: 0, drive: .2, vib: .15, swell: .6, accent: .5, drum: .25, kit: .15, noteLen: .7 } },
  };
  // which character archetype each of the designer's sound types belongs to (used for default reaction temperament)
  const SOUND_ARCH = { Chirp: 'Innocent', Grumble: 'Rebel', Sage: 'Sage', Tock: 'Everyman', Ghost: 'Magician', Bot: 'Everyman', Brass: 'Hero', Wisp: 'Lover', Clank: 'Rebel', Drone: 'Ruler', Sparkle: 'Jester' };
  // a ready blip-character file for an archetype
  function fromArchetype(name, o = {}) {
    const a = ARCHETYPES[name]; if (!a) throw new Error('archetypes: ' + Object.keys(ARCHETYPES).join(', '));
    const mu = fixX({ ...emoT(0, 0), ...a.d }), params = {};
    K.forEach(k => params[k] = { mu: +mu[k].toFixed(4), sd: .08, lock: false, off: false });
    return { format: 'blip-character', version: 1, name: o.name || name, color: 0, octave: o.octave || 0, seed: o.seed === undefined ? Math.floor(rng(name.length * 7919)() * 1e9) : o.seed, gain: .8, pull: .8, params, minN: 4, maxN: 14, quirk: { amt: .12, types: { stutter: true, squeak: true, hiccup: false, waver: false } }, archetype: name };
  }

  // ---------------------------------------------------------------- score
  // A blip-score is the whole sound as timed events. Every pitch is absolute, every time is in ms.
  // Extension over the v1 draft: optional per-event h0 / h1 / r (start pitch, end pitch, glide ms)
  // and a score-level "timbre" block, so a renderer needs nothing but the score.
  const r2 = x => Math.round(x * 100) / 100, TIMBRE = ['chip', 'flute', 'bass', 'trump', 'piano', 'choir', 'noise', 'drive', 'vib'];
  function toScore(s, o = {}) {
    const { o: sc, T } = sched(s), f = s.x, ev = []; let prev = 0;
    s.notes.forEach((fr, i) => {
      const t = Math.round(sc[i][0] * 1000), dur = sc[i][1], d = Math.max(1, Math.round(dur * 1000));
      if (s.rest[i]) { ev.push({ t, d, hz: null, vel: 0 }); prev = 0; return; }
      const vel = r2((s.vel && s.vel[i]) || 1);
      if (s.hit[i]) { const e = { t, d, k: s.hit[i], vel }; if (s.first[i]) e.f = 1; if (s.last[i]) e.l = 1; ev.push(e); prev = 0; return; }
      const gl = prev && f.gliss > .15, bend = s.first[i] && Math.abs(f.bendA - .5) > .04;
      const st = gl ? prev : bend ? fr * 2 ** ((f.bendA - .5) * 16 / 12) : fr;
      const rt = Math.min(gl ? dur * f.gliss : bend ? .07 : .005, dur * .5);
      const ef = s.last[i] && Math.abs(f.bendZ - .5) > .04 ? fr * 2 ** ((f.bendZ - .5) * 16 / 12) : fr;
      const e = { t, d, hz: r2(fr), vel };
      if (s.first[i]) e.f = 1; if (s.last[i]) e.l = 1;
      if (Math.abs(st - fr) > .01) { e.h0 = r2(st); e.r = Math.max(1, Math.round(rt * 1000)); }
      if (Math.abs(ef - fr) > .01) e.h1 = r2(ef);
      ev.push(e); prev = fr;
    });
    const timbre = {}; TIMBRE.forEach(k => timbre[k] = r2(f[k]));
    return {
      format: 'blip-score', version: 1, id: o.id || ('s' + (s.seed >>> 0).toString(16)), voice: o.voice || null,
      dur_ms: Math.round(T * 1000), timbre, events: ev,
      meta: { seed: s.seed, source: { v: s.v, a: s.a, em: s.em } },
    };
  }
  const leadOf = x => INS.slice().sort((a, b) => x[b] - x[a])[0];

  // ---------------------------------------------------------------- plain-code synth
  // Sample-by-sample. Mirrors the browser's old Web Audio voices (same wave tables, filters, envelopes)
  // so that what the designer plays is what the WAV contains.
  const HARM = {
    flute: [1, .2, .05, .02], bass: [1, .8, .95, .6, .4, .3, .2, .1], trump: [1, .9, .85, .7, .55, .4, .3, .2, .1],
    piano: [1, .5, .3, .18, .1, .06], choir: [1, .5, .35, .25, .15, .1],
  };
  const TN = 2048, tables = {};
  function table(name, maxH) {
    const h = HARM[name], key = name + ':' + Math.min(h.length, maxH);
    if (tables[key]) return tables[key];
    const full = tables[name + ':full'] || (tables[name + ':full'] = (() => {
      const t = new Float32Array(TN); let pk = 0;
      for (let i = 0; i < TN; i++) { let s = 0; h.forEach((a, k) => s += a * Math.sin(6.283185307 * (k + 1) * i / TN)); t[i] = s; pk = Math.max(pk, Math.abs(s)); }
      return { t, pk };
    })());
    const t = new Float32Array(TN), nh = Math.max(1, Math.min(h.length, maxH));
    for (let i = 0; i < TN; i++) { let s = 0; for (let k = 0; k < nh; k++) s += h[k] * Math.sin(6.283185307 * (k + 1) * i / TN); t[i] = s / full.pk; }
    return tables[key] = t;
  }
  const lookup = (t, ph) => { const p = ph * TN, i = p | 0, f = p - i; return t[i % TN] * (1 - f) + t[(i + 1) % TN] * f; };
  const blep = (t, dt) => t < dt ? (t /= dt, t + t - t * t - 1) : t > 1 - dt ? (t = (t - 1) / dt, t * t + t + t + 1) : 0;

  // RBJ biquad, same maths as the Web Audio spec (lowpass/highpass Q is in dB, bandpass Q is linear)
  class Biquad {
    constructor(type, f, Q, sr) { this.type = type; this.sr = sr; this.Q = Q; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(f); }
    set(f) {
      const sr = this.sr, fc = cl(f, 10, sr * .45), w = 2 * Math.PI * fc / sr, c = Math.cos(w), s = Math.sin(w);
      const al = this.type === 'bandpass' ? s / (2 * this.Q) : s / (2 * 10 ** (this.Q / 20));
      let b0, b1, b2;
      if (this.type === 'lowpass') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
      else if (this.type === 'highpass') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
      else { b0 = al; b1 = 0; b2 = -al; }
      const a0 = 1 + al; this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
    }
    run(x) {
      const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y;
    }
  }

  // master compressor modelled on the one in browsers: -14 dB threshold, 22 dB knee, 7:1, with makeup gain
  const COMP_R = 7, COMP_MK = 2; // makeup trimmed against Chromium's compressor (see tests/parity-chromium.js)
  function compress(buf, sr) {
    const T = -14, KN = 22, R = COMP_R, atk = Math.exp(-1 / (sr * .003)), rel = Math.exp(-1 / (sr * .18));
    const curve = L => L < T - KN / 2 ? L : L > T + KN / 2 ? T + (L - T) / R : L + (1 / R - 1) * (L - T + KN / 2) ** 2 / (2 * KN);
    const makeup = 10 ** (-curve(0) / 20 * .6 / 1); // 1/gain(0 dB), to the 0.6 power
    let g = 1;
    for (let i = 0; i < buf.length; i++) {
      const x = buf[i], L = 20 * Math.log10(Math.abs(x) + 1e-9), want = 10 ** ((curve(L) - L) / 20);
      g = want < g ? atk * g + (1 - atk) * want : rel * g + (1 - rel) * want;
      buf[i] = x * g * makeup * 10 ** (COMP_MK / 20);
    }
  }

  function renderScore(sc, o = {}) {
    const sr = o.sr || 44100, vol = o.volume === undefined ? 1 : o.volume, tm = sc.timbre || {}, dt1 = 1 / sr;
    const tail = 1.8, N = Math.ceil((sc.dur_ms / 1000 + tail) * sr), out = new Float32Array(N), nr = rng((sc.meta && sc.meta.seed | 0) ^ 0xBEEF);
    const tot = INS.reduce((a, k) => a + (tm[k] || 0), 0) || 1, w = k => (tm[k] || 0) / tot, vib = tm.vib || 0;
    const lfoHz = 5 + vib * 6, lfoCents = vib * 45, gain = .55 * vol;
    const add = (i0, i1) => [Math.max(0, i0), Math.min(N, i1)];

    // one oscillator voice: type 'sq' or a harmonic table, optional filter, envelope, detune cents
    function voice(e, fr, st, ef, rt, dur, V) {
      const i0 = Math.round(e.t / 1000 * sr), len = Math.round((V.dec ? dur * 1.6 + .05 : dur) * sr), amp = (e.vel || 1) * gain;
      const att = Math.min(V.att, dur * .5), fl = V.fl && new Biquad(V.fl[0], V.fl[1], V.fl[2] || .7, sr);
      const tHold = Math.max(att, dur - .05), tEnd = Math.max(dur - .015, tHold + .001);
      let ph = 0; const mh = Math.floor(sr * .45 / Math.max(fr, ef, st)), tab = V.w ? table(V.w, mh) : null;
      for (let j = 0; j < len; j++) {
        const i = i0 + j; if (i >= N) break;
        const tau = j * dt1; let f = fr;
        if (tau < rt) f = st + (fr - st) * (tau / rt); else if (ef !== fr && tau >= dur * .55) f = fr + (ef - fr) * cl((tau - dur * .55) / Math.max(1e-4, dur - .02 - dur * .55));
        f *= 2 ** ((V.det + lfoCents * Math.sin(6.283185307 * lfoHz * tau)) / 1200);
        const dphi = f * dt1; ph += dphi; ph -= Math.floor(ph);
        let s = tab ? lookup(tab, ph) : (ph < .5 ? 1 : -1) + blep(ph, dphi) - blep((ph + .5) % 1, dphi);
        if (fl) { if (V.fl[3] && (j & 31) === 0) fl.set(V.fl[1] + (V.fl[3] - V.fl[1]) * Math.min(1, tau / .09)); s = fl.run(s); }
        let env;
        if (V.dec) env = tau < att ? V.peak * tau / att : V.peak * Math.pow(.001 / V.peak, (tau - att) / Math.max(1e-3, dur * 1.6 - att));
        else env = tau < att ? V.peak * tau / att : tau < tHold ? V.peak : tau < tEnd ? V.peak * (1 - (tau - tHold) / (tEnd - tHold)) : 0;
        out[i] += s * env * amp;
      }
    }
    function noise(t0, d, type, fq, Q, peak, amp) {
      const i0 = Math.round(t0 / 1000 * sr), len = Math.round(d * sr), b = new Biquad(type, fq, Q, sr);
      for (let j = 0; j < len; j++) {
        const i = i0 + j; if (i >= N) break;
        out[i] += b.run(nr() * 2 - 1) * peak * Math.pow(.001 / peak, j * dt1 / d) * amp;
      }
    }
    function sweep(t0, d, kind, f0, f1, peak, amp) {
      const i0 = Math.round(t0 / 1000 * sr), len = Math.round(d * sr); let ph = 0;
      for (let j = 0; j < len; j++) {
        const i = i0 + j; if (i >= N) break;
        const tau = j * dt1, f = f0 * Math.pow(f1 / f0, Math.min(1, tau / (d * .6)));
        ph += f * dt1; ph -= Math.floor(ph);
        const s = kind === 'sine' ? Math.sin(6.283185307 * ph) : 1 - 4 * Math.abs(((ph + .25) % 1) - .5); // triangle starts at 0
        out[i] += s * peak * Math.pow(.001 / peak, tau / d) * amp;
      }
    }
    for (const e of sc.events) {
      if (e.hz === null) continue;
      const amp = (e.vel || 1) * gain;
      if (e.k) {
        if (e.k === 1) sweep(e.t, .22, 'sine', 170, 42, .95, amp);
        else if (e.k === 2) { noise(e.t, .16, 'bandpass', 1900, .7, .5, amp); sweep(e.t, .1, 'tri', 200, 120, .35, amp); }
        else noise(e.t, .05, 'highpass', 7500, .5, .35, amp);
        continue;
      }
      const fr = e.hz, st = e.h0 || fr, ef = e.h1 || fr, rt = (e.r || 5) / 1000, dur = e.d / 1000;
      if (w('chip') > .04) voice(e, fr, st, ef, rt, dur, { w: 0, det: 0, peak: .22 * w('chip'), att: .005 });
      if (w('flute') > .04) voice(e, fr, st, ef, rt, dur, { w: 'flute', det: 0, peak: .3 * w('flute'), att: .07, fl: ['lowpass', 2800] });
      if (w('bass') > .04) voice(e, fr, st, ef, rt, dur, { w: 'bass', det: 0, peak: .3 * w('bass'), att: .05, fl: ['lowpass', 1100] });
      if (w('trump') > .04) voice(e, fr, st, ef, rt, dur, { w: 'trump', det: 0, peak: .26 * w('trump'), att: .035, fl: ['lowpass', 500, 1.5, 3800] });
      if (w('piano') > .04) voice(e, fr, st, ef, rt, dur, { w: 'piano', det: 0, peak: .4 * w('piano'), att: .003, fl: ['lowpass', 5500], dec: 1 });
      if ((tm.choir || 0) > .06) [-14, 0, 14].forEach(d => voice(e, fr, st, ef, rt, dur, { w: 'choir', det: d, peak: .11 * tm.choir, att: .12, fl: ['bandpass', 900, 1.2] }));
      if ((tm.noise || 0) > .05) noise(e.t, dur, 'bandpass', fr * 2, .8, tm.noise * .3, amp);
    }
    if ((tm.drive || 0) > .05) {
      const k = 1 + tm.drive * 40, nk = Math.tanh(k);
      for (let i = 0; i < N; i++) out[i] = Math.tanh(out[i] * k) / nk * .9;
    }
    compress(out, sr);
    for (let i = 0; i < N; i++) { const x = out[i], a = Math.abs(x); out[i] = a < .9 ? x : Math.sign(x) * (.9 + .1 * Math.tanh((a - .9) / .1)); } // soft ceiling, never hard-clips
    return out;
  }
  const render = (s, o) => renderScore(toScore(s), o);

  // ---------------------------------------------------------------- WAV
  function wav(samples, sr = 44100) {
    const n = samples.length, b = new Uint8Array(44 + n * 2), dv = new DataView(b.buffer);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true);
    dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(cl(samples[i], -1, 1) * 32767), true);
    return b;
  }
  function readWav(bytes) { // 16-bit PCM mono/stereo (stereo is averaged)
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let p = 12, fmt = null, data = null;
    while (p + 8 <= bytes.length) {
      const id = String.fromCharCode(...bytes.slice(p, p + 4)), n = dv.getUint32(p + 4, true);
      if (id === 'fmt ') fmt = { ch: dv.getUint16(p + 10, true), sr: dv.getUint32(p + 12, true), bits: dv.getUint16(p + 22, true) };
      if (id === 'data') { data = [p + 8, Math.min(n, bytes.length - p - 8)]; break; }
      p += 8 + n + (n & 1);
    }
    if (!fmt || !data || fmt.bits !== 16) throw new Error('only 16-bit PCM WAV is supported');
    const frames = data[1] / 2 / fmt.ch, out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) { let s = 0; for (let c = 0; c < fmt.ch; c++) s += dv.getInt16(data[0] + (i * fmt.ch + c) * 2, true); out[i] = s / fmt.ch / 32768; }
    return { samples: out, sr: fmt.sr };
  }

  // ---------------------------------------------------------------- MIDI (format 0, 1 tick = 1 ms)
  // Lossy by design: pitch, timing, velocity, glides (as pitch bend), vibrato (mod wheel), one GM program, drums on channel 10.
  const GM = { chip: 80, flute: 73, bass: 70, trump: 56, piano: 0, choir: 52 };
  function midi(sc) {
    const trk = [];
    const vlq = n => { const b = [n & 127]; while ((n >>= 7)) b.push((n & 127) | 128); return b.reverse(); };
    const push = (t, bytes, ord = 1) => trk.push({ t: Math.max(0, Math.round(t)), bytes, ord });
    const tm = sc.timbre || {}, lead = ['chip', 'flute', 'bass', 'trump', 'piano', 'choir'].sort((a, b) => (tm[b] || 0) - (tm[a] || 0))[0];
    push(0, [0xFF, 0x51, 3, 0x07, 0xA1, 0x20], 0);                 // 500000 us per quarter
    push(0, [0xB0, 101, 0, 0xB0, 100, 0, 0xB0, 6, 12, 0xB0, 38, 0], 0); // pitch bend range = 12 semitones
    push(0, [0xC0, GM[lead] || 0], 0); push(0, [0xB0, 1, Math.round(cl(tm.vib || 0) * 100)], 0);
    const note = hz => 69 + 12 * Math.log2(hz / 440), bendv = (hz, base) => cl(Math.round(8192 + (note(hz) - base) / 12 * 8192), 0, 16383);
    const sendBend = (t, v) => push(t, [0xE0, v & 127, v >> 7], 2);
    for (const e of sc.events) {
      if (e.hz === null) continue;
      const vel = Math.round(cl(e.vel * 80, 1, 127));
      if (e.k) { const n = [0, 36, 38, 42][e.k]; push(e.t, [0x99, n, vel]); push(e.t + Math.min(e.d, 120), [0x89, n, 0], 0); continue; }
      const nn = Math.round(note(e.hz));
      sendBend(e.t, bendv(e.h0 || e.hz, nn));
      if (e.h0) for (let k = 1; k <= 4; k++) sendBend(e.t + (e.r || 5) * k / 4, bendv(e.h0 + (e.hz - e.h0) * k / 4, nn));
      push(e.t, [0x90, nn, vel]);
      if (e.h1) for (let k = 1; k <= 4; k++) sendBend(e.t + e.d * (.55 + .4 * k / 4), bendv(e.hz + (e.h1 - e.hz) * k / 4, nn));
      push(e.t + e.d, [0x80, nn, 0], 0);
    }
    push(sc.dur_ms + 100, [0xFF, 0x2F, 0], 3);
    trk.sort((a, b) => a.t - b.t || a.ord - b.ord);
    const body = []; let prev = 0;
    for (const e of trk) { body.push(...vlq(e.t - prev), ...e.bytes); prev = e.t; }
    // channel bytes inside the 'pitch bend range' blob are single messages: expand running status safely
    const hdr = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xF4], n = body.length;
    return Uint8Array.from([...hdr, 0x4D, 0x54, 0x72, 0x6B, n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255, ...body]);
  }

  // ---------------------------------------------------------------- Tier A reference
  // What a one-buzzer player does: one tone at a time, no velocity, no bends, drums as short clicks.
  // Both this function and players/common/blip_player.h must agree to the millisecond.
  const DRUM_A = [null, [80, 60], [220, 40], [3000, 15]]; // [hz, ms] for kick, snare, hat
  function tierA(sc, o = {}) {
    const oc = o.oct || 0, shift = hz => oc >= 0 ? hz << oc : (hz + (1 << (-oc - 1))) >> -oc, spans = []; // integer maths, same as the C player
    for (const e of sc.events) {
      if (e.hz === null) continue;
      if (e.k) { const [hz, ms] = DRUM_A[e.k]; spans.push([e.t, e.t + Math.min(ms, e.d), shift(hz)]); }
      else spans.push([e.t, e.t + (e.d > 40 ? Math.max(e.d - 8, Math.floor((e.d * 7 + 5) / 10)) : e.d), shift(Math.round(e.hz))]);
    }
    return spans; // [start_ms, end_ms, hz]
  }
  const toneAt = (spans, ms) => { for (const s of spans) if (ms >= s[0] && ms < s[1]) return s[2]; return 0; };

  // ---------------------------------------------------------------- zip (store only, no deps)
  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = ~0; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };
  function zip(files) { // files: {name: Uint8Array|string}
    const enc = new TextEncoder(), parts = [], cd = []; let off = 0;
    const u16 = n => [n & 255, n >> 8 & 255], u32 = n => [n & 255, n >> 8 & 255, n >> 16 & 255, n >>> 24 & 255];
    for (const [name, data0] of Object.entries(files)) {
      const data = typeof data0 === 'string' ? enc.encode(data0) : data0, nm = enc.encode(name), crc = crc32(data);
      const lh = [0x50, 0x4B, 3, 4, ...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0)];
      parts.push(Uint8Array.from(lh), nm, data);
      cd.push(Uint8Array.from([0x50, 0x4B, 1, 2, ...u16(20), ...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nm);
      off += lh.length + nm.length + data.length;
    }
    const cdLen = cd.reduce((a, b) => a + b.length, 0), cnt = Object.keys(files).length;
    const end = Uint8Array.from([0x50, 0x4B, 5, 6, 0, 0, 0, 0, ...u16(cnt), ...u16(cnt), ...u32(cdLen), ...u32(off), 0, 0]);
    const all = [...parts, ...cd, end], out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let p = 0;
    all.forEach(b => { out.set(b, p); p += b.length; });
    return out;
  }

  // ---------------------------------------------------------------- bank: voice + scores + tags
  const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'voice';
  function voiceOf(c, id) {
    const x = fixX(c.mu), lead = leadOf(x), timbre = {};
    TIMBRE.forEach(k => timbre[k] = r2(x[k]));
    return { format: 'blip-voice', version: 1, id, name: c.name, lead, octave: c.oct, timbre };
  }
  // Pre-render a palette: `per` sounds for every feeling (and any extra [v,a,name] points).
  function bake(c, o = {}) {
    const per = o.per || 3, id = o.id || slug(c.name), base = (o.seed === undefined ? c.seed : o.seed) | 0, pulls = o.pulls || [], scores = [];
    const pts = Object.entries(EM).map(([n, [v, a]]) => [v, a, n]).concat(o.points || []);
    pts.forEach(([v, a, name], pi) => {
      for (let j = 0; j < per; j++) {
        const seed = (base + pi * 7919 + j * 104729) | 0, s = generate({ char: c, v, a, seed, pulls, depth: o.depth || 0, par: o.par });
        const sid = `${id}-${slug(name)}-${j + 1}`, sc = toScore(s, { id: sid, voice: id });
        sc.meta.source.v = v; sc.meta.source.a = a; sc.meta.source.em = name;
        scores.push({ id: sid, tags: [name], v, a, score: sc });
      }
    });
    return { format: 'blip-bank', version: 1, id, voice: voiceOf(c, id), scores, bank_meta: { character: c.name, exported: o.date || new Date().toISOString() } };
  }
  // choose a baked score for a target feeling: nearest few, then a random one so replies do not repeat
  function pick(bank, v, a, r = Math.random) {
    const d = bank.scores.map(s => [Math.hypot(s.v - v, (s.a - a) * 1.2), s]).sort((p, q) => p[0] - q[0]).slice(0, 3);
    return d[Math.floor(r() * d.length)][1];
  }

  // C header for the Tier A player (players/common/blip_player.h)
    function cHeader(bank) {
    let h = `/* generated by tools/blip.js header from bank "${bank.id}" -- do not edit */\n#pragma once\n#include "blip_player.h"\n\n`;
    bank.scores.forEach((s, i) => {
      const ev = s.score.events.map(e => `{${e.t},${e.d},${e.hz == null ? 0 : Math.round(e.hz)},${e.k || 0}}`);
      h += `static const blip_ev blip_ev_${i}[] = {${ev.join(',')}};\n`;
    });
    h += `static const blip_score blip_scores[] = {\n` + bank.scores.map((s, i) => `  {"${s.id}", blip_ev_${i}, ${s.score.events.length}, ${s.score.dur_ms}}`).join(',\n') + `\n};\n`;
    h += `static const blip_bank blip_the_bank = {"${bank.voice.id}", blip_scores, ${bank.scores.length}};\n`;
    h += `/* ${bank.scores.length} scores, about ${bank.scores.reduce((a, s) => a + s.score.events.length * 7, 0)} bytes of events */\n`;
    return h;
  }

  // ---------------------------------------------------------------- protocol helpers (host side)
  // N line: live notes, "N hz/ms[/vel] ..." (hz 0 = rest). Player stays dumb; the client composes.
  function encodeN(sc, maxBytes = 250) {
    const ev = sc.events.filter(e => e.hz !== undefined && !e.k).map(e => ({ hz: e.hz === null ? 0 : Math.round(e.hz), ms: Math.min(9999, e.d), vel: e.vel, t: e.t }));
    const lines = []; let line = 'N';
    for (const e of ev) {
      const tok = ' ' + e.hz + '/' + e.ms;
      if (line.length + tok.length > maxBytes) { lines.push(line); line = 'N+'; if (lines.length >= 4) break; }
      line += tok;
    }
    if (line.length > 2 && lines.length < 4) lines.push(line);
    return lines;
  }

  return {
    version: '0.2.0', K, INS, GROUPS, EM, QK, TIMBRE, GM, DRUM_A,
    ARCHETYPES, SOUND_ARCH, fromArchetype, cl, num, rng, gauss, emoT, fixX, nearest, fixQK, charFromJSON, fixL, meaning, pullsOf,
    generate, hydrate, sched, FEAT, sens, learn, toScore, leadOf,
    renderScore, render, wav, readWav, midi, tierA, toneAt, zip, crc32, bake, pick, voiceOf, slug, encodeN, cHeader,
  };
});
