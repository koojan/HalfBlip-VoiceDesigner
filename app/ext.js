// ===== Half Blip all-in-one: character dock, Respond (who it is) and Listen (hearing and answering) =====
const HB = { brains: {}, pi: BlipListen.prosodyInterpreter(), deafUntil: 0, listening: false, ls: null, ff: 2.8, hang: 500, minRms: .008, guard: true, ec: true, echoMul: 1, n: 0, know: true, port: null, writer: null, stream: null, timer: null, tapNode: null };
const MCOL = { match: '#3cc8e0', soothe: '#9ee0a8', cheer: '#ffc928', tease: '#ff78c4', contradict: '#ff9a3c', complain: '#ff6a55', sulk: '#8f8fc9', perk: '#b6dc3a', backchannel: '#d9d3c4', own: '#c4a8ff', silent: '#cfcfcf' };
const el = id => document.getElementById(id), initial = c => (c.name || '?').trim().slice(0, 1).toUpperCase();
const pullsNow = () => S.labels.filter(l => l.on).map(l => ({ id: l.id, s: l.s, M: meaning(l) }));
const tempOf = c => BlipListen.fixTemperament(c.temp || BlipListen.temperamentFor(c.arch || null));
function brainOf(c) {
  const key = JSON.stringify(c.temp || c.arch || ''), b = HB.brains[c.id];
  if (b && b.key === key) return b;
  const nb = BlipListen.createBrain({ temperament: tempOf(c), state: c.rel || undefined }); nb.key = key; return HB.brains[c.id] = nb;
}
const hlog = t => { const d = document.createElement('div'); d.textContent = new Date().toLocaleTimeString() + '  ' + t; el('ls-log').prepend(d); while (el('ls-log').children.length > 60) el('ls-log').lastChild.remove(); };

// ---- section switching ----
const _setMode = setMode;
setMode = function (m) {
  ['respond', 'listen'].forEach(x => el('view-' + x).hidden = m !== x);
  _setMode(m);
  document.querySelectorAll('#hb-nav button').forEach(b => b.classList.toggle('on', b.dataset.s === (m === 'wizard' ? 'gallery' : m)));
  document.body.classList.toggle('studio-offset', m === 'studio');
  if (m === 'respond') renderRespond(); if (m === 'listen') renderListen(); sizeTop();
};
function sizeTop() { document.documentElement.style.setProperty('--hbh', el('hb-top').offsetHeight + 'px'); }
window.addEventListener('resize', sizeTop);
el('hb-nav').onclick = e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.s); };
el('hb-logo').onclick = () => setMode('gallery');
el('hb-stop').onclick = () => { try { stopVoice() } catch (e) { } };

// ---- character dock ----
const avStyle = c => c.photo ? `background-image:url(${c.photo})` : '';
function renderDock() {
  el('hb-chars').innerHTML = S.chars.map(c => `<button class="hb-chip${c.id == S.cid ? ' act' : ''}" data-id="${c.id}" style="--c:${PAL[c.col]}" title="${c.name}"><span class="hb-av" style="--c:${PAL[c.col]};${avStyle(c)}">${c.photo ? '' : initial(c)}</span>${c.name}<span class="bd" style="opacity:${.25 + .75 * Math.abs((c.rel && c.rel.bond) || 0)};background:${((c.rel && c.rel.bond) || 0) < -.05 ? 'var(--nope)' : 'var(--like)'}"></span></button>`).join('') + `<button class="hb-chip" id="hb-new" title="New character">＋</button>`;
  sizeTop();
}
el('hb-chars').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'hb-new') { setMode('gallery'); return; }
  S.cid = +b.dataset.id; S.cur = null; all();
  if (S.mode === 'respond') renderRespond(); else if (S.mode === 'listen') renderListen();
  if (S.mode === 'listen' || S.mode === 'respond') { try { play(mkSound(C(), .3, .25, (C().seed + 5) | 0)) } catch (e) { } } else if (S.mode === 'studio') speak();
};
const _all = all;
all = function () { _all(); renderDock(); if (S.mode === 'respond') paintRespondHead(); if (S.mode === 'listen') el('ls-who').textContent = C().name; };
renderDock();

// ---- Respond ----
let tui = null;
function renderRespond() {
  const c = C();
  el('rs-arch').innerHTML = '<option value="">(none)</option>' + Object.keys(Blip.ARCHETYPES).map(a => `<option${c.arch === a ? ' selected' : ''}>${a}</option>`).join('');
  tui = TemperUI.mount(el('rs-ui'), { get: () => c.temp || tempOf(c), set: t => { c.temp = t; HB.brains[c.id] = null; }, onChange: () => { paintRespondHead(); store.set(); } });
  el('rs-sim').innerHTML = Object.keys(BlipListen.SIM).map(k => `<button data-k="${k}">${SIMLAB[k]}</button>`).join('');
  paintRespondHead();
}
const SIMLAB = { happy: '😊 Happy', excited: '🤩 Excited', calm: '😌 Calm', sad: '😢 Sad', angry: '😠 Angry', question: '❓ Question', ramble: '🗣 Rambling', whisper: '🤫 Whisper', shout: '📢 Shout', hello: '👋 Hello' };
function paintRespondHead() {
  const c = C(), t = tempOf(c), b = brainOf(c), st = b.state(), av = el('rs-av');
  av.style.cssText = `--c:${PAL[c.col]};` + avStyle(c); av.textContent = c.photo ? '' : initial(c);
  el('rs-name').textContent = c.name; el('rs-sub').textContent = (c.arch ? c.arch + ' · ' : '') + 'reacts to people';
  const bd = el('rs-bond'); bd.style.left = st.bond >= 0 ? '50%' : (50 + 50 * st.bond) + '%'; bd.style.width = Math.abs(st.bond) * 50 + '%'; bd.style.background = st.bond < 0 ? 'var(--nope)' : 'var(--like)';
  el('rs-mood').textContent = `${st.moodV > .15 ? 'good' : st.moodV < -.15 ? 'low' : 'even'}, ${st.moodA > .15 ? 'lively' : st.moodA < -.15 ? 'sleepy' : 'steady'}`;
  const L = t.like, lk = []; if (Math.abs(L.energy) > .25) lk.push(L.energy > 0 ? 'lively voices' : 'calm voices'); if (Math.abs(L.pitch) > .25) lk.push(L.pitch > 0 ? 'high' : 'low'); if (Math.abs(L.pace) > .25) lk.push(L.pace > 0 ? 'fast talk' : 'slow talk'); if (Math.abs(L.loud) > .25) lk.push(L.loud > 0 ? 'loud' : 'soft');
  el('rs-likes').textContent = lk.join(', ') || 'no strong taste';
}
el('rs-arch').onchange = e => { const c = C(); c.arch = e.target.value || null; c.temp = null; HB.brains[c.id] = null; renderRespond(); store.set(); toast(c.arch ? `${c.name} now has the ${c.arch} temperament` : 'Neutral temperament'); };
el('rs-reset').onclick = () => { const c = C(); c.temp = null; HB.brains[c.id] = null; renderRespond(); store.set(); toast('Back to the archetype default'); };
el('rs-forget').onclick = () => { const c = C(); c.rel = null; HB.brains[c.id] = null; paintRespondHead(); renderDock(); store.set(); toast('Fresh start'); };
el('rs-know').onchange = e => HB.know = e.target.checked;

function showDecision(u, aff, d, via) {
  const rows = (d.scores || []).slice(0, 6), mx = Math.max(.01, ...rows.map(r => r[1])), N = BlipListen.MODE_NAME;
  const html = `<span class="hb-mode" style="--m:${MCOL[d.mode] || '#ccc'}">${d.label || N[d.mode] || d.mode}</span> <span class="hb-help">${via}${d.kind === 'none' ? ': it chose not to answer' : ''}</span>
   <p style="margin:8px 0 2px"><b>Why:</b> ${d.why || '—'}.</p>
   ${d.kind !== 'none' ? `<p class="hb-help" style="margin:2px 0">Answers with energy <b>${d.a.toFixed(2)}</b>, mood <b>${d.v.toFixed(2)}</b>, copying you <b>${Math.round(d.mimic * HB.echoMul * 100)}%</b>, after ${d.delay_ms} ms.</p>` : ''}
   <div class="hb-bars">${rows.map(([m, s]) => `<div class="hb-bar${m === d.mode ? ' win' : ''}" style="--m:${MCOL[m]}"><span>${N[m]}</span><i style="--w:${Math.round(100 * s / mx)}%"></i><span>${s.toFixed(2)}</span></div>`).join('')}</div>
   <p class="hb-help">${d.pleasure > .2 ? 'It enjoyed how you sounded.' : d.pleasure < -.2 ? 'It did not enjoy how you sounded.' : ''}</p>`;
  return html;
}
function react(u, aff, via) {
  const c = C(), b = brainOf(c), d = b.onUtterance({ summary: u.summary }, aff, performance.now());
  c.rel = b.state(); store.set(); renderDock(); if (S.mode === 'respond') paintRespondHead();
  const html = showDecision(u, aff, d, via);
  if (S.mode === 'respond') el('rs-res').innerHTML = html; el('ls-dec').innerHTML = html;
  showHeard(u, aff);
  hlog(`${via}: ${d.kind === 'none' ? 'silent' : d.label} (${d.why})`);
  if (d.kind !== 'reply') { setStatus(HB.listening ? 'idle' : '', HB.listening ? 'Listening' : 'Not listening', HB.listening ? 'It chose to stay quiet.' : ''); return d; }
  const snd = BlipListen.mimic({ heard: u, char: c, v: d.v, a: d.a, seed: (c.seed + HB.n++) | 0, strength: Math.min(1, d.mimic * HB.echoMul), exaggerate: d.exaggerate, len: d.len, pulls: pullsNow(), depth: S.depth });
  setTimeout(() => say(snd), d.delay_ms); return d;
}
function say(snd) {
  init(); play(snd); const T = Blip.sched(snd).T;
  HB.deafUntil = performance.now() + T * 1000 + 600; setStatus('talk', 'Answering', Math.round(T * 1000) + ' ms');
  setTimeout(() => setStatus(HB.listening ? 'idle' : '', HB.listening ? 'Listening' : 'Not listening', ''), T * 1000 + 100);
  if (HB.writer) { try { Blip.encodeN(Blip.toScore(snd)).forEach(l => HB.writer.write(new TextEncoder().encode(l + '\n'))); } catch (e) { } }
}
el('rs-sim').onclick = e => { const b = e.target.closest('button'); if (!b) return; const u = BlipListen.fakeUtterance(b.dataset.k, { knowsMood: HB.know }); react(u, u.affect, 'You (simulated): ' + b.textContent.replace(/^\S+\s/, '')); };
el('rs-30').onclick = () => {
  const c = C(), T = tempOf(c), N = BlipListen.MODE_NAME, kinds = Object.keys(BlipListen.SIM); let h = '';
  kinds.forEach(k => { const cnt = {}; for (let i = 0; i < 30; i++) { const b = BlipListen.createBrain({ temperament: T, rng: Blip.rng(i * 31 + 7) }), u = BlipListen.fakeUtterance(k, { knowsMood: HB.know }), d = b.onUtterance({ summary: u.summary }, u.affect, 1e5); cnt[d.mode] = (cnt[d.mode] || 0) + 1; }
    h += `<div class="hb-bar" style="grid-template-columns:90px 1fr;margin:3px 0"><span>${SIMLAB[k]}</span><span style="display:flex;height:16px;border:2px solid var(--ink);border-radius:6px;overflow:hidden">${Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([m, n]) => `<i title="${N[m]} ${Math.round(n / .3)}%" style="width:${n / .3}%;background:${MCOL[m]};border-right:1px solid var(--ink)"></i>`).join('')}</span></div>`; });
  el('rs-hist').innerHTML = `<div class="hb-res"><b>How ${c.name} usually reacts</b> (30 tries each, from a fresh start)${h}<div class="hb-row2" style="gap:6px">${Object.keys(MCOL).map(m => `<span class="hb-help" style="margin:0"><i style="display:inline-block;width:10px;height:10px;background:${MCOL[m]};border:1.5px solid var(--ink);border-radius:3px"></i> ${N[m]}</span>`).join('')}</div></div>`;
};

// ---- Listen ----
function setStatus(kind, t, s) { el('ls-orb').className = 'hb-orb ' + (kind || ''); el('hb-st').textContent = t; el('hb-sub').textContent = s || ''; el('hb-orbbtn').classList.toggle('live', HB.listening); el('hb-orbbtn').textContent = HB.listening ? '■ Stop listening' : '🎤 Listen'; }
function renderListen() {
  el('ls-who').textContent = C().name; el('ls-vol').value = S.volv; el('ls-vo').textContent = S.volv; el('ls-senso').textContent = (HB.ff).toFixed(1) + '×'; el('ls-hango').textContent = HB.hang + ' ms'; el('ls-echoo').textContent = Math.round(HB.echoMul * 100) + '%';
  if (!HB.listening) setStatus('', 'Not listening', 'Press Start and allow the microphone. ' + C().name + ' will answer.');
}
function showHeard(u, aff) {
  const s = u.summary; el('ls-heard').innerHTML = [['Length', s.dur_ms + ' ms'], ['Pitch', s.pitch_mean_hz + ' Hz'], ['Pitch range', s.pitch_range_semitones + ' semitones'], ['Loudness', s.rms_mean], ['Speed', s.rate_per_s + ' beats/s'], ['Shape', s.contour], ['Pauses', Math.round(s.pause_ratio * 100) + '%']].map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('');
  const bar = (id, v) => { const p = 50 + 50 * v; el('ls-' + id + 'I').style.left = `calc(${p}% - 3px)`; const b = el('ls-' + id + 'B'); b.style.left = Math.min(50, p) + '%'; b.style.right = (100 - Math.max(50, p)) + '%'; };
  bar('a', aff.a); bar('v', aff.v); el('ls-aN').textContent = aff.a.toFixed(2) + ' (sure ' + Math.round(aff.ca * 100) + '%)'; el('ls-vN').textContent = aff.v.toFixed(2) + ' (sure ' + Math.round(aff.cv * 100) + '%)';
}
function onUtterance(u) {
  setStatus('think', 'Thinking', ''); const est = [HB.pi(u)], txt = el('ls-txt').value.trim(); if (txt) est.push(BlipListen.lexiconInterpreter(txt));
  react(u, BlipListen.fuse(est), 'You');
}
async function startListening() {
  try {
    init(); const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: HB.ec, noiseSuppression: false, autoGainControl: false } }); HB.stream = stream;
    await ctx.resume(); const k = Math.max(1, Math.round(ctx.sampleRate / 16000)); HB.k = k;
    const src = ctx.createMediaStreamSource(stream), mute = ctx.createGain(); mute.gain.value = 0; mute.connect(ctx.destination); let onChunk = () => { };
    try { const code = "class T extends AudioWorkletProcessor{process(i){const c=i[0][0];if(c)this.port.postMessage(c.slice());return true}}registerProcessor('tap',T)"; await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' }))); const node = new AudioWorkletNode(ctx, 'tap'); src.connect(node); node.connect(mute); node.port.onmessage = e => onChunk(e.data); HB.tap = node; }
    catch (w) { const sp = ctx.createScriptProcessor(2048, 1, 1); src.connect(sp); sp.connect(mute); sp.onaudioprocess = e => onChunk(new Float32Array(e.inputBuffer.getChannelData(0))); HB.tap = sp; hlog('using script-processor fallback'); }
    let acc = [], cnt = 0; HB.feed = c => { const o = new Float32Array(Math.floor(c.length / k)); for (let i = 0; i < o.length; i++) { let s = 0; for (let j = 0; j < k; j++) s += c[i * k + j]; o[i] = s / k; } acc.push(o); cnt += o.length; if (cnt >= 800) { const m = new Float32Array(cnt); let p = 0; acc.forEach(a => { m.set(a, p); p += a.length; }); acc = []; cnt = 0; HB.ls && HB.ls.push(m); } };
    onChunk = c => { if (HB.guard && performance.now() < HB.deafUntil) return; HB.feed(c); };
    buildListener(); HB.listening = true; setStatus('idle', 'Listening', 'Say something.'); hlog('listening at ' + Math.round(ctx.sampleRate / k) + ' Hz as ' + C().name);
    HB.timer = setInterval(() => { if (!HB.listening || performance.now() < HB.deafUntil) return; const c = C(), d = brainOf(c).onIdle(performance.now()); if (d) { c.rel = brainOf(c).state(); hlog('on its own: ' + d.label + ' (' + d.why + ')'); const snd = BlipListen.mimic({ heard: null, char: c, v: d.v, a: d.a, seed: (c.seed + HB.n++) | 0, strength: 0, len: 'short', pulls: pullsNow() }); el('ls-dec').innerHTML = showDecision(null, { v: 0, a: 0, cv: 0, ca: 0 }, d, 'By itself'); say(snd); } }, 1000);
  } catch (e) { setStatus('', 'Cannot listen', String(e.message || e)); hlog('error: ' + e.message); HB.listening = false; el('hb-orbbtn').classList.remove('live'); }
}
function buildListener() {
  const sr = (ctx.sampleRate / HB.k); HB.ls = BlipListen.createListener({ sr, hangMs: HB.hang, floorFactor: HB.ff, minRms: HB.minRms });
  HB.ls.on('utterance', onUtterance).on('start', () => setStatus('hear', 'Hearing you', '')).on('noise', () => setStatus('idle', 'Listening', '')).on('frame', f => { el('ls-lv').style.width = Math.min(100, f.rms * 400) + '%'; });
  el('ls-th').style.left = Math.min(95, Math.max(.008, HB.minRms) * 400) + '%';
}
function stopListening() { HB.listening = false; try { HB.stream && HB.stream.getTracks().forEach(t => t.stop()); HB.tap && HB.tap.disconnect(); } catch (e) { } clearInterval(HB.timer); HB.ls = null; setStatus('', 'Not listening', 'Press Start to listen again.'); el('ls-go').textContent = '🎤 Start listening'; hlog('stopped'); }
const toggleListen = () => { if (HB.listening) { stopListening(); } else { el('ls-go').textContent = '■ Stop listening'; startListening(); } };
el('ls-go').onclick = toggleListen;
el('hb-orbbtn').onclick = () => { if (S.mode !== 'listen') setMode('listen'); toggleListen(); };
el('ls-hello').onclick = () => { const u = BlipListen.fakeUtterance('hello', { knowsMood: true }); react(u, u.affect, 'You (simulated hello)'); };
el('ls-sens').oninput = e => { HB.ff = e.target.value / 10; el('ls-senso').textContent = HB.ff.toFixed(1) + '×'; if (HB.listening) buildListener(); };
el('ls-hang').oninput = e => { HB.hang = +e.target.value; el('ls-hango').textContent = HB.hang + ' ms'; if (HB.listening) buildListener(); };
el('ls-echo').oninput = e => { HB.echoMul = e.target.value / 100; el('ls-echoo').textContent = e.target.value + '%'; };
el('ls-guard').onchange = e => HB.guard = e.target.checked; el('ls-ec').onchange = e => HB.ec = e.target.checked;
el('ls-vol').oninput = e => { S.volv = +e.target.value; S.mute = 0; el('ls-vo').textContent = S.volv; if (S.out) S.out.gain.value = vm() / (S.pv || 1); store.set(); };
el('ls-cal').onclick = async () => {
  if (!HB.listening) { el('ls-calr').textContent = 'Start listening first.'; return; }
  el('ls-calr').textContent = 'Stay quiet…'; const rms = []; const h = f => rms.push(f.rms); HB.ls.on('frame', h);
  await new Promise(r => setTimeout(r, 2000)); const s = rms.slice().sort((a, b) => a - b), p90 = s[Math.floor(s.length * .9)] || .005;
  HB.minRms = Math.max(.004, +(p90 * 1.8).toFixed(4)); buildListener(); el('ls-calr').textContent = `Room noise ${p90.toFixed(4)}; it will now react above ${HB.minRms}.`; hlog('calibrated: floor ' + p90.toFixed(4));
};
if ('serial' in navigator) { el('ls-ser').hidden = false; el('ls-ser').onclick = async () => { try { const p = await navigator.serial.requestPort(); await p.open({ baudRate: 115200 }); HB.writer = p.writable.getWriter(); el('ls-ser').textContent = 'Robot connected'; hlog('serial connected (experimental)'); } catch (e) { hlog('serial: ' + e.message); } }; }
window.__hb = { react, brainOf, get listening() { return HB.listening }, log: () => [...el('ls-log').children].map(d => d.textContent) };
sizeTop();
try { if (matchMedia('(prefers-reduced-motion: reduce)').matches) document.querySelectorAll('#hb-top animateTransform').forEach(a => a.remove()); } catch (e) {}
