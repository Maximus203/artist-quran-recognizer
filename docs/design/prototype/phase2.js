/* Phase 2 — comportements partagés du prototype (menus, thème, favori, renommage, portée, enregistrement automatique).
   Prototype : rien n'est envoyé nulle part, l'état vit dans la page (et le thème dans localStorage). */
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement;
  const P2 = (window.P2 = window.P2 || {});
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem('aqr-proto-' + k)); return v ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('aqr-proto-' + k, JSON.stringify(v)); } catch { /* stockage indisponible : sans effet */ } },
  };
  P2.store = store;

  /* Annonce pour lecteurs d'écran (région aria-live polie, créée au besoin) */
  let live = $('#aria-live');
  if (!live) { live = document.createElement('div'); live.id = 'aria-live'; live.className = 'sr'; live.setAttribute('aria-live', 'polite'); live.setAttribute('role', 'status'); document.body.appendChild(live); }
  P2.say = (t) => { live.textContent = ''; setTimeout(() => { live.textContent = t; }, 30); };

  /* ── Thème : clair / sombre / système (valeur reprise de index.html : clé aqr-proto-theme) ── */
  const hash = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
  const query = Object.fromEntries(new URLSearchParams(location.search));
  P2.hash = hash; P2.query = query;
  function applyTheme(t, persist) {
    if (t) root.dataset.theme = t; else delete root.dataset.theme;
    $$('[data-theme-set]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.themeSet || '') === (t || ''))));
    const ic = $('#btn-theme use'); if (ic) { const dark = (t || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')) === 'dark'; ic.setAttribute('href', dark ? '#i-sun' : '#i-moon'); }
    if (persist) { store.set('theme', t || null); P2.autosave && P2.autosave('ok'); }
  }
  P2.applyTheme = applyTheme;
  applyTheme(hash.theme || store.get('theme', null), false);
  document.addEventListener('click', e => { const b = e.target.closest('[data-theme-set]'); if (b) applyTheme(b.dataset.themeSet || null, true); });

  /* ── Menus (compte, filtres, ⋯) : bouton [aria-haspopup][aria-controls] ── */
  let scrim = null;
  function setMenu(btn, open) {
    const menu = document.getElementById(btn.getAttribute('aria-controls'));
    if (!menu) return;
    menu.hidden = !open; btn.setAttribute('aria-expanded', String(open));
    const sheet = matchMedia('(max-width: 767px)').matches && menu.classList.contains('menu');
    if (open && sheet) { scrim = document.createElement('div'); scrim.className = 'sheet-scrim'; scrim.addEventListener('click', () => closeMenus()); document.body.appendChild(scrim); }
    if (!open && scrim) { scrim.remove(); scrim = null; }
    if (open) { const first = $('[role="menuitem"], a, button, input', menu); if (first && menu.getAttribute('role') === 'menu') first.focus(); }
  }
  function closeMenus(except) {
    $$('[aria-haspopup][aria-expanded="true"]').forEach(b => { if (b !== except) setMenu(b, false); });
  }
  P2.closeMenus = closeMenus;
  document.addEventListener('click', e => {
    const btn = e.target.closest('[aria-haspopup][aria-controls]');
    if (btn) { const open = btn.getAttribute('aria-expanded') !== 'true'; closeMenus(btn); setMenu(btn, open); e.stopPropagation(); return; }
    if (!e.target.closest('.menu, .fpop, .rowmenu, .scope-pop, .popover')) closeMenus();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { const open = $('[aria-haspopup][aria-expanded="true"]'); if (open) { setMenu(open, false); open.focus(); } }
    const menu = e.target.closest && e.target.closest('[role="menu"]');
    if (menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const items = $$('[role="menuitem"]', menu); const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); e.preventDefault();
    }
  });

  /* ── Favori (étoile) : bascule, annonce, animation ── */
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-fav]'); if (!b) return;
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'Retirer des favoris' : 'Ajouter aux favoris');
    b.title = on ? 'Retirer des favoris' : 'Ajouter aux favoris';
    b.classList.remove('pop'); void b.offsetWidth; if (on) b.classList.add('pop');
    P2.say(on ? 'Ajouté aux favoris' : 'Retiré des favoris');
    b.dispatchEvent(new CustomEvent('fav-change', { bubbles: true, detail: { on } }));
  });

  /* ── Renommer au double-clic : Entrée valide, Échap annule, blur valide ── */
  P2.initRename = (rowSel = '.title-row') => $$(rowSel).forEach(row => {
    if (row.dataset.ready) return; row.dataset.ready = '1';
    const h1 = $('h1', row), btn = $('.rename-btn', row);
    if (row.classList.contains('is-readonly')) return;
    const defaultName = row.dataset.default || h1.textContent;
    function start() {
      if (row.dataset.editing) return; row.dataset.editing = '1';
      const wrap = document.createElement('div'); wrap.className = 'title-edit'; wrap.style.flex = '1';
      const inp = document.createElement('input'); inp.className = 'title-input'; inp.type = 'text'; inp.value = h1.textContent.trim(); inp.maxLength = 80;
      inp.setAttribute('aria-label', 'Nom de la session'); inp.setAttribute('enterkeyhint', 'done');
      const hint = document.createElement('span'); hint.className = 'hint-keys'; hint.innerHTML = '<kbd>Entrée</kbd> valider · <kbd>Échap</kbd> annuler';
      const ok = document.createElement('button'); ok.className = 'btn btn--primary btn--sm'; ok.type = 'button'; ok.textContent = 'Valider';
      wrap.append(inp, ok, hint);
      h1.hidden = true; if (btn) btn.hidden = true; row.insertBefore(wrap, h1);
      inp.focus(); inp.select();
      let done = false;
      const finish = (save) => {
        if (done) return; done = true;
        const v = inp.value.trim().replace(/\s+/g, ' ');
        if (save) {
          const name = v || defaultName; h1.textContent = name;
          document.title = name + ' — Quran TR';
          P2.say(v ? 'Nom enregistré : ' + name : 'Nom par défaut rétabli : ' + name);
          P2.autosave && P2.autosave('ok', 'Nom enregistré');
        } else P2.say('Modification annulée');
        wrap.remove(); h1.hidden = false; if (btn) { btn.hidden = false; btn.focus(); } delete row.dataset.editing;
      };
      inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); finish(true); } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); } });
      ok.addEventListener('mousedown', ev => ev.preventDefault()); ok.addEventListener('click', () => finish(true));
      inp.addEventListener('blur', () => setTimeout(() => finish(inp.value.trim() !== h1.textContent.trim()), 0));
    }
    h1.addEventListener('dblclick', start); if (btn) btn.addEventListener('click', start);
  });

  /* ── Portée : popover Global / Privé (propriétaire) ── */
  document.addEventListener('click', e => {
    const opt = e.target.closest('.scope-pop .radio-card'); if (!opt) return;
    const pop = opt.closest('.scope-pop'); const val = opt.dataset.scope;
    const confirm = $('.scope-confirm', pop);
    if (val === 'global' && pop.dataset.current === 'private' && confirm && !pop.dataset.confirmed) {
      $$('.radio-card', pop).forEach(r => r.setAttribute('aria-checked', String(r === opt))); confirm.hidden = false; pop.dataset.pending = 'global'; return;
    }
    applyScope(pop, val);
  });
  document.addEventListener('click', e => {
    const ok = e.target.closest('[data-scope-confirm]'); if (!ok) return;
    const pop = ok.closest('.scope-pop'); pop.dataset.confirmed = '1'; applyScope(pop, 'global'); delete pop.dataset.confirmed;
  });
  document.addEventListener('click', e => {
    const no = e.target.closest('[data-scope-cancel]'); if (!no) return;
    const pop = no.closest('.scope-pop'); const cur = pop.dataset.current; $$('.radio-card', pop).forEach(r => r.setAttribute('aria-checked', String(r.dataset.scope === cur))); $('.scope-confirm', pop).hidden = true;
  });
  function applyScope(pop, val) {
    pop.dataset.current = val; $$('.radio-card', pop).forEach(r => r.setAttribute('aria-checked', String(r.dataset.scope === val)));
    const c = $('.scope-confirm', pop); if (c) c.hidden = true;
    const badge = $('#scope-badge');
    if (badge) {
      badge.className = 'badge ' + (val === 'private' ? 'badge--private' : 'badge--global');
      badge.innerHTML = `<svg class="i" aria-hidden="true"><use href="#i-${val === 'private' ? 'lock' : 'globe'}"/></svg>${val === 'private' ? 'Privé' : 'Global'}`;
    }
    const btn = $('[aria-controls="' + pop.id + '"]'); if (btn) { btn.setAttribute('aria-expanded', 'false'); pop.hidden = true; btn.focus(); }
    P2.say(val === 'private' ? 'Session privée : visible de toi seul' : 'Session globale : visible de tous les testeurs');
    P2.autosave && P2.autosave('ok', 'Portée enregistrée');
  }

  /* ── Enregistrement automatique : pastille discrète, annoncée en aria-live ── */
  P2.autosave = (kind = 'ok', label) => {
    let el = $('.autosave'); if (!el) return;
    clearTimeout(P2._t);
    const msg = kind === 'err' ? 'Non enregistré' : kind === 'wait' ? 'Enregistrement…' : (label || 'Enregistré');
    el.dataset.kind = kind; el.dataset.show = 'true';
    const icon = kind === 'err' ? 'alert' : kind === 'wait' ? 'refresh' : 'check';
    el.innerHTML = `<svg class="i" aria-hidden="true"><use href="#i-${icon}"/></svg><span>${msg}</span>` + (kind === 'err' ? '<button class="btn btn--ghost btn--sm" type="button" data-retry>Réessayer</button>' : '');
    P2.say(kind === 'err' ? 'Réglages non enregistrés. Un bouton Réessayer est disponible.' : msg);
    if (kind === 'ok') P2._t = setTimeout(() => { el.dataset.show = 'false'; }, 2400);
  };
  document.addEventListener('click', e => { if (e.target.closest('[data-retry]')) { P2.autosave('wait'); setTimeout(() => P2.autosave('ok'), 600); } });

  /* ── Copier (blocs de code) ── */
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    const code = $('code', b.closest('.codebox')); if (!code) return;
    (navigator.clipboard?.writeText(code.textContent) || Promise.resolve()).finally(() => { const t = b.textContent; b.textContent = 'Copié'; P2.say('Code copié'); setTimeout(() => { b.textContent = t; }, 1600); });
  });


  /* ── Stockage : trois états (normal, alerte ≥ 80 %, plein) — carte .meter-card ── */
  const ST = { ok: { used: 2.3, aud: 1.4, vid: 0.9, a: 28, v: 18 }, warn: { used: 4.2, aud: 2.6, vid: 1.6, a: 52, v: 32 }, full: { used: 5.0, aud: 3.1, vid: 1.9, a: 62, v: 38 } };
  const fr1 = (n) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  P2.storage = (k) => {
    const s = ST[k]; const c = $('#meter-card'); if (!s || !c) return;
    c.dataset.state = k; const ds = $('#demo-storage'); if (ds) ds.value = k;
    $('#m-used').textContent = fr1(s.used); $('#m-aud').textContent = fr1(s.aud) + ' Go'; $('#m-vid').textContent = fr1(s.vid) + ' Go'; $('#m-free').textContent = fr1(5 - s.used) + ' Go';
    const [a, v] = $$('#meter .m'); a.style.setProperty('--w', s.a + '%'); v.style.setProperty('--w', s.v + '%');
    const m = $('#meter'); m.setAttribute('aria-valuenow', s.used); m.setAttribute('aria-valuetext', `${fr1(s.used)} Go utilisés sur 5 Go${k === 'warn' ? ' : espace presque plein' : k === 'full' ? ' : quota atteint' : ''}`);
    const ts = $('#tile-space'); if (ts) { ts.innerHTML = `${fr1(s.used)}<small>Go</small>`; $('#tile-space-s').textContent = k === 'full' ? 'quota atteint' : k === 'warn' ? 'presque plein · sur 5 Go' : 'sur 5 Go de quota'; }
    $('#m-alert-t').textContent = `Espace presque plein : ${fr1(s.used)} Go sur 5 Go.`;
  };
  document.addEventListener('change', e => { if (e.target.id === 'demo-storage') P2.storage(e.target.value); });
  if (query.stockage || hash.stockage) P2.storage(query.stockage || hash.stockage);

  /* Cartes radio génériques (portée du nouvel essai) */
  document.addEventListener('click', e => {
    const o = e.target.closest('.visib [role="radio"]'); if (!o) return;
    $$('[role="radio"]', o.parentElement).forEach(x => x.setAttribute('aria-checked', String(x === o)));
    P2.say(o.dataset.scope === 'private' ? 'Portée : privé, visible de toi seul' : 'Portée : global, visible de tous les testeurs');
  });

  /* ── Démonstration : états via ?etat=… ── */
  P2.etat = query.etat || '';

  if (hash.menu) setTimeout(() => $('#acct-btn')?.click(), 60);

  /* Titre renommable présent d'emblée (écran principal) */
  P2.initRename();
})();
