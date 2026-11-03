# Découverte d'un projet

## Inventaire automatique

```bash
node "$QA_HOME/scripts/qa.mjs" discover "$PROJECT" --out "$RUN/discovery.txt"
```

Une ligne par fichier : `catégorie<TAB>chemin`. Catégories qui **doivent** finir dans le graphe (ou dans `out_of_scope`) : `route` (pages, layouts, route handlers, fichiers de routes), `action` (fichiers `"use server"`), `api` (handlers Express, Fastify, Hono, Koa, NestJS, FastAPI, Flask, Django, Laravel), `router` (déclarations de routes d'une SPA), `modal` (Dialog, Modal, Sheet, Drawer, AlertDialog, Popover, DropdownMenu), `form` (`<form>`, `useForm(`, `<Form>`). Catégories d'information : `schema` (Prisma, Drizzle, TypeORM, Mongoose, Django, SQL), `middleware`.

Le script ignore `node_modules`, `.git`, `.next`, `dist`, `build`, `coverage`, `.qa-reviewer` et les fichiers de plus de 1 Mo.

Si `graphify-out/graph.json` existe et que la commande `graphify` est installée, `graphify query "routes, endpoints, formulaires et modales"` donne une vue d'ensemble plus rapide. C'est un complément : l'inventaire ci-dessus reste la référence de complétude.

## Stack

```bash
cd "$PROJECT" && find . -maxdepth 3 -name package.json -not -path '*/node_modules/*' -exec node -e '
for (const f of process.argv.slice(1)) { const p = require(require("path").resolve(f)); const d = { ...p.dependencies, ...p.devDependencies };
  const hit = Object.keys(d).filter(k => /^(next|nuxt|react|vue|svelte|@sveltejs\/kit|@remix-run\/.*|react-router|react-router-dom|@tanstack\/react-router|astro|express|fastify|hono|koa|@nestjs\/core|prisma|@prisma\/client|drizzle-orm|typeorm|sequelize|mongoose|zod|yup|valibot|joi|class-validator|react-hook-form|formik|next-auth|@auth\/.*|@clerk\/.*|@supabase\/.*|better-auth|lucia|stripe|tailwindcss|@radix-ui\/.*|@mui\/material|@chakra-ui\/react|i18next|next-intl)$/.test(k));
  console.log(f + ": " + hit.map(k => k + "@" + d[k]).join(" ")); }' {} +
ls pnpm-lock.yaml yarn.lock package-lock.json bun.lockb bun.lock turbo.json nx.json pnpm-workspace.yaml 2>/dev/null
```

Hors JavaScript : `pyproject.toml` / `requirements.txt` (Django, FastAPI, Flask), `composer.json` (Laravel), `Gemfile` (Rails), `go.mod`.

Plusieurs applications (`apps/*`, workspaces) : **demande laquelle tester** avant d'aller plus loin.

| Stack | Pages | API / actions | Modales |
|---|---|---|---|
| Next App Router | `app/**/page.*`, `@slot` = routes parallèles, `(.)x` = routes interceptées (des modales) | `route.ts`, fichiers `"use server"` | composants Dialog, routes interceptées |
| Next Pages Router | `pages/**` hors `_app`, `_document` | `pages/api/**` | composants |
| Remix / React Router 7 | `app/routes/**`, `app/routes.ts` | exports `loader` / `action` | composants |
| SvelteKit | `+page.svelte` | `+server.ts`, `actions` de `+page.server.ts` | composants |
| Nuxt | `pages/**` | `server/api/**` | composants |
| SPA (Vite) | configuration du routeur | backend séparé | composants |
| Django / Laravel / Rails | `urls.py` / `routes/web.php` / `config/routes.rb` | vues, contrôleurs | templates |

## Lancer l'application

1. Trouver la commande : scripts `dev` / `start`, `docker-compose.yml`, README. Une base est souvent nécessaire (`docker compose up -d db`, migrations, seed).
2. Lancer en arrière-plan, puis attendre que `curl -s -o /dev/null -w '%{http_code}' "$BASE_URL"` réponde.
3. Si l'utilisateur a déjà donné une URL locale ou de test, l'utiliser telle quelle.
4. Si l'app ne démarre pas après un effort raisonnable : le signaler à l'orchestrateur avec l'erreur exacte. Le run peut continuer en mode statique (`BASE_URL=none`) ; toutes les cases qui exigent un navigateur seront `blocked`.

## Comptes et sessions

Pour chaque rôle du graphe sauf `anon` : compte du seed, des fixtures ou de `.env.example`, sinon inscription locale (`qa-<rôle>@test.local`, et un second compte `qa-<rôle>-b@test.local` pour tester l'accès aux données d'autrui). Un rôle impossible à obtenir (admin sans seed) se note dans `accounts.md` ; ses cases seront `blocked`.

Pour chaque compte, sauvegarder l'état de session :

```bash
cd "$RUN"; SESSION=qa-cartographer
pw() { (cd "$RUN" && "$PWCLI" -s="$SESSION" "$@"); }
pw open --config="$RUN/profiles/desktop.json" "$BASE_URL/login"
# … remplir et valider le formulaire (find, fill, click) …
pw state-save auth-user.json
pw close
```

Noms : `auth-<rôle>.json` et `auth-<rôle>-b.json`.
