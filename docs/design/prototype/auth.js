/* Connexion / inscription — validation factice, états de démonstration (?etat=…). Aucune donnée n'est envoyée. */
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const page = document.body.dataset.page;
  const form = $('#form'), alertBox = $('#form-alert'), submit = $('#submit');
  const states = page === 'login'
    ? [['', 'Formulaire vierge'], ['creds', 'Identifiants refusés'], ['limit', 'Trop d’essais'], ['sending', 'Envoi en cours'], ['down', 'Serveur indisponible']]
    : [['', 'Formulaire vierge'], ['first', 'Premier inscrit (administrateur)'], ['taken', 'Pseudonyme déjà pris'], ['short', 'Mot de passe trop court'], ['sending', 'Envoi en cours'], ['down', 'Serveur indisponible']];
  const sel = $('#demo-state');
  states.forEach(([v, l]) => sel.add(new Option(l, v)));
  const q = new URLSearchParams(location.search).get('etat') || '';
  sel.value = q;
  sel.addEventListener('change', () => { const u = new URL(location.href); if (sel.value) u.searchParams.set('etat', sel.value); else u.searchParams.delete('etat'); location.href = u.toString(); });

  const setInvalid = (name, on, msg) => { const f = $(`[data-f="${name}"]`); if (!f) return; f.dataset.invalid = String(on); const inp = $('input', f); inp.setAttribute('aria-invalid', String(on)); if (msg) { const t = $(`#e-${name === 'user' ? 'user' : 'pw'}-t`) || $(`#e-${name === 'user' ? 'user' : 'pw'} span`); if (t) t.textContent = msg; } };
  const showAlert = (t, d) => { $('#alert-t').textContent = t; $('#alert-d').textContent = d || ''; alertBox.hidden = false; };
  const sending = (on) => { submit.disabled = on; submit.innerHTML = on ? 'Envoi…' : (page === 'login' ? 'Se connecter' : 'Créer mon compte'); submit.setAttribute('aria-busy', String(on)); };

  // Afficher / masquer le mot de passe
  $$('[data-toggle-pw]').forEach(b => b.addEventListener('click', () => {
    const inp = $('input', b.parentElement); const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password'; b.setAttribute('aria-pressed', String(show));
    b.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
    $('use', b).setAttribute('href', show ? '#i-eye-off' : '#i-eye');
  }));

  // Force du mot de passe (inscription) : sobre, trois niveaux, jamais de couleur seule
  if (page === 'register') {
    const pw = $('input[name=password]'), strength = $('#strength'), lbl = $('#str-l');
    const level = (v) => { if (!v) return 0; if (v.length < 10) return 1; const classes = [/[a-zà-ÿ]/, /[A-ZÀ-Ý]/, /\d/, /[^\wà-ÿÀ-Ý]/].filter(r => r.test(v)).length; return (v.length >= 16 || (v.length >= 12 && classes >= 3) || /\s\S+\s/.test(v)) ? 3 : 2; };
    pw.addEventListener('input', () => { const l = level(pw.value); strength.dataset.level = String(l); lbl.textContent = ['', `Trop court (${pw.value.length}/10)`, 'Acceptable', 'Solide'][l]; if (l >= 2) setInvalid('pw', false); });
    $('#first-note').hidden = q !== 'first';
  }

  // États de démonstration
  if (q === 'creds') showAlert('Pseudonyme ou mot de passe incorrect.', 'Vérifie les deux champs et réessaie.');
  if (q === 'limit') showAlert('Trop d’essais.', 'Par sécurité, la connexion est suspendue 2 minutes. Réessaie ensuite.');
  if (q === 'down') showAlert('Le serveur ne répond pas.', 'Rien n’est perdu : réessaie dans un instant.');
  if (q === 'sending') sending(true);
  if (q === 'taken') { $('input[name=username]').value = 'amina'; setInvalid('user', true, 'Ce pseudonyme est déjà pris. Essaie-en un autre.'); }
  if (q === 'short') { $('input[name=username]').value = 'yacine'; const pw = $('input[name=password]'); pw.value = 'soleil2026'.slice(0, 7); pw.dispatchEvent(new Event('input')); setInvalid('pw', true, 'Il manque 3 caractères : 10 au minimum.'); }

  // Envoi factice
  form.addEventListener('submit', e => {
    e.preventDefault(); alertBox.hidden = true;
    const u = $('input[name=username]'), p = $('input[name=password]');
    let bad = false;
    if (!u.value.trim()) { setInvalid('user', true, page === 'login' ? 'Indique ton pseudonyme.' : 'Choisis un pseudonyme.'); bad = true; } else if (page === 'register' && !/^[A-Za-z0-9._-]{3,24}$/.test(u.value.trim())) { setInvalid('user', true, 'Utilise 3 à 24 caractères : lettres, chiffres, point, tiret, souligné.'); bad = true; } else setInvalid('user', false);
    if (!p.value) { setInvalid('pw', true, page === 'login' ? 'Indique ton mot de passe.' : 'Choisis un mot de passe de 10 caractères au moins.'); bad = true; } else if (page === 'register' && p.value.length < 10) { setInvalid('pw', true, `Il manque ${10 - p.value.length} caractère${10 - p.value.length > 1 ? 's' : ''} : 10 au minimum.`); bad = true; } else setInvalid('pw', false);
    if (bad) { $('[data-invalid="true"] input')?.focus(); return; }
    sending(true);
    setTimeout(() => { sending(false); if (page === 'login') { showAlert('Pseudonyme ou mot de passe incorrect.', 'Vérifie les deux champs et réessaie.'); p.value = ''; p.focus(); } else { location.href = 'index.html'; } }, 700);
  });
})();
