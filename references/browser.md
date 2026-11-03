# Piloter l'application dans un navigateur

Outil : `playwright-cli`. Son chemin exact (`PWCLI`) est donné par `node $QA_HOME/scripts/doctor.mjs`. Une **session nommée par agent et par lot** (`-s=<agent>-<lot>`), pour que vingt spécialistes travaillent en parallèle sans se gêner. Les profils de viewport sont générés par `qa.mjs init` dans `$RUN/profiles/<viewport>.json` (dimensions dans `references/checks.json`).

**playwright-cli travaille dans le dossier courant** : il y écrit ses snapshots (`./.playwright-cli/`) et y résout les noms de fichiers. La fonction `pw` ci-dessous s'exécute donc toujours depuis `$RUN`, même après un `cd "$PROJECT"` (pour `qa.mjs reports`, par exemple) : les chemins relatifs de tes captures partent de `$RUN`. N'appelle jamais `"$PWCLI"` directement hors de `$RUN`.

## Recettes

```bash
cd "$RUN"; SESSION=qa-ui-states-w1-b1
pw() { (cd "$RUN" && "$PWCLI" -s="$SESSION" "$@"); }   # PWCLI peut contenir des espaces : toujours entre guillemets

# Ouvrir avec un profil, puis vérifier le viewport réel
pw open --config="$RUN/profiles/mobile.json" "$BASE_URL"
pw eval "() => [document.documentElement.clientWidth, visualViewport.height, devicePixelRatio, navigator.maxTouchPoints].join('x')"

# Se connecter avec un état sauvegardé par le cartographe
pw state-load auth-user.json
pw goto "$BASE_URL/dashboard"

# Trouver un élément (ref), agir
pw find "Enregistrer"                 # → button "Enregistrer" [ref=e8]
pw fill e6 "qa-test"
pw click e8
pw press Tab                          # navigation clavier
pw hover e12                          # révèle un menu au survol

# Preuves
pw screenshot --filename=screens/$SESSION/STA-001-empty.png
pw console                            # messages console de la page
pw requests                           # requêtes depuis le chargement

# État VIDE / ERREUR : réponse simulée
pw route "**/api/items" --status=200 --body='[]' --content-type=application/json
pw route "**/api/items" --status=500
pw unroute

# HORS LIGNE
pw network-state-set offline
pw network-state-set online

# CHARGEMENT : réponse retardée, capture pendant l'attente
pw run-code "async page => { await page.route('**/api/items', async r => { await new Promise(x => setTimeout(x, 4000)); await r.continue(); }); }"
pw goto "$BASE_URL/items"
pw screenshot --filename=screens/$SESSION/items-loading.png
pw run-code "async page => { await page.unrouteAll({ behavior: 'ignoreErrors' }); return 'cleared'; }"

# DOUBLE ENVOI : compter les écritures déclenchées par un double clic
pw run-code "async page => { const hits = []; page.on('request', r => { if (r.method() !== 'GET') hits.push(r.method() + ' ' + new URL(r.url()).pathname); }); await page.getByRole('button', { name: 'Enregistrer' }).dblclick(); await page.waitForTimeout(1500); return hits; }"

# VRAI TAP (profils tactiles)
pw run-code "async page => { await page.getByRole('button', { name: 'Menu' }).tap(); return 'ok'; }"

# ACCESSIBILITÉ : axe-core embarqué dans qa-reviewer
pw run-code "async page => { await page.addScriptTag({ path: '$QA_HOME/node_modules/axe-core/axe.min.js' }); return await page.evaluate(async () => { const r = await axe.run(document, { resultTypes: ['violations'] }); return r.violations.filter(v => ['serious','critical'].includes(v.impact)).map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target })); }); }"

# FOCUS : quel élément a le focus après N tabulations
pw press Tab
pw eval "() => { const e = document.activeElement; const s = getComputedStyle(e); return [e.tagName, e.getAttribute('aria-label') || e.innerText?.slice(0,40), s.outlineStyle, s.outlineWidth, s.boxShadow].join(' | '); }"

# ZOOM 200 % (équivalent WCAG : 320 px CSS) et ORIENTATION
pw resize 320 640
pw resize 844 390                     # paysage mobile

# DEUX ONGLETS (concurrence)
pw tab-new "$BASE_URL/items/1/edit"
pw tab-select 0

# Fin de mission
pw close
```

## Balayage automatique

Le cartographe a lancé `scripts/sweep.mjs` sur chaque viewport actif. Résultats dans `$RUN/sweep/<viewport>/sweep.json` et captures `$RUN/sweep/<viewport>/<route>.png`. Par route : `status`, `finalUrl`, `consoleErrors`, `pageErrors`, `failedRequests`, `overflow` (+ éléments fautifs), `smallTargets` (tactile ; `critical` sous 24 px), `inventory` (actions visibles et cachées), `anonProbe.suspect` (route protégée qui répond 2xx sans session). Commence par ces résultats avant d'ouvrir un navigateur : ils répondent déjà à une partie de tes cases.

Relancer sur une seule route :

```bash
cd "$RUN" && echo '["/items"]' > scratch/one.json && node "$QA_HOME/scripts/sweep.mjs" crawl --base "$BASE_URL" --routes scratch/one.json --viewport mobile --out scratch/sweep-items
```

## Pièges connus

- **Les refs changent à chaque navigation** : refaire `find` ou `snapshot` après chaque `goto` ou redirection, sinon « Ref not found ».
- **`requests` repart de zéro à chaque navigation** : un POST suivi d'une redirection disparaît. Pour compter des envois, utiliser la recette du double envoi.
- **Les routes posées via `run-code` sont invisibles pour `route-list` et `unroute`** : les retirer avec `page.unrouteAll`, sinon le mock fausse la suite.
- **En émulation mobile, `innerWidth` grandit jusqu'à la largeur du contenu qui déborde** : mesurer avec `document.documentElement.clientWidth`.
- **Un `<form>` HTML natif double-cliqué n'envoie qu'un POST** (le navigateur dédoublonne). Le risque est dans les handlers JS (`fetch`, server actions, mutations).
- **Profils `isolated`** : les cookies sont perdus à la fermeture. `state-save` avant `close` si besoin.
- **Sous zsh, `echo =====` échoue** (`=mot` est une expansion de chemin) et fausse la suite de la commande. Pour séparer des sorties : `echo '-----'`, entre guillemets.
- **Rien ne survit d'un `run-code` à l'autre**, pas même `globalThis` : fais la mise en place et la mesure dans le même `run-code`.
- **La sortie de `run-code` et `eval` est du JSON encodé deux fois** : retourne une chaîne simple ou un tableau court, et décode avec `JSON.parse` si tu dois traiter le résultat.
- **Une action (`click`, `fill`) attend la fin de la navigation qu'elle déclenche** : pour observer l'interface pendant un envoi lent, clique et capture dans le même `run-code` (`await Promise.all([page.click(sel), page.waitForTimeout(500)])`, puis `page.screenshot`).
- **`anonProbe.suspect` est une heuristique** : une SPA qui affiche le formulaire de connexion sur la même URL est aussi signalée. Regarder la capture avant de conclure.
- **Pas de `browserName` dans les profils** : sans ce champ, playwright-cli prend le Chrome installé si son Chromium embarqué manque.
