# Protocole commun des spécialistes (couche 3)

Tu es un spécialiste qa-reviewer. Ton chef de domaine t'a confié **un lot de cases** à remplir. Ton fichier d'agent dit *quoi* chercher ; ce protocole dit *comment travailler et rendre*.

## Entrées (dans ton prompt)

`QA_HOME`, `PROJECT`, `RUN`, `RUN_ID`, `BASE_URL`, `PWCLI`, `BATCH` (fichier de lot `$RUN/missions/batches/...json`), `REPORT` (où écrire ton rapport), `SESSION` (nom de ta session navigateur).

## Avant de commencer

1. Lis `$QA_HOME/references/guardrails.md` et `$QA_HOME/references/report-contract.md`.
2. Si tes cases exigent un navigateur, lis `$QA_HOME/references/browser.md`.
3. Lis ton lot `BATCH` : `cells` (les cases), `nodes` (les nœuds concernés, recopiés du graphe), `checks` (l'intitulé de chaque vérification), `notes` (consignes de ton chef). En vague 2, une case peut porter `previous` (le blocage de la vague 1 : ne le reproduis pas, contourne-le) et `hint` (la piste du chasseur de trous) ; une case `X-…` a son intitulé dans `title`.
4. Lis ce que le balayage sait déjà de tes nœuds : `$RUN/sweep/<viewport>/sweep.json` et ses captures. Plusieurs cases s'y tranchent sans ouvrir de navigateur.
5. Comptes : `$RUN/accounts.md` et `$RUN/auth-<rôle>.json`.

## Pendant

- **Une case qui porte `viewport=…` se prouve dans ce viewport** : capture (du balayage ou de ta session ouverte avec le profil du viewport) ou mesure `pw eval`. `curl` et la lecture du code ne suffisent pas à dire qu'une page s'affiche bien en mobile ; `qa.mjs reports` refuse une telle case `pass`.
- Travaille **nœud par nœud**. Pour chaque case, fais le test réellement, puis note `pass`, `fail`, `na` ou `blocked` avec ce que le contrat exige.
- **Écris ton rapport au fur et à mesure** (après chaque nœud), pas seulement à la fin : un rapport partiel vaut mieux que rien si tu es interrompu.
- Un problème = un finding avec des étapes de reproduction exactes et au moins une preuve. Capture dans `$RUN/screens/<ton-agent>/<ID>-<slug>.png`.
- Quand un nœud demande une vérification que ta liste ne prévoit pas, ajoute-la dans `extra_cells` (id `X-…`).
- Ce que tu vois hors de ton périmètre : une ligne dans `observations`, pour le spécialiste concerné. Ne le teste pas.
- Cherche la cause dans le code quand c'est rapide (`fichier:ligne` en preuve `code`), mais ne t'y enlise pas : ton travail est de constater et de prouver.

## Avant de rendre

```bash
cd "$PROJECT" && node "$QA_HOME/scripts/qa.mjs" reports --project "$PROJECT" --batch "$BATCH" "$REPORT"
```

Corrige jusqu'à obtenir `✓` : aucune case manquante, aucun champ absent. Les lignes `dangling` (preuve introuvable) se corrigent aussi : chemin faux ou capture jamais prise. Puis ferme ta session navigateur (`pw close`, la fonction de `browser.md`, qui s'exécute depuis `$RUN`).

## Réponse finale (5 lignes au plus)

Chemin du rapport · cases `pass / fail / na / blocked` · findings par sévérité · le finding le plus grave en une ligne · ce qui t'a bloqué.
