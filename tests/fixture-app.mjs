// qa-reviewer self-test app: a tiny site with planted defects that the sweep
// and the graph check must catch (see tests/selftest.mjs).
//   - "Exporter CSV" hidden on mobile, nav hidden on mobile (parity)
//   - /dashboard: 1200px table (overflow), 18px button (touch), /api/items 500
//     (console + failed request), no session check (anonymous access)
//   - /items: "Supprimer" only visible on hover, total "NaN €" when empty,
//     search field without label
import http from 'node:http';

const PORT = Number(process.env.PORT || 4319);
const css = `body{font-family:sans-serif;margin:0} header{display:flex;gap:16px;padding:12px;background:#eee}
nav a{margin-right:12px} .desktop-only{display:inline-block}
@media (max-width:768px){ nav{display:none} .desktop-only{display:none} }
.wide{width:1200px;border:1px solid #ccc} .tiny{width:18px;height:18px;padding:0;font-size:10px}
.row .del{opacity:0} .row:hover .del{opacity:1}`;
const layout = (title, body, extra = '') => `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${css}</style></head>
<body><header><strong>Fixture</strong><nav><a href="/">Accueil</a><a href="/dashboard">Tableau de bord</a>
<a href="/items">Articles</a><a href="/settings">Paramètres</a><a href="/logout">Déconnexion</a></nav></header><main>${body}</main>${extra}</body></html>`;
const authed = req => /(?:^|;\s*)sid=user1/.test(req.headers.cookie || '');

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const html = (s, code = 200) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' }); res.end(s); };
  if (url.pathname === '/') return html(layout('Accueil', '<h1>Accueil</h1><button class="desktop-only">Exporter CSV</button>'));
  if (url.pathname === '/login' && req.method === 'GET')
    return html(layout('Connexion', '<form method="post" action="/login"><input name="email" placeholder="Email"><input name="password" type="password" placeholder="Mot de passe"><button>Se connecter</button></form>'));
  if (url.pathname === '/login' && req.method === 'POST') { res.writeHead(303, { location: '/dashboard', 'set-cookie': 'sid=user1; Path=/' }); return res.end(); }
  if (url.pathname === '/dashboard')
    return html(layout('Tableau de bord', '<h1>Tableau de bord</h1><table class="wide"><tr><td>Item</td><td>Prix</td></tr></table><button class="tiny" aria-label="Supprimer">x</button>',
      `<script>fetch('/api/items').then(r=>{ if(!r.ok) throw new Error('items '+r.status) }).catch(e=>console.error(e.message))</script>`));
  if (url.pathname === '/items') {
    const empty = url.searchParams.get('empty') === '1';
    const rows = empty ? '' : '<div class="row">Clavier 49 € <button class="del">Supprimer</button></div>';
    const total = empty ? 'NaN' : '49';
    return html(layout('Articles', `<h1>Articles</h1><input name="q"><div>${rows}</div><p>Total : ${total} €</p>`));
  }
  if (url.pathname === '/settings') {
    if (!authed(req)) { res.writeHead(302, { location: '/login' }); return res.end(); }
    return html(layout('Paramètres', '<h1>Paramètres</h1><button>Enregistrer</button>'));
  }
  if (url.pathname === '/api/items') { res.writeHead(500, { 'content-type': 'application/json' }); return res.end('{"error":"boom"}'); }
  html('not found', 404);
}).listen(PORT, () => console.log(`fixture on http://localhost:${PORT}`));
