/* Documentation — navigation latérale, sommaire de page avec suivi de lecture, filtre des documents,
   notes de version filtrables, tiroir des documents sur mobile. Le contenu est factice (extraits de docs/). */
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const P2 = window.P2;
  const slugs = $$('#docs-nav .dlink').map(a => ({ slug: a.dataset.slug, title: $('.nm', a).textContent, group: a.closest('.dgroup').querySelector('h2').textContent }));
  const docs = new Map($$('.doc').map(a => [a.dataset.slug, a]));
  let io = null;

  function open(slug, push) {
    let art = docs.get(slug); const meta = slugs.find(s => s.slug === slug) || slugs[2];
    if (!art) { art = docs.get('__stub'); $('#stub-h').textContent = meta.title; $('#stub-src').textContent = 'docs/' + meta.title.toUpperCase().replace(/[^A-Z0-9]+/g, '-') + '.md'; art.dataset.title = meta.title; art.dataset.group = meta.group; }
    docs.forEach(a => a.hidden = a !== art);
    $$('.dlink').forEach(a => { if (a.dataset.slug === slug) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $('#crumb-g').textContent = art.dataset.group || meta.group; $('#crumb-t').textContent = art.dataset.title || meta.title;
    document.title = (art.dataset.title || meta.title) + ' — Documentation';
    if (push) history.pushState(null, '', 'docs.html?doc=' + slug);
    buildToc(art); buildPn(slug); scrollTo(0, 0);
    P2.say('Page : ' + (art.dataset.title || meta.title));
  }
  function buildToc(art) {
    const hs = $$('h2[id], h3[id]', art).filter(h => !h.closest('.rn-card'));
    const html = hs.map(h => `<li><a class="${h.tagName === 'H3' ? 'l3' : ''}" href="#${h.id}">${h.childNodes[0].textContent.trim()}</a></li>`).join('');
    ['#toc-list', '#toc-list-m'].forEach(s => { $(s).innerHTML = html; });
    $('.docs-toc').hidden = !hs.length; $('#toc-m').hidden = !hs.length;
    if (io) io.disconnect();
    io = new IntersectionObserver(es => { es.forEach(en => { if (en.isIntersecting) { $$('.toc-list a').forEach(a => a.removeAttribute('aria-current')); $$(`.toc-list a[href="#${en.target.id}"]`).forEach(a => a.setAttribute('aria-current', 'true')); } }); }, { rootMargin: '-72px 0px -70% 0px' });
    hs.forEach(h => io.observe(h));
  }
  function buildPn(slug) {
    const i = slugs.findIndex(s => s.slug === slug); const prev = slugs[i - 1], next = slugs[i + 1];
    $('#pn').innerHTML = (prev ? `<a class="prev" href="docs.html?doc=${prev.slug}" data-go="${prev.slug}"><small>Précédent</small><b>${prev.title}</b></a>` : '<span></span>') + (next ? `<a class="next" href="docs.html?doc=${next.slug}" data-go="${next.slug}"><small>Suivant</small><b>${next.title}</b></a>` : '');
  }

  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="docs.html?doc="], a[data-go]'); if (!a) return;
    const slug = new URL(a.href).searchParams.get('doc'); if (!slug) return;
    e.preventDefault(); closeDrawer(); open(slug, true);
  });
  addEventListener('popstate', () => open(new URLSearchParams(location.search).get('doc') || 'architecture', false));

  /* Filtre de la navigation */
  document.addEventListener('input', e => {
    const f = e.target.closest('[data-docs-filter]'); if (!f) return; const q = f.value.trim().toLowerCase();
    $$('.dlink').forEach(a => a.hidden = !!q && !a.textContent.toLowerCase().includes(q));
    $$('.dgroup').forEach(g => g.hidden = !!q && !$$('.dlink', g).some(a => !a.hidden));
    $$('[data-docs-filter]').forEach(x => { if (x !== f) x.value = f.value; });
  });

  /* Tiroir des documents (mobile / tablette) */
  const drawer = $('#docs-drawer'); let scrim = null;
  function openDrawer() { drawer.dataset.open = 'true'; $('#docs-open').setAttribute('aria-expanded', 'true'); scrim = document.createElement('div'); scrim.className = 'sheet-scrim'; scrim.addEventListener('click', closeDrawer); document.body.appendChild(scrim); $('a[aria-current="page"], .dlink', drawer)?.focus(); }
  function closeDrawer() { drawer.dataset.open = 'false'; $('#docs-open').setAttribute('aria-expanded', 'false'); scrim?.remove(); scrim = null; }
  $('#docs-open').addEventListener('click', e => { e.stopPropagation(); drawer.dataset.open === 'true' ? closeDrawer() : openDrawer(); });
  $('#docs-close').addEventListener('click', closeDrawer);
  addEventListener('keydown', e => { if (e.key === 'Escape' && drawer.dataset.open === 'true') { closeDrawer(); $('#docs-open').focus(); } });
  // le bouton « Documents » ouvre un tiroir : on neutralise le comportement de menu générique de phase2.js
  $('#docs-open').removeAttribute('aria-haspopup');

  /* Notes de version : filtres par type */
  document.addEventListener('click', e => {
    const c = e.target.closest('.rn-filters .chip'); if (!c) return;
    $$('.rn-filters .chip').forEach(x => x.setAttribute('aria-pressed', String(x === c)));
    const t = c.dataset.tag; let n = 0;
    $$('#rn-list > li').forEach(li => { const ok = t === 'all' || li.dataset.tags.split(' ').includes(t); li.hidden = !ok; if (ok) n++; });
    P2.say(`${n} entrée${n > 1 ? 's' : ''} affichée${n > 1 ? 's' : ''}`);
  });

  open(new URLSearchParams(location.search).get('doc') || 'architecture', false);
  if (location.hash) setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView(), 50);
})();
