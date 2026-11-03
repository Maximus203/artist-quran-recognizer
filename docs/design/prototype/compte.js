/* Compte — onglets (préférences / statistiques / sécurité), enregistrement automatique des réglages (factice),
   aperçu du texte arabe, états du stockage. Rien n'est envoyé : l'état vit dans la page. */
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const P2 = window.P2, root = document.documentElement;
  const q = new URLSearchParams(location.search);

  /* ── Onglets ── */
  function tab(name, focus) {
    if (!['preferences', 'statistiques', 'securite'].includes(name)) name = 'preferences';
    $$('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== name);
    $$('#subnav a').forEach(a => { if (a.dataset.tab === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $('#h-prefs').textContent = { preferences: 'Préférences', statistiques: 'Mes statistiques', securite: 'Sécurité' }[name];
    document.title = $('#h-prefs').textContent + ' — Compte';
  }
  addEventListener('hashchange', () => tab(location.hash.slice(1)));
  tab(location.hash.slice(1) || 'preferences');

  /* ── Enregistrement automatique (anti-rebond, annonce en aria-live) ── */
  let t;
  const save = (what) => {
    clearTimeout(t); P2.autosave('wait');
    t = setTimeout(() => { if ($('#demo-save').value === 'err') P2.autosave('err'); else P2.autosave('ok', what || 'Enregistré'); }, 500);
  };
  const demoErr = q.get('etat') === 'erreur'; if (demoErr) $('#demo-save').value = 'err';

  /* Groupes radio (thème, portée, police) */
  $$('[role="radiogroup"]').forEach(g => g.addEventListener('click', e => {
    const o = e.target.closest('[role="radio"]'); if (!o || o.getAttribute('aria-disabled') === 'true') return;
    $$('[role="radio"]', g).forEach(x => x.setAttribute('aria-checked', String(x === o)));
    if (g.id === 'pref-theme') P2.applyTheme(o.dataset.v === 'system' ? null : o.dataset.v, false);
    if (g.id === 'pref-font') { root.dataset.quranFont = o.dataset.font; preview(); }
    save();
  }));
  $$('[role="radiogroup"]').forEach(g => g.addEventListener('keydown', e => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
    const rs = $$('[role="radio"]:not([aria-disabled="true"])', g); const i = rs.findIndex(r => r.getAttribute('aria-checked') === 'true');
    const n = rs[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + rs.length) % rs.length]; n.click(); n.focus(); e.preventDefault();
  }));

  /* Interrupteurs */
  $$('[role="switch"]').forEach(s => s.addEventListener('click', () => {
    const on = s.getAttribute('aria-checked') !== 'true'; s.setAttribute('aria-checked', String(on));
    const tx = $('.state-txt', s); if (tx) tx.textContent = on ? tx.dataset.yes : tx.dataset.no;
    if (s.id === 'pref-translation') $('#prev-tr').hidden = !on;
    save();
  }));

  /* Taille et volume */
  const size = $('#pref-size'), auto = $('#pref-size-auto');
  function preview() {
    const px = auto.checked ? (matchMedia('(max-width: 767px)').matches ? 32 : 40) : +size.value;
    root.style.setProperty('--quran-size', px + 'px'); size.style.setProperty('--p', ((size.value - 28) / 44 * 100) + '%');
    $('#size-out').textContent = (auto.checked ? 'Auto' : size.value + ' px'); size.disabled = auto.checked; size.setAttribute('aria-valuetext', size.value + ' pixels');
    const f = { 'amiri-quran': 'Amiri Quran', scheherazade: 'Scheherazade New', 'noto-naskh': 'Noto Naskh Arabic' }[root.dataset.quranFont] || 'Amiri Quran';
    $('#prev-meta').textContent = `${f} · ${px} px`;
  }
  size.addEventListener('input', () => { preview(); }); size.addEventListener('change', () => save());
  auto.addEventListener('change', () => { preview(); save(); });
  const vol = $('#pref-volume'); vol.addEventListener('input', () => { $('#vol-out').textContent = vol.value + ' %'; vol.style.setProperty('--p', vol.value + '%'); }); vol.addEventListener('change', () => save());
  $$('select[id^="pref-"]').forEach(s => s.addEventListener('change', () => save()));
  preview();

  /* Réinitialisation */
  $('#reset-prefs').addEventListener('click', () => {
    $('#pref-theme [data-v="system"]').click(); $('#pref-font [data-font="amiri-quran"]').click(); $('#pref-scope [data-v="global"]').click();
    auto.checked = true; preview(); $('#pref-window').value = '120'; $('#pref-speed').selectedIndex = 2; vol.value = 80; vol.dispatchEvent(new Event('input'));
    $$('[role="switch"]').forEach(s => { if (s.getAttribute('aria-checked') !== 'true') s.click(); });
    P2.say('Réglages par défaut rétablis');
  });

  /* Mot de passe : afficher / masquer */
  $$('.pw .toggle').forEach(b => b.addEventListener('click', () => { const i = $('input', b.parentElement); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'); $('use', b).setAttribute('href', show ? '#i-eye-off' : '#i-eye'); }));

  /* ── Stockage : trois états (P2.storage, partagé avec Performance) ── */
  if (q.get('stockage')) P2.storage(q.get('stockage'));
})();
