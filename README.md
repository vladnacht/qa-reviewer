# qa-reviewer

Un agent de quality assurance pour Claude Code. Il fait la recette complète d'une application web (UI, UX, fonctionnalités, bugs, responsive) et prouve qu'il n'a rien oublié : chaque vérification est une case, et chaque case revient avec un statut et une preuve.

## Comment il travaille

```
qa-reviewer                          orchestrateur (couche 1)
├── qa-cartographer                  graphe des nœuds de fonctionnalité + balayage
├── qa-lead-functional ─ qa-fn-flows · qa-fn-rules · qa-fn-permissions · qa-fn-data
├── qa-lead-ui ───────── qa-ui-layout · qa-ui-design · qa-ui-states · qa-ui-content
├── qa-lead-ux ───────── qa-ux-journey · qa-ux-feedback · qa-ux-copy · qa-ux-a11y
├── qa-lead-bugs ─────── qa-bug-inputs · qa-bug-network · qa-bug-concurrency · qa-bug-navigation
├── qa-lead-responsive ─ qa-rsp-breakpoints · qa-rsp-touch · qa-rsp-parity · qa-rsp-zoom
├── qa-gap-hunter                    trous de couverture → vague 2
└── qa-controller                    vérifie chaque preuve, rapport final
```

1. **Cartographie.** Le cartographe inventorie le code (`qa.mjs discover`), lance l'app, crée les comptes de test, balaye chaque viewport et construit `feature-graph.json` : chaque page, modale, formulaire, layout, endpoint, avec ses états, ses actions, ses champs, ses rôles, et les parcours qui les relient. `qa.mjs graph-check` refuse le graphe tant qu'un fichier, une route, un lien ou une action vus dans le code ou à l'écran n'y figurent pas.
2. **Matrice.** `qa.mjs matrix` croise le graphe avec les 57 vérifications de `references/checks.json` (par état, champ, action, rôle, viewport). Ce sont les scripts, pas le modèle, qui décident de ce qui doit être testé.
3. **Vague 1.** Chaque chef de domaine découpe ses cases en lots (`qa.mjs batches`), lance ses quatre spécialistes en parallèle, valide leurs rapports (`qa.mjs reports` : aucune case ne peut manquer) et consolide.
4. **Vague 2.** `qa.mjs coverage` liste les cases vides ou bloquées. Le chasseur de trous écarte les blocages définitifs, ajoute ce que la matrice ne voit pas (états oubliés, variantes, signalements entre domaines) et relance les domaines concernés.
5. **Contrôle.** Le contrôleur rejoue chaque P0 et P1, rejette ce qui n'est pas prouvé, fusionne les problèmes par cause entre domaines et écrit `report.md`.

qa-reviewer constate et prouve. Il ne modifie jamais le code du projet testé.

## Installation

Prérequis : Claude Code, Node.js 18 ou plus récent. Google Chrome ou Edge est utilisé s'il est installé ; sinon Chromium est téléchargé au premier run.

Dans Claude Code :

```
/plugin install qa-reviewer --marketplace vladnacht/qa-reviewer
```

ou depuis un terminal :

```bash
claude plugin marketplace add vladnacht/qa-reviewer
```

```bash
claude plugin install qa-reviewer@qa-reviewer
```

Relance Claude Code. Au premier run, l'agent installe lui-même ses dépendances (`@playwright/cli`, `axe-core` : quelques secondes) et, si aucun navigateur n'est disponible, Chromium (environ une minute).

## Utilisation

Dans le projet à tester :

```bash
claude --agent qa-reviewer:qa-reviewer
```

ou dans une session ordinaire : « Lance l'agent qa-reviewer sur ce projet, en profondeur quick ».

Paramètres à donner dans la demande :

| Paramètre | Défaut | Effet |
|---|---|---|
| profondeur | `standard` | `quick` : tout le jeu sur les parcours critiques, un socle de 8 vérifications sur les autres pages, desktop et mobile, sans vague 2 · `standard` : tout, desktop, tablette, mobile · `exhaustive` : six viewports de 320 à 1920 px et vérifications supplémentaires |
| URL | lancée par le cartographe | uniquement localhost ou un environnement de test que tu nommes |
| périmètre | toute l'app | des routes ou des parcours précis |

## Développer

```bash
git clone https://github.com/vladnacht/qa-reviewer.git && cd qa-reviewer
```

```bash
npm install && npm run doctor && npm run selftest
```

Pour charger ta copie de travail dans une session sans installer le plugin :

```bash
claude --plugin-dir ~/chemin/vers/qa-reviewer
```

`npm run selftest` lance la mini-app de `tests/` (défauts plantés) et vérifie que les scripts les détectent toujours.

## Ce qu'il produit

Dans `<projet>/.qa-reviewer/runs/<date>/` (exclu de git automatiquement) :

| Fichier | Contenu |
|---|---|
| `report.md` | le rapport : couverture par domaine, problèmes P0 → P3 avec reproduction, preuves et re-test, problèmes systémiques, ce qui n'a pas été couvert et pourquoi |
| `consolidated.json` | les mêmes problèmes, lisibles par un autre outil (format dans `references/report-contract.md`) |
| `feature-graph.json` | la carte de l'application |
| `matrix/coverage.json` | l'état de chaque case |
| `screens/`, `sweep/` | captures et balayages |

## Coût

Sur une vraie application, compter plusieurs dizaines de sous-agents. `matrix` affiche le nombre de cases avant le lancement des chefs de domaine ; l'orchestrateur demande confirmation au-delà d'environ 40 sous-agents. Pour un premier essai, `quick` sur un périmètre restreint.

## Organisation du dépôt

```
.claude-plugin/  plugin.json et marketplace.json (le dépôt est sa propre marketplace)
agents/          29 définitions d'agents (orchestrateur, cartographe, 5 chefs, 20 spécialistes, chasseur, contrôleur)
references/      checks.json (le catalogue), contrats, protocoles communs, recettes navigateur, garde-fous
scripts/         qa.mjs (inventaire, graphe, matrice, lots, rapports, couverture, suivi des vagues, arrêt de ce que le run a lancé), sweep.mjs, doctor.mjs
tests/           mini-app aux défauts plantés, graphe de test, auto-test
```

Ajouter une vérification : une entrée dans `references/checks.json` (spécialiste, types de nœuds, dimensions, profondeur), puis une section du même id dans le fichier du spécialiste. `npm run selftest` vérifie que les scripts détectent toujours les défauts plantés.
