/* Écran principal — ajouts de la phase 2 : sauts de 5 s (icônes + flèches), « Utiliser comme nom », archivage,
   bascule Performance « Tous les testeurs / Moi », démonstration d'une session partagée (#owner=amina). */
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const P2 = window.P2; const H = P2.hash;

  /* Sauts de ±5 s : boutons et flèches ← → (hors champs de saisie) */
  const scr = $('#scrubber');
  const seek = (d) => { scr.value = Math.max(0, Math.min(+scr.max, +scr.value + d)); scr.dispatchEvent(new Event('input')); P2.say((d < 0 ? 'Reculé' : 'Avancé') + ' de 5 secondes'); };
  $$('[data-seek]').forEach(b => b.addEventListener('click', () => seek(+b.dataset.seek)));
  addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.target.closest('input, select, textarea, [role="slider"], [contenteditable]')) return;
    if (e.key === 'ArrowLeft') { seek(-5); e.preventDefault(); } if (e.key === 'ArrowRight') { seek(5); e.preventDefault(); }
  });

  /* Nom proposé par le système : le contenu détecté n'est jamais le nom, mais peut le devenir */
  $('#use-det')?.addEventListener('click', () => { const h1 = $('.title-row h1'); h1.textContent = $('.detected b').textContent; document.title = h1.textContent + ' — Quran TR'; P2.say('Nom remplacé par le contenu détecté'); P2.autosave?.('ok'); });

  /* Archiver : bascule réversible */
  const toast = (msg, label, fn) => { $('.toast')?.remove(); const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.innerHTML = `<span>${msg}</span>${label ? `<button type="button">${label}</button>` : ''}`; document.body.appendChild(t); if (label) $('button', t).addEventListener('click', () => { fn(); t.remove(); }); setTimeout(() => t.remove(), 6000); };
  $('#btn-archive')?.addEventListener('click', e => {
    const b = e.currentTarget; const on = b.getAttribute('aria-pressed') !== 'true';
    const apply = (v) => { b.setAttribute('aria-pressed', String(v)); $('span', b).textContent = v ? 'Restaurer' : 'Archiver'; $('use', b).setAttribute('href', v ? '#i-undo' : '#i-archive'); };
    apply(on); toast(on ? 'Session archivée. Elle reste dans le filtre « Archivées ».' : 'Session restaurée.', 'Annuler', () => apply(!on)); P2.say(on ? 'Session archivée' : 'Session restaurée');
  });

  /* Performance : Tous les testeurs / Moi */
  function perf(mode) {
    $$('#perf-scope button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.perf === mode)));
    $('.perf-global').hidden = mode !== 'all'; $('.perf-mine').hidden = mode !== 'mine';
    $('#perf-sub').textContent = mode === 'all' ? 'Combien de temps prend une analyse, et à quelle vitesse. Sert à estimer la fin d’une file avant de partir.' : 'Tes analyses, ton temps d’écoute et ton espace de stockage.';
    P2.say(mode === 'all' ? 'Statistiques de tous les testeurs' : 'Mes statistiques');
  }
  $$('#perf-scope button').forEach(b => b.addEventListener('click', () => perf(b.dataset.perf)));
  if (H.mine) perf('mine');

  /* Démonstration : session d'un autre testeur (#owner=amina) — titre non renommable, portée en lecture seule */
  if (H.owner) {
    $('.title-row').classList.add('is-readonly'); $('.rename-btn').hidden = true; $('.title-row h1').title = ''; $('.title-row h1').textContent = 'Tajwid cours 4';
    $('#scope-btn').outerHTML = '<span class="badge badge--global" id="scope-badge">' + $('#scope-badge').innerHTML + '</span>';
    $('#owner-fact').hidden = false; $('#owner-name').textContent = H.owner; $('#btn-archive').hidden = true; $('#use-det').hidden = true;
    $('.detected b').textContent = 'Aucun verset reconnu (parole non coranique)';
    document.title = 'Tajwid cours 4 — Quran TR';
  }
  if (H.prive) { $('#scope-badge').className = 'badge badge--private'; $('#scope-badge').innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-lock"/></svg>Privé'; $('#scope-pop').dataset.current = 'private'; $$('#scope-pop .radio-card').forEach(r => r.setAttribute('aria-checked', String(r.dataset.scope === 'private'))); }
  if (H.rename) { $('.rename-btn').click(); }
  if (H.scope) { setTimeout(() => $('#scope-btn').click(), 50); }
})();
