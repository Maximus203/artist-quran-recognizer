/* Page Sessions — liste complète : recherche, filtres (portée, état, moteur, date), tri, groupes par date,
   « Charger plus », sélection multiple, favoris, archivage, portée. Données factices ; date de référence : jeu. 22 oct. 2026, 18:05. */
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const P2 = window.P2, ME = 'cherif', PAGE = 20;
  const NOW = new Date(2026, 9, 22, 18, 5);
  const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const fmtN = (n, d = 1) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtDur = (s) => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = Math.floor(s % 60); return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`; };
  const fmtSize = (mb) => mb >= 1000 ? fmtN(mb / 1000, 1) + ' Go' : mb >= 10 ? Math.round(mb) + ' Mo' : fmtN(mb, 1) + ' Mo';
  const at = (d, h, m) => new Date(2026, 9, 22 - d, h, m);

  /* ── Données factices ── */
  let id = 0;
  const S = (name, kind, dur, engine, state, owner, scope, when, o = {}) => ({
    id: ++id, name, kind, dur, engine, state, owner, scope, when,
    mb: o.mb ?? (kind === 'video' ? dur / 60 * 4.6 : kind === 'wav' ? dur / 60 * 10.1 : dur / 60 * 1.0),
    fav: !!o.fav, arch: !!o.arch, unread: !!o.unread, rtf: o.rtf ?? 7.1, det: o.det ?? null, p: o.p, rank: o.rank, eta: o.eta, took: o.took, why: o.why,
  });
  const D = {
    fat: 'Al-Fatiha 1:1–7 · Al-Baqara 2:1–5', yus: 'Yusuf 12:11–31', baq: 'Al-Baqara 2:1–25', non: 'Aucun verset reconnu (parole non coranique)', kah: 'Al-Kahf 18:1–10',
    mar: 'Maryam 19:1–15', rah: 'Ar-Rahman 55:1–78', nab: 'An-Naba 78:1–40', mulk: 'Al-Mulk 67:1–30', ikh: 'Al-Ikhlas 112:1–4 · Al-Falaq 113:1–5 · An-Nas 114:1–6', kur: 'Ayat al-Kursi 2:255',
  };
  const L = [
    S('Lot1 12', 'audio', 1122, 'Cascade', 'running', ME, 'global', at(0, 17, 58), { p: 62, eta: '≈ 2 min restantes' }),
    S('Conf ramadan nuit 3', 'video', 4328, 'Cascade', 'queued', ME, 'global', at(0, 14, 31), { rank: 1, eta: '≈ 10 min d’analyse' }),
    S('Enregistrement du 22 oct. à 17:51', 'mic', 252, 'Cascade', 'done', ME, 'private', at(0, 17, 55), { unread: true, rtf: 8.4, took: '30 s', det: D.yus, mb: 4.1 }),
    S('Khutba vendredi', 'video', 2475, 'Cascade', 'done', ME, 'global', at(0, 14, 2), { unread: true, rtf: 7.3, took: '5 min 40 s', det: D.non, mb: 186 }),
    S('Sourate baqara warsh', 'audio', 1268, 'Cascade', 'done', ME, 'global', at(0, 13, 48), { unread: true, rtf: 4.7, took: '4 min 31 s', det: D.baq }),
    S('Recitation fatiha baqara', 'audio', 184.7, 'Cascade', 'done', ME, 'global', at(0, 12, 20), { fav: true, rtf: 7.1, took: '26 s', det: D.fat, mb: 4.2 }),
    S('Micro 55 1 4 muno nuit', 'wav', 372, 'Muno', 'failed', ME, 'global', at(0, 11, 5), { why: 'moteur indisponible' }),
    S('Tajwid cours 4', 'audio', 1930, 'Cascade', 'done', 'amina', 'global', at(0, 9, 40), { rtf: 6.9, took: '4 min 40 s', det: D.non }),
    S('Lot2 05 warsh', 'audio', 1490, 'Cascade', 'cancelled', ME, 'global', at(1, 19, 12), { why: '2 min 10 s' }),
    S('Test 55', 'video', 510, 'Cascade', 'done', ME, 'global', at(1, 16, 20), { rtf: 7.1, took: '1 min 12 s', det: D.kur }),
    S('Récitation Kahf, Yacine', 'audio', 640, 'FastConformer', 'done', 'yacine', 'global', at(1, 10, 3), { rtf: 9.2, took: '1 min 9 s', det: D.kah, fav: true }),
    S('Révision Maryam (privé)', 'audio', 905, 'Cascade', 'done', 'fatou.k', 'private', at(2, 21, 15), { rtf: 7.0, took: '2 min 9 s', det: D.mar }),
    S('Audio importé le 20 oct. à 11:02', 'audio', 722, 'FastConformer', 'done', ME, 'global', at(2, 11, 2), { rtf: 7.1, took: '1 min 41 s', det: D.mulk }),
    S('Ar-Rahman, taraweeh', 'audio', 2210, 'Cascade', 'done', 'moussa_d', 'global', at(3, 22, 40), { rtf: 7.6, took: '4 min 51 s', det: D.rah }),
    S('Recitation du 20 oct. à 17:58', 'audio', 331, 'Whisper', 'done', ME, 'global', at(2, 17, 58), { rtf: 5.2, took: '1 min 4 s', det: D.nab }),
    S('Enfants Juz Amma', 'video', 1180, 'Cascade', 'done', 'amina', 'global', at(3, 15, 10), { rtf: 7.4, took: '2 min 40 s', det: D.ikh }),
  ];
  const owners = ['amina', 'yacine', 'moussa_d', 'fatou.k', ME, ME, ME, 'ibrahim_s'];
  const names = ['Récitation lente Yusuf', 'Cours ghunna et ikhfa', 'Khutba jumu’a', 'Taraweeh nuit 27', 'Lot3 07 hafs', 'Dou’a et rappel', 'Test micro salon', 'Maghrib Ar-Rahman', 'Leçon madd', 'Mishary Al-Kahf', 'Quatre qul', 'Séance du dimanche', 'Révision Juz 30', 'Conférence rappel', 'Tafsir Al-Baqara', 'Warsh nafi 1'];
  const dets = [D.yus, D.kah, D.non, D.rah, D.mar, D.nab, D.mulk, D.ikh, D.baq, D.kur];
  const eng = ['Cascade', 'Cascade', 'Cascade', 'FastConformer', 'Whisper', 'Muno'];
  let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 48; i++) {
    const days = i < 8 ? 3 + Math.floor(rnd() * 2) : i < 20 ? 5 + Math.floor(rnd() * 13) : 24 + Math.floor(rnd() * 70);
    const kind = ['audio', 'audio', 'audio', 'video', 'wav'][Math.floor(rnd() * 5)];
    const dur = Math.round(120 + rnd() * 3400);
    const own = owners[Math.floor(rnd() * owners.length)];
    const nm = names[i % names.length] + (i >= names.length ? ' ' + (Math.floor(i / names.length) + 1) : '');
    const e = eng[Math.floor(rnd() * eng.length)];
    const bad = rnd() < 0.06;
    L.push(S(nm, kind, dur, e, bad ? 'failed' : 'done', own, own !== ME && rnd() < .3 ? 'private' : (own === ME && rnd() < .12 ? 'private' : 'global'), at(days, 8 + Math.floor(rnd() * 12), Math.floor(rnd() * 60)), { rtf: 4.5 + rnd() * 5, took: Math.max(1, Math.round(dur / 7 / 60)) + ' min', det: bad ? null : dets[Math.floor(rnd() * dets.length)], arch: rnd() < .1, fav: own === ME && rnd() < .1, why: 'moteur indisponible' }));
  }
  // Les sessions privées d'un autre testeur ne sont jamais visibles ici
  const visible = (s) => !(s.scope === 'private' && s.owner !== ME);
  const ALL = L.filter(visible).sort((a, b) => b.when - a.when);

  /* ── État ── */
  const st = { scope: 'all', q: '', states: new Set(), engines: new Set(), date: null, from: '', to: '', sort: 'recent', shown: PAGE, sel: new Set(), selectMode: false };
  const demo = P2.etat;
  if (demo === 'aucun') st.q = 'tajwid xyz';

  /* ── Aides ── */
  const dayKey = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const todayK = dayKey(NOW), DAY = 864e5;
  const mondayK = todayK - ((NOW.getDay() + 6) % 7) * DAY;
  const fmtWhen = (d) => { const k = dayKey(d); const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; if (k === todayK) return hm; if (k === todayK - DAY) return 'hier ' + hm; return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const groupOf = (d) => { const k = dayKey(d); if (k === todayK) return 'Aujourd’hui'; if (k === todayK - DAY) return 'Hier'; if (k >= mondayK) return 'Cette semaine'; if (d.getMonth() === NOW.getMonth() && d.getFullYear() === NOW.getFullYear()) return 'Ce mois'; return 'Plus ancien'; };
  const stateKeys = (s) => { const k = []; if (s.state === 'running' || s.state === 'queued') k.push('queue'); if (s.state === 'done') k.push('done'); if (s.unread) k.push('unread'); if (s.state === 'failed') k.push('failed'); if (s.state === 'cancelled') k.push('cancelled'); return k; };
  const STATE_LABELS = { queue: 'En file (en cours, en attente)', unread: 'Non lues', done: 'Terminées', failed: 'En échec', cancelled: 'Annulées' };
  const kindLabel = { audio: 'Audio', wav: 'Audio', mic: 'Micro', video: 'Vidéo' };
  const kindIcon = { audio: 'audio', wav: 'audio', mic: 'mic', video: 'video' };
  const esc = (t) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ic = (n, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;

  function inScope(s) {
    switch (st.scope) {
      case 'mine': return !s.arch && s.owner === ME;
      case 'shared': return !s.arch && s.owner !== ME;
      case 'fav': return !s.arch && s.fav;
      case 'arch': return s.arch;
      default: return !s.arch;
    }
  }
  function matches(s, ignoreScope) {
    if (!ignoreScope && !inScope(s)) return false;
    if (st.q && !(s.name + ' ' + (s.det || '')).toLowerCase().includes(st.q.toLowerCase())) return false;
    if (st.states.size && !stateKeys(s).some(k => st.states.has(k))) return false;
    if (st.engines.size && !st.engines.has(s.engine)) return false;
    const k = dayKey(s.when);
    if (st.date === 'today' && k !== todayK) return false;
    if (st.date === '7' && k < todayK - 6 * DAY) return false;
    if (st.date === '30' && k < todayK - 29 * DAY) return false;
    if (st.date === 'custom') { if (st.from && k < new Date(st.from + 'T00:00').getTime()) return false; if (st.to && k > new Date(st.to + 'T00:00').getTime()) return false; }
    return true;
  }
  const SORTERS = { recent: (a, b) => b.when - a.when, old: (a, b) => a.when - b.when, name: (a, b) => a.name.localeCompare(b.name, 'fr'), dur: (a, b) => b.dur - a.dur, size: (a, b) => b.mb - a.mb };

  /* ── Rendu d'une ligne ── */
  const glyph = (s) => {
    const ring = '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/>';
    switch (s.state) {
      case 'running': return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ring-track" cx="12" cy="12" r="9"/><circle class="ring-arc" cx="12" cy="12" r="9" stroke-dasharray="${(56.55 * s.p / 100).toFixed(1)} 56.55"/></svg>`;
      case 'queued': return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ring-dash" cx="12" cy="12" r="9"/><text class="ring-n" x="12" y="15.6" text-anchor="middle">${s.rank}</text></svg>`;
      case 'failed': return '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-alert"/></svg>';
      case 'cancelled': return `<svg viewBox="0 0 24 24" aria-hidden="true">${ring}<path d="M6 18L18 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
      default: return `<svg viewBox="0 0 24 24" aria-hidden="true">${ring}<path d="M8 12.4l2.7 2.7L16.2 9.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
  };
  const statusText = (s) => ({
    running: `Analyse en cours · ${s.eta}`, queued: `En attente · n° ${s.rank} dans la file · ${s.eta}`,
    failed: `Échec · ${s.why}`, cancelled: `Annulé après ${s.why}`,
    done: s.unread ? `Résultat prêt · ${s.took} · ×${fmtN(s.rtf)}` : `Terminé en ${s.took} · ×${fmtN(s.rtf)}`,
  }[s.state]);
  function rowHTML(s) {
    const mine = s.owner === ME;
    const scope = s.scope === 'private'
      ? `<span class="badge badge--private">${ic('lock')}Privé</span>` : `<span class="badge badge--global">${ic('globe')}Global</span>`;
    const owner = mine ? '<span class="muted">Moi</span>' : `<span title="Propriétaire : ${esc(s.owner)}">${esc(s.owner)}</span>`;
    const det = s.det ? `<span class="sdet">Contenu détecté : <b>${esc(s.det)}</b></span>` : '';
    const bar = s.state === 'running' ? `<span class="sbar" aria-hidden="true"><i style="--p:${s.p}%"></i></span>` : '';
    const sel = st.sel.has(s.id);
    return `<li class="srow" data-id="${s.id}" data-state="${s.state}" data-sel="${sel}"${s.unread ? ' data-unread="true"' : ''}>
      <span class="chk"><label class="check"><input type="checkbox" data-sel-id="${s.id}" ${sel ? 'checked' : ''} aria-label="Sélectionner « ${esc(s.name)} »"></label></span>
      <span class="sg">${glyph(s)}</span>
      <a class="sname" href="index.html"><b>${s.scope === 'private' ? `<svg class="i i-lock-inline" aria-hidden="true" style="margin-right:6px;vertical-align:-2px"><use href="#i-lock"/></svg>` : ''}${esc(s.name)}${s.unread ? '<span class="unread" aria-hidden="true"></span><span class="sr"> Non lue</span>' : ''}</b><span class="sstat">${statusText(s)}</span>${det}</a>
      <span class="smeta">
        <span class="ic">${ic(kindIcon[s.kind])}<span class="sr">${kindLabel[s.kind]}</span><span class="mono">${fmtDur(s.dur)}</span></span>
        <span class="ic mono">${fmtSize(s.mb)}</span>
        <span>${s.engine}</span>
        ${mine ? '' : `<span class="ic">${ic('user')}${esc(s.owner)}</span>`}
        ${scope}
        <span class="mono">${fmtWhen(s.when)}</span>
      </span>
      <span class="sown">${owner}</span><span class="sscope">${scope}</span>
      <span class="sdur"><span class="sr">Durée : </span>${fmtDur(s.dur)}</span><span class="ssize"><span class="sr">Taille : </span>${fmtSize(s.mb)}</span><span class="seng">${s.engine}</span><span class="sdate">${fmtWhen(s.when)}</span>
      <button class="fav" type="button" data-fav aria-pressed="${s.fav}" aria-label="${s.fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}" title="${s.fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${ic('star')}</button>
      <button class="more" type="button" data-more aria-haspopup="menu" aria-expanded="false" aria-label="Actions pour « ${esc(s.name)} »">${ic('more')}</button>
      ${bar}
    </li>`;
  }

  /* ── Rendu de la liste ── */
  const el = { groups: $('#groups'), list: $('#list'), sum: $('#sum'), count: $('#count'), more: $('#more'), selbar: $('#selbar'), afilters: $('#afilters') };
  let lastShown = 0;
  function render(focusFirstNew) {
    $('#err-banner').hidden = demo !== 'erreur';
    el.list.setAttribute('aria-busy', String(demo === 'chargement'));
    el.list.dataset.select = String(st.selectMode);
    // compteurs de portée
    const cnt = { all: 0, mine: 0, shared: 0, fav: 0, arch: 0 };
    ALL.forEach(s => { if (!s.arch) { cnt.all++; if (s.owner === ME) cnt.mine++; else cnt.shared++; if (s.fav) cnt.fav++; } else cnt.arch++; });
    $$('[data-n]').forEach(n => n.textContent = cnt[n.dataset.n]);
    const totalMb = ALL.filter(s => s.owner === ME).reduce((a, s) => a + s.mb, 0);
    const data = demo === 'vide' ? [] : ALL;
    el.sum.textContent = demo === 'vide' ? '0 session' : `${cnt.all} sessions · ${cnt.mine} à toi · ${fmtN(totalMb / 1000, 1)} Go utilisés`;
    $('#more').hidden = true;

    if (demo === 'chargement') {
      el.groups.innerHTML = Array.from({ length: 7 }, () => '<div class="skel" aria-hidden="true"><span class="c"><i></i></span><span class="g"><i></i></span><span class="l"><i></i><i></i></span></div>').join('');
      el.count.textContent = 'Chargement des sessions…'; el.selbar.hidden = true; return;
    }
    if (demo === 'erreur') {
      el.groups.innerHTML = `<div class="state-box state-box--error">${ic('alert', 'i big')}<h2>La liste ne s’est pas chargée</h2><p>Vérifie ta connexion, puis réessaie. Si le problème dure, préviens l’administrateur.</p><div class="acts"><button class="btn btn--secondary" type="button" data-retry-load>Réessayer</button></div></div>`;
      el.count.textContent = ''; el.selbar.hidden = true; return;
    }
    if (demo === 'vide') {
      el.groups.innerHTML = `<div class="state-box"><svg class="hero-wave" viewBox="0 0 220 96" aria-hidden="true"><g class="a" fill="var(--accent)"><rect x="12" y="38" width="5" height="20" rx="2.5"/><rect x="26" y="30" width="5" height="36" rx="2.5"/><rect x="40" y="22" width="5" height="52" rx="2.5"/><rect x="54" y="34" width="5" height="28" rx="2.5"/><rect x="68" y="14" width="5" height="68" rx="2.5"/><rect x="82" y="26" width="5" height="44" rx="2.5"/></g><path d="M110 18l24 30-24 30-24-30z" fill="none" stroke="var(--text)" stroke-width="2"/><g fill="var(--text-3)"><rect x="140" y="26" width="5" height="44" rx="2.5"/><rect x="154" y="34" width="5" height="28" rx="2.5"/><rect x="168" y="18" width="5" height="60" rx="2.5"/><rect x="182" y="30" width="5" height="36" rx="2.5"/><rect x="196" y="40" width="5" height="16" rx="2.5"/></g></svg><h2>Aucune session pour l’instant</h2><p>Enregistre un passage au micro ou importe un audio ou une vidéo : l’analyse démarre toute seule et le résultat apparaît ici.</p><div class="acts"><a class="btn btn--primary" href="index.html#view=new">${ic('plus')}Nouvel essai</a></div></div>`;
      el.count.textContent = ''; el.selbar.hidden = true; return;
    }

    let rows = data.filter(s => matches(s)).sort(SORTERS[st.sort]);
    const total = rows.length;
    el.count.innerHTML = `<b>${total}</b> session${total > 1 ? 's' : ''}${st.scope === 'arch' ? ' archivée' + (total > 1 ? 's' : '') : ''}`;
    renderChips();
    if (!total) {
      const archHint = st.scope !== 'arch' && data.some(s => s.arch && matches(s, true)) ? '<p>Une session correspondante est peut-être dans les archives.</p>' : '';
      el.groups.innerHTML = `<div class="state-box">${ic('search', 'i big')}<h2>Aucune session ne correspond</h2><p>Essaie un autre mot, élargis la période ou retire un filtre.</p>${archHint}<div class="acts"><button class="btn btn--secondary" type="button" data-clear-all>${ic('filter-x')}Effacer les filtres</button></div></div>`;
      el.selbar.hidden = true; return;
    }
    const shown = rows.slice(0, st.shown);
    const byDate = st.sort === 'recent' || st.sort === 'old';
    const groups = []; const idx = new Map();
    shown.forEach(s => { const g = byDate ? groupOf(s.when) : 'Résultats triés'; if (!idx.has(g)) { idx.set(g, groups.length); groups.push({ g, items: [] }); } groups[idx.get(g)].items.push(s); });
    el.groups.innerHTML = groups.map((g, i) => `<section aria-labelledby="g${i}"><div class="grp-head"><h2 id="g${i}">${g.g}</h2><span class="n">${g.items.length}</span></div><ul>${g.items.map(rowHTML).join('')}</ul></section>`).join('');
    if (total > shown.length) {
      el.more.hidden = false; $('#more-p').value = Math.round(shown.length / total * 100);
      $('#more-t').textContent = `${shown.length} sessions affichées sur ${total}`;
      $('#btn-more').textContent = `Charger ${Math.min(PAGE, total - shown.length)} de plus`;
    } else if (total > PAGE) { el.more.hidden = false; $('#more-p').value = 100; $('#more-t').textContent = `Les ${total} sessions sont affichées.`; $('#btn-more').hidden = true; } else $('#btn-more').hidden = false;
    if (focusFirstNew) { const li = $$('.srow', el.groups)[lastShown]; li && $('.sname', li).focus(); }
    lastShown = shown.length;
    syncSelection();
  }

  function renderChips() {
    const chips = [];
    if (st.q) chips.push(['q', `Nom : « ${esc(st.q)} »`]);
    st.states.forEach(k => chips.push(['state:' + k, `État : ${STATE_LABELS[k].split(' (')[0].toLowerCase()}`]));
    st.engines.forEach(k => chips.push(['engine:' + k, `Moteur : ${k}`]));
    if (st.date) chips.push(['date', `Date : ${dateLabel()}`]);
    el.afilters.hidden = !chips.length;
    el.afilters.innerHTML = chips.map(([k, l]) => `<button class="chip chip--x" type="button" data-rm="${k}" aria-label="Retirer le filtre ${l.replace(/<[^>]+>/g, '')}">${l}${ic('x')}</button>`).join('') + (chips.length > 1 ? '<button class="btn btn--ghost btn--sm" type="button" data-clear-all>Tout effacer</button>' : '');
    // boutons de filtre
    const set = (id, text) => { const b = $(id); b.dataset.on = String(!!text); $('.val', b).textContent = text || ''; };
    set('#fb-state', st.states.size ? (st.states.size === 1 ? STATE_LABELS[[...st.states][0]].split(' (')[0] : st.states.size + ' choix') : '');
    set('#fb-engine', st.engines.size ? (st.engines.size === 1 ? [...st.engines][0] : st.engines.size + ' choix') : '');
    set('#fb-date', st.date ? dateLabel(true) : '');
  }
  function dateLabel(short) {
    if (st.date === 'today') return 'aujourd’hui'; if (st.date === '7') return short ? '7 jours' : '7 derniers jours'; if (st.date === '30') return short ? '30 jours' : '30 derniers jours';
    const f = st.from ? new Date(st.from + 'T00:00') : null, t = st.to ? new Date(st.to + 'T00:00') : null; const d = (x) => `${x.getDate()} ${MONTHS[x.getMonth()]}`;
    return f && t ? `${d(f)} → ${d(t)}` : f ? `depuis le ${d(f)}` : t ? `jusqu’au ${d(t)}` : 'personnalisée';
  }

  /* ── Sélection multiple ── */
  const byId = (i) => ALL.find(s => s.id === +i);
  function syncSelection() {
    const boxes = $$('[data-sel-id]'); const n = st.sel.size;
    $$('.srow').forEach(r => r.dataset.sel = String(st.sel.has(+r.dataset.id)));
    const all = $('#sel-all'), allm = $('#sel-all-m-in');
    [all, allm].forEach(a => { a.checked = n > 0 && boxes.length > 0 && boxes.every(b => b.checked); a.indeterminate = n > 0 && !a.checked; });
    if (!n) { el.selbar.hidden = true; return; }
    const sel = [...st.sel].map(byId).filter(Boolean); const mineSel = sel.filter(s => s.owner === ME);
    const arch = st.scope === 'arch'; const allFav = sel.every(s => s.fav); const foreign = sel.length - mineSel.length;
    el.selbar.hidden = false;
    el.selbar.innerHTML = `<span class="cnt" id="sel-cnt">${n} sélectionnée${n > 1 ? 's' : ''}</span>
      <button class="btn btn--secondary btn--sm" type="button" data-act="fav" aria-label="${allFav ? 'Retirer des favoris' : 'Favoris'}">${ic('star')}<span class="txt">${allFav ? 'Retirer des favoris' : 'Favoris'}</span></button>
      <button class="btn btn--secondary btn--sm" type="button" data-act="${arch ? 'restore' : 'archive'}" aria-label="${arch ? 'Restaurer' : 'Archiver'}">${ic(arch ? 'undo' : 'archive')}<span class="txt">${arch ? 'Restaurer' : 'Archiver'}</span></button>
      <span class="pop-wrap"><button class="btn btn--secondary btn--sm" type="button" ${mineSel.length ? '' : 'disabled'} aria-haspopup="menu" aria-expanded="false" aria-controls="scope-menu" aria-label="Portée">${ic('globe')}<span class="txt">Portée</span>${ic('chevron-d')}</button>
        <div class="menu" id="scope-menu" role="menu" aria-label="Changer la portée" hidden style="top:auto;bottom:calc(100% + 8px)"><button class="menu-item" role="menuitem" type="button" data-act="global">${ic('globe')}Rendre global<span class="kbd-end muted" style="font-size:var(--fs-xs)">visible de tous</span></button><button class="menu-item" role="menuitem" type="button" data-act="private">${ic('lock')}Rendre privé<span class="kbd-end muted" style="font-size:var(--fs-xs)">toi seul</span></button></div></span>
      ${arch && mineSel.length ? `<button class="btn btn--danger btn--sm keep-txt" type="button" data-act="delete">${ic('trash')}<span class="txt">Supprimer…</span></button>` : ''}
      <button class="btn btn--ghost btn--sm keep-txt" type="button" data-act="clear"><span class="txt">Annuler</span></button>
      ${foreign ? `<p class="note-s">${foreign} session${foreign > 1 ? 's appartiennent' : ' appartient'} à d’autres testeurs : leur portée ne sera pas modifiée.</p>` : ''}`;
  }
  const toast = (msg, label, fn) => {
    $('.toast')?.remove(); const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status');
    t.innerHTML = `<span>${msg}</span>${label ? `<button type="button">${label}</button>` : ''}`; document.body.appendChild(t);
    if (label) $('button', t).addEventListener('click', () => { fn(); t.remove(); });
    setTimeout(() => t.remove(), 6000);
  };
  function act(a) {
    const sel = [...st.sel].map(byId).filter(Boolean); const mine = sel.filter(s => s.owner === ME);
    if (a === 'clear') { st.sel.clear(); render(); return; }
    if (a === 'fav') { const all = sel.every(s => s.fav); sel.forEach(s => s.fav = !all); P2.say(all ? 'Retirés des favoris' : 'Ajoutés aux favoris'); st.sel.clear(); render(); return; }
    if (a === 'archive' || a === 'restore') { const to = a === 'archive'; sel.forEach(s => s.arch = to); const n = sel.length; st.sel.clear(); render(); toast(`${n} session${n > 1 ? 's' : ''} ${to ? 'archivée' : 'restaurée'}${n > 1 ? 's' : ''}`, 'Annuler', () => { sel.forEach(s => s.arch = !to); render(); }); return; }
    if (a === 'global' || a === 'private') {
      if (a === 'global' && mine.some(s => s.scope === 'private') && !el.selbar.dataset.ok) {
        el.selbar.innerHTML = `<span class="cnt" style="flex-basis:100%;margin:0">Rendre ${mine.length} session${mine.length > 1 ? 's' : ''} visible${mine.length > 1 ? 's' : ''} de tous les testeurs ?</span><p class="note-s" style="display:block">Tout le monde pourra écouter l’audio et voir ses résultats. Tu pourras la repasser en privé à tout moment.</p><button class="btn btn--primary btn--sm" type="button" data-act="global-ok">Rendre global</button><button class="btn btn--ghost btn--sm" type="button" data-act="back">Annuler</button>`; return;
      }
      mine.forEach(s => s.scope = a); st.sel.clear(); render(); toast(`${mine.length} session${mine.length > 1 ? 's' : ''} ${a === 'global' ? 'rendue' : 'rendue'}${mine.length > 1 ? 's' : ''} ${a === 'global' ? 'globale' : 'privée'}${mine.length > 1 ? 's' : ''}`); return;
    }
    if (a === 'global-ok') { mine.forEach(s => s.scope = 'global'); st.sel.clear(); render(); toast(`${mine.length} session${mine.length > 1 ? 's' : ''} rendue${mine.length > 1 ? 's' : ''} globale${mine.length > 1 ? 's' : ''}`); return; }
    if (a === 'back') { syncSelection(); return; }
    if (a === 'delete') {
      const mb = mine.reduce((x, s) => x + s.mb, 0);
      el.selbar.innerHTML = `<span class="cnt" style="flex-basis:100%;margin:0">Supprimer définitivement ${mine.length} session${mine.length > 1 ? 's' : ''} ?</span><p class="note-s" style="display:block">L’audio, l’analyse et les signalements seront effacés (≈ ${fmtSize(mb)} libérés). Cette action est irréversible.</p><button class="btn btn--danger btn--sm" type="button" data-act="delete-ok">${ic('trash')}Supprimer définitivement</button><button class="btn btn--ghost btn--sm" type="button" data-act="back">Annuler</button>`; return;
    }
    if (a === 'delete-ok') { const ids = new Set(mine.map(s => s.id)); for (let i = ALL.length - 1; i >= 0; i--) if (ids.has(ALL[i].id)) ALL.splice(i, 1); st.sel.clear(); render(); toast(`${ids.size} session${ids.size > 1 ? 's' : ''} supprimée${ids.size > 1 ? 's' : ''}`); }
  }

  /* ── Événements ── */
  document.addEventListener('click', e => {
    const t = e.target;
    const sc = t.closest('#scopes button'); if (sc) { st.scope = sc.dataset.scope; st.shown = PAGE; st.sel.clear(); $$('#scopes button').forEach(b => b.setAttribute('aria-pressed', String(b === sc))); render(); return; }
    const rm = t.closest('[data-rm]'); if (rm) { const [k, v] = rm.dataset.rm.split(':'); if (k === 'q') { st.q = ''; $('#q').value = ''; $('#q-clear').hidden = true; } else if (k === 'state') st.states.delete(v); else if (k === 'engine') st.engines.delete(v); else { st.date = null; } syncPops(); st.shown = PAGE; render(); return; }
    if (t.closest('[data-clear-all]')) { st.q = ''; $('#q').value = ''; $('#q-clear').hidden = true; st.states.clear(); st.engines.clear(); st.date = null; syncPops(); st.shown = PAGE; if (demo === 'aucun') { history.replaceState(null, '', location.pathname); } render(); return; }
    const cl = t.closest('[data-clear]'); if (cl) { if (cl.dataset.clear === 'state') st.states.clear(); if (cl.dataset.clear === 'engine') st.engines.clear(); if (cl.dataset.clear === 'date') st.date = null; syncPops(); render(); return; }
    if (t.closest('[data-close-pop]')) { P2.closeMenus(); return; }
    if (t.closest('[data-retry-load], #btn-retry')) { const u = new URL(location.href); u.searchParams.delete('etat'); location.href = u.toString(); return; }
    const dp = t.closest('#date-presets .chip'); if (dp) { st.date = dp.dataset.p; $('#date-range').hidden = st.date !== 'custom'; syncPops(); st.shown = PAGE; render(); return; }
    if (t.closest('#btn-more')) { st.shown += PAGE; render(true); P2.say(`${Math.min(st.shown, ALL.length)} sessions affichées`); return; }
    if (t.closest('#btn-select')) { st.selectMode = !st.selectMode; $('#btn-select').setAttribute('aria-pressed', String(st.selectMode)); $('#btn-select').textContent = st.selectMode ? 'Terminer' : 'Sélectionner'; if (!st.selectMode) st.sel.clear(); render(); return; }
    const a = t.closest('[data-act]'); if (a) { act(a.dataset.act); return; }
    const so = t.closest('.shead [data-sort]'); if (so) { st.sort = st.sort === so.dataset.sort && so.dataset.sort === 'recent' ? 'old' : so.dataset.sort; $('#sort').value = st.sort; syncSort(); render(); return; }
    const more = t.closest('[data-more]'); if (more) { openRowMenu(more); return; }
    if (!t.closest('.menu, .fpop')) closeRowMenu();
  });
  document.addEventListener('change', e => {
    const c = e.target.closest('[data-sel-id]'); if (c) { c.checked ? st.sel.add(+c.dataset.selId) : st.sel.delete(+c.dataset.selId); syncSelection(); return; }
    if (e.target.matches('#sel-all, #sel-all-m-in')) { $$('[data-sel-id]').forEach(b => { b.checked = e.target.checked; e.target.checked ? st.sel.add(+b.dataset.selId) : st.sel.delete(+b.dataset.selId); }); syncSelection(); return; }
    if (e.target.id === 'sort') { st.sort = e.target.value; syncSort(); st.shown = PAGE; render(); return; }
    const o = e.target.closest('[data-opt]'); if (o) { const set = o.dataset.opt === 'state' ? st.states : st.engines; o.checked ? set.add(o.value) : set.delete(o.value); st.shown = PAGE; render(); return; }
    if (e.target.id === 'd-from') { st.from = e.target.value; st.shown = PAGE; render(); } if (e.target.id === 'd-to') { st.to = e.target.value; st.shown = PAGE; render(); }
  });
  let tq; $('#q').addEventListener('input', e => { clearTimeout(tq); $('#q-clear').hidden = !e.target.value; tq = setTimeout(() => { st.q = e.target.value.trim(); st.shown = PAGE; render(); P2.say(el.count.textContent); }, 180); });
  $('#q-clear').addEventListener('click', () => { $('#q').value = ''; st.q = ''; $('#q-clear').hidden = true; render(); $('#q').focus(); });
  document.addEventListener('fav-change', e => { const li = e.target.closest('.srow'); if (!li) return; const s = byId(li.dataset.id); s.fav = e.detail.on; if (st.scope === 'fav' && !s.fav) setTimeout(render, 200); else { const n = ALL.filter(x => !x.arch && x.fav).length; $('[data-n="fav"]').textContent = n; } });
  function syncSort() { $$('.shead [data-sort]').forEach(b => { const on = b.dataset.sort === st.sort || (b.dataset.sort === 'recent' && st.sort === 'old'); if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); b.dataset.dir = on ? (st.sort === 'old' ? 'asc' : 'desc') : ''; }); }

  /* ── Filtres : contenu des fenêtres ── */
  function buildPops() {
    const cnt = (f) => ALL.filter(s => !s.arch && f(s)).length;
    $('#state-opts').innerHTML = Object.entries(STATE_LABELS).map(([k, l]) => `<label class="check"><input type="checkbox" data-opt="state" value="${k}" ${st.states.has(k) ? 'checked' : ''}>${l}<span class="n">${cnt(s => stateKeys(s).includes(k))}</span></label>`).join('');
    const engines = [...new Set(ALL.map(s => s.engine))].sort();
    $('#engine-opts').innerHTML = engines.map(k => `<label class="check"><input type="checkbox" data-opt="engine" value="${k}" ${st.engines.has(k) ? 'checked' : ''}>${k}<span class="n">${cnt(s => s.engine === k)}</span></label>`).join('');
  }
  function syncPops() { buildPops(); $$('#date-presets .chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.p === st.date))); $('#date-range').hidden = st.date !== 'custom'; }

  /* ── Menu ⋯ d'une ligne ── */
  let menu = null;
  function closeRowMenu() { if (menu) { menu.remove(); menu = null; } $$('[data-more][aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false')); $('.sheet-scrim')?.remove(); }
  function openRowMenu(btn) {
    const wasOpen = btn.getAttribute('aria-expanded') === 'true'; P2.closeMenus(); closeRowMenu(); if (wasOpen) return;
    const s = byId(btn.closest('.srow').dataset.id); const mine = s.owner === ME;
    menu = document.createElement('div'); menu.className = 'menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Actions de la session');
    menu.innerHTML = `<a class="menu-item" role="menuitem" href="index.html">${ic('arrow-r')}Ouvrir</a>
      ${mine ? `<button class="menu-item" role="menuitem" type="button" data-m="rename">${ic('edit')}Renommer</button>` : ''}
      <button class="menu-item" role="menuitem" type="button" data-m="fav">${ic('star')}${s.fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}</button>
      ${mine ? `<button class="menu-item" role="menuitem" type="button" data-m="scope">${ic(s.scope === 'private' ? 'globe' : 'lock')}${s.scope === 'private' ? 'Rendre global' : 'Rendre privé'}</button>` : ''}
      <div class="menu-sep"></div>
      <button class="menu-item" role="menuitem" type="button" data-m="arch">${ic(s.arch ? 'undo' : 'archive')}${s.arch ? 'Restaurer' : 'Archiver'}</button>`;
    document.body.appendChild(menu); btn.setAttribute('aria-expanded', 'true');
    if (matchMedia('(max-width: 767px)').matches) { const sc = document.createElement('div'); sc.className = 'sheet-scrim'; sc.addEventListener('click', closeRowMenu); document.body.appendChild(sc); }
    else { const r = btn.getBoundingClientRect(); menu.style.position = 'fixed'; menu.style.width = '250px'; menu.style.top = Math.min(r.bottom + 4, innerHeight - menu.offsetHeight - 8) + 'px'; menu.style.left = Math.max(8, r.right - 250) + 'px'; menu.style.right = 'auto'; }
    $('[role="menuitem"]', menu).focus();
    menu.addEventListener('click', ev => {
      const m = ev.target.closest('[data-m]'); if (!m) return; const k = m.dataset.m; closeRowMenu();
      if (k === 'fav') { s.fav = !s.fav; render(); P2.say(s.fav ? 'Ajouté aux favoris' : 'Retiré des favoris'); }
      if (k === 'arch') { s.arch = !s.arch; render(); toast(`« ${esc(s.name)} » ${s.arch ? 'archivée' : 'restaurée'}`, 'Annuler', () => { s.arch = !s.arch; render(); }); }
      if (k === 'scope') { s.scope = s.scope === 'private' ? 'global' : 'private'; render(); toast(`« ${esc(s.name)} » est maintenant ${s.scope === 'private' ? 'privée' : 'globale'}`); }
      if (k === 'rename') { const li = $(`.srow[data-id="${s.id}"] .sname b`); const v = prompt('Nouveau nom de la session', s.name); if (v && v.trim()) { s.name = v.trim(); render(); P2.say('Nom enregistré'); } }
    });
    menu.addEventListener('keydown', ev => { if (ev.key === 'Escape') { closeRowMenu(); btn.focus(); } });
  }
  addEventListener('scroll', () => closeRowMenu(), { passive: true });

  /* ── Démonstration ── */
  $('#demo-state').value = demo || '';
  $('#demo-state').addEventListener('change', e => { const u = new URL(location.href); if (e.target.value) u.searchParams.set('etat', e.target.value); else u.searchParams.delete('etat'); location.href = u.toString(); });
  const qp = new URLSearchParams(location.search);
  if (qp.get('portee')) { st.scope = qp.get('portee'); $$('#scopes button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scope === st.scope))); }
  if (qp.get('date')) { st.date = qp.get('date'); }
  if (qp.get('etatf')) qp.get('etatf').split(',').forEach(k => st.states.add(k));
  if (qp.get('select')) { st.selectMode = true; $('#btn-select').setAttribute('aria-pressed', 'true'); $('#btn-select').textContent = 'Terminer'; }
  if (qp.get('sel')) qp.get('sel').split(',').forEach(i => st.sel.add(+i));
  if (demo === 'aucun') { $('#q').value = st.q; $('#q-clear').hidden = false; }
  buildPops(); syncPops(); render();
  if (qp.get('ouvert')) setTimeout(() => $('#fb-' + qp.get('ouvert'))?.click(), 80);
  if (qp.get('menu')) setTimeout(() => $('.srow [data-more]')?.click(), 80);
})();
