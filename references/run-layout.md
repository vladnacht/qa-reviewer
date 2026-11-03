# Dossier d'un run et variables partagées

Tous les agents utilisent les mêmes noms. Les variables shell ne survivent pas d'un appel Bash à l'autre : réécris-les en tête de chaque commande, et passe toujours des **chemins absolus** aux sous-agents.

| Nom | Valeur |
|---|---|
| `QA_HOME` | racine du dépôt qa-reviewer (contient `scripts/qa.mjs`) |
| `PROJECT` | racine du projet testé (chemin absolu) |
| `RUN_ID` | `AAAAMMJJ-HHMM` |
| `RUN` | `$PROJECT/.qa-reviewer/runs/$RUN_ID` |
| `BASE_URL` | URL locale de l'app lancée, ou `none` |
| `DEPTH` | `quick` · `standard` · `exhaustive` |
| `PWCLI` | chemin de `playwright-cli`, donné par `node $QA_HOME/scripts/doctor.mjs` |

## Arborescence

```
$RUN/
├── run.json                 écrit par `qa.mjs init` : projet, date, ce qui existait avant le run
├── started.json             ce que le cartographe a lancé (pid ou commande d'arrêt), arrêté par `qa.mjs teardown`
├── app.log, api.log…        sortie des services lancés
├── discovery.txt            fichiers remontés par la découverte (une ligne = un fichier)
├── feature-graph.json       graphe des nœuds de fonctionnalité (references/feature-graph.md)
├── graph-check.txt          sortie de `qa.mjs graph-check` (doit finir par « graph OK »)
├── routes.json              URLs concrètes pour le balayage
├── accounts.md              comptes de test (sans mot de passe réel)
├── auth-<role>.json         états de session Playwright, un par rôle
├── sweep/<viewport>/        balayage automatique : sweep.json + captures pleine page
├── sweep/diff.json          parité desktop → mobile
├── matrix/cells.json        toutes les cases à remplir (générées, jamais écrites à la main)
├── matrix/coverage.json     état de chaque case après fusion des rapports
├── matrix/gaps.json         cases vides ou bloquées, par spécialiste
├── missions/<spécialiste>.json          cases d'une vague 1
├── missions/wave2/<spécialiste>.json    cases de la vague 2
├── reports/<spécialiste>-<lot>.json     rapport d'un spécialiste (references/report-contract.md)
├── leads/<domaine>.json                 consolidation d'un chef de domaine
├── screens/<spécialiste>/               captures de preuve
├── scratch/                             scripts de preuve jetables
├── consolidated.json        sortie du contrôleur
└── report.md                rapport final lisible
```

Le dossier `.qa-reviewer/` est ajouté à `.git/info/exclude` par `qa.mjs init` : rien n'est commité dans le projet testé.

## Chemins dans les preuves

Toujours **relatifs à `$PROJECT`** (`.qa-reviewer/runs/<id>/screens/qa-ui-layout/LAY-003.png`, `src/app/page.tsx:42`). `qa.mjs reports` les résout depuis là et signale ceux qui n'existent pas.
