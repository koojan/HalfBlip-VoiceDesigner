/* TemperUI: the "who is it when you talk to it" editor, shared by the all-in-one app and the Listen page.
 *   TemperUI.mount(el, { get: () => temperament, set: t => {}, onChange: () => {} })
 * Needs BlipListen (fixTemperament, TEMPER_TRAITS, applyTrait). Styles live in app/temper-ui.css. */
const TemperUI = (function () {
  const GROUPS = [
    ['How it joins in', 'var(--acc)', [
      ['mirror', 'Follows your energy', 'Gets livelier when you do, calmer when you do.'],
      ['empathy', 'Cares how you feel', 'Soothes you when you sound upset, cheers you up when you sound low.'],
      ['echo', 'Copies your voice', 'How closely its answers echo your melody and rhythm.'],
      ['curiosity', 'Curiosity', 'Perks up at questions and anything new.'],
      ['tease', 'Teasing', 'Playfully mocks or pokes when you sound fine.']]],
    ['How it pushes back', 'var(--bad)', [
      ['contrary', 'Contrary', 'Leans the other way: calm when you are lively, glum when you are glad.'],
      ['complain', 'Grumbling', 'Complains when you are too loud, go on too long, or it dislikes your voice.'],
      ['sulk', 'Sulking', 'Goes quiet and low when hurt or ignored.'],
      ['patience', 'Patience', 'How long you can talk before it gets restless.']]],
    ['Its own weather', 'var(--acc2)', [
      ['moodV', 'Mood (low ↔ happy)', 'Its usual mood when nothing is happening.', 1],
      ['moodA', 'Energy (sleepy ↔ lively)', 'Its usual energy.', 1],
      ['inertia', 'Moods last', 'High: slow to change. Low: swings quickly.'],
      ['reactivity', 'Takes things to heart', 'How strongly you move its mood.']]],
    ['Rhythm of talking', 'var(--good)', [
      ['chatty', 'Talkative', 'How often it answers at all.'],
      ['delay', 'Takes its time', 'Pause before it answers.'],
      ['wild', 'Unpredictable', 'How often it surprises you with a reaction that does not fit.']]],
    ['What it likes in your voice', 'var(--acc)', [
      ['like.energy', 'Lively ↔ calm', 'Left: likes calm voices. Right: likes lively ones.', 1],
      ['like.pitch', 'Low ↔ high', 'Which pitch it finds pleasant.', 1],
      ['like.pace', 'Slow ↔ fast', 'Which speed it likes.', 1],
      ['like.loud', 'Soft ↔ loud', 'Which loudness it likes.', 1]]],
  ];
  const getv = (t, k) => k.startsWith('like.') ? t.like[k.slice(5)] : t[k];
  const setv = (t, k, v) => { if (k.startsWith('like.')) t.like[k.slice(5)] = v; else t[k] = v; };
  function activeOpt(tr, t) { // the option whose numbers are closest to the current ones
    let best = 0, bd = 9;
    tr.opts.forEach((o, i) => { let d = 0, n = 0; Object.entries(o.over).forEach(([k, v]) => { if (k === 'like') Object.entries(v).forEach(([a, b]) => { d += Math.abs(t.like[a] - b); n++; }); else { d += Math.abs(t[k] - v); n++; } }); d /= n; if (d < bd) { bd = d; best = i; } });
    return bd < .22 ? best : -1;
  }
  function mount(el, api) {
    const L = BlipListen; el.innerHTML = '';
    const wiz = document.createElement('div'), tune = document.createElement('div'); el.append(wiz, tune);
    function paintWiz() {
      const t = L.fixTemperament(api.get());
      wiz.innerHTML = L.TEMPER_TRAITS.map(tr => { const on = activeOpt(tr, t); return `<div class="tp-q"><b>${tr.q}</b><div class="tp-opts">${tr.opts.map((o, i) => `<button class="tp-o${on === i ? ' on' : ''}" data-t="${tr.id}" data-i="${i}">${o.label}</button>`).join('')}</div></div>`; }).join('');
    }
    function paintTune() {
      const t = L.fixTemperament(api.get()), open = [...tune.querySelectorAll('details')].map(d => d.open);
      tune.innerHTML = `<p class="tp-note">Those answers set the numbers below. Fine-tune any of them here.</p>` + GROUPS.map(([name, col, rows], gi) => `<details class="tp-g" style="--gc:${col}"${open[gi] ? ' open' : ''}><summary>${name}</summary>${rows.map(([k, label, help, signed]) => { const v = getv(t, k); return `<div class="tp-s"><span>${label}</span><input type="range" data-k="${k}" min="${signed ? -100 : 0}" max="100" value="${Math.round(v * 100)}" aria-label="${label}"><output>${signed ? (v > 0 ? '+' : '') + Math.round(v * 100) : Math.round(v * 100)}</output><small>${help}</small></div>`; }).join('')}</details>`).join('');
    }
    const paint = () => { paintWiz(); paintTune(); };
    wiz.onclick = e => { const b = e.target.closest('.tp-o'); if (!b) return; api.set(L.applyTrait(api.get(), b.dataset.t, +b.dataset.i)); paint(); api.onChange && api.onChange(); };
    tune.oninput = e => { const r = e.target.closest('input[type=range]'); if (!r) return; const t = L.fixTemperament(api.get()); setv(t, r.dataset.k, r.value / 100); api.set(t); const o = r.nextElementSibling, signed = +r.min < 0; o.textContent = (signed && r.value > 0 ? '+' : '') + r.value; api.onChange && api.onChange(true); };
    tune.onchange = () => paintWiz();
    paint(); return { repaint: paint };
  }
  return { mount };
})();
