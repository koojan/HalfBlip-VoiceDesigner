// Synthetic "speech" for tests and demos: voiced harmonic tone, a pitch contour, syllable pulses, room noise. Seeded.
const B = require('../engine/blip-engine.js');
function speech({ sr = 16000, f0 = t => 150, syll = 4, dur = 1.2, amp = .25, lead = .5, tail = 1.0, noise = .002, seed = 1 }) {
  const r = B.rng(seed), n = Math.round((lead + dur + tail) * sr), x = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr - lead; let s = (r() - .5) * 2 * noise;
    if (t >= 0 && t < dur) { const f = f0(t / dur); ph += f / sr; const env = Math.pow(Math.max(0, Math.sin(Math.PI * syll * t)), .6) * Math.min(1, t * 20) * Math.min(1, (dur - t) * 20); let v = 0; for (let h = 1; h <= 6; h++) v += Math.sin(6.2832 * h * ph) / h; s += v * env * amp * .6; }
    x[i] = s;
  }
  return x;
}
module.exports = speech;
if (require.main === module) { // node tests/speech-synth.js out.wav : write a demo clip (a rising, lively sentence twice)
  const a = speech({ sr: 48000, f0: p => 140 + 90 * p, syll: 5, amp: .35, tail: 1.2 }), b = speech({ sr: 48000, f0: p => 230 - 60 * p, syll: 3, amp: .25, lead: .2, tail: 2, seed: 2 });
  const all = new Float32Array(a.length + b.length); all.set(a); all.set(b, a.length); require('fs').writeFileSync(process.argv[2] || 'speech.wav', B.wav(all, 48000)); console.log('wrote', process.argv[2] || 'speech.wav');
}
