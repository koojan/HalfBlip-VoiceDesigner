// Does Like/Nope actually steer a character? A simulated listener has a hidden target voice and votes by closeness.
// Reports how far the character's dials are from the target after N ratings, against a control that votes at random.
// This tests the learning rule, not whether real people rate consistently (they do not, and that matters).
const B = require('../engine/blip-engine.js');
const arg = n => (process.argv.find(a => a.startsWith('--' + n + '=')) || '').split('=')[1];
const TRIALS = +(arg('trials') || 30), STEPS = [0, 25, 50, 100, 200, 400], NOISE = +(arg('noise') || 0); // NOISE = chance a vote is flipped
const LR = +(arg('lr') || .25);
const CARE = +(arg('care') || 0);   // 0 = the listener cares about every dial; N = only N dials matter to them (more like a person)
const ALL = B.K.filter(k => k !== 'kit');
const dist = (mu, T) => { const D = T.__care; return Math.sqrt(D.reduce((s, k) => s + (mu[k] - T[k]) ** 2, 0) / D.length); };
function run(random, seed) {
  const r = B.rng(seed), T = {}, c = B.charFromJSON({ name: 'S' }); c.n = 0; c.b = 0;
  ALL.forEach(k => { T[k] = r(); c.mu[k] = r(); });
  T.__care = CARE ? ALL.slice().sort(() => r() - .5).slice(0, CARE) : ALL;                      // hidden target, random start
  const out = [], base = dist(c.mu, T); let cnt = 0;
  const thr = base * .8;                                                  // "good enough" bar: a bit better than where we started
  for (let i = 0; i <= STEPS[STEPS.length - 1]; i++) {
    if (STEPS.includes(i)) out.push(dist(c.mu, T) / base);
    if (i === STEPS[STEPS.length - 1]) break;
    const s = B.generate({ char: c, v: 0, a: 0, seed: seed * 9973 + i, pulls: [] });
    let like = random ? r() < .5 : (1 / (1 + Math.exp((dist(s.x, T) - Math.min(thr, dist(c.mu, T) * .9 + .02)) / .03))) > r();
    if (!random && r() < NOISE) like = !like;
    B.learn(c, s, like, 1, LR);
  }
  return out;
}
const avg = random => { const a = STEPS.map(() => 0); for (let t = 0; t < TRIALS; t++) run(random, 1000 + t).forEach((v, i) => a[i] += v / TRIALS); return a; };
const real = avg(false), ctrl = avg(true);
console.log(`distance to the hidden target, relative to the starting distance (1.00 = no progress), mean of ${TRIALS} runs, vote noise ${NOISE}, learning rate ${LR}, listener cares about ${CARE || 'all'} dials`);
console.log('ratings   ' + STEPS.map(s => String(s).padStart(6)).join(''));
console.log('learning  ' + real.map(v => v.toFixed(2).padStart(6)).join(''));
console.log('random    ' + ctrl.map(v => v.toFixed(2).padStart(6)).join(''));
