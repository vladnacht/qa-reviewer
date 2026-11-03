# Protocole commun des chefs de domaine (couche 2)

Tu diriges un domaine (fonctionnel, UI, UX, bugs ou responsive). Tu ne testes pas toi-même : tu découpes, tu délègues à tes spécialistes, tu contrôles leurs rapports et tu consolides. Ton fichier d'agent dit ce qui compte dans ton domaine ; ce protocole dit comment travailler.

## Entrées (dans ton prompt)

`QA_HOME`, `PROJECT`, `RUN`, `RUN_ID`, `BASE_URL`, `PWCLI`, `DEPTH`, `WAVE` (1 ou 2), `DOMAIN`, `PARALLEL` (spécialistes simultanés, 4 par défaut), `PREFIX` (`qa-reviewer:` quand l'agent est installé comme plugin, vide sinon), le résumé de la stack.

## 0. Reprise

Commence par `node "$QA_HOME/scripts/qa.mjs" status --run "$RUN" --wave "$WAVE"`. Si ton domaine a déjà des lots, tu reprends le travail d'un chef précédent : ne relance pas `batches`, qui écraserait ses notes. Lance seulement les spécialistes dont le rapport manque, puis continue au § 3.

## 1. Découper en lots

```bash
node "$QA_HOME/scripts/qa.mjs" batches --run "$RUN" --domain "$DOMAIN" --wave "$WAVE" --max-cells 60
```

Le script regroupe les cases de chaque spécialiste par nœud (un nœud n'est jamais coupé en deux) dans `$RUN/missions/batches/w<WAVE>/<agent>-b<n>.json` et affiche la liste. Lis le graphe (`$RUN/feature-graph.json`) et ouvre chaque lot : ajoute dans son champ `notes` ce que le spécialiste doit savoir pour ce lot précis (compte à utiliser, donnée de seed à manipuler, piège repéré dans le balayage, intégration à simuler). Un spécialiste sans case pour cette vague n'est pas lancé. **Ne touche qu'aux lots de tes spécialistes** : le dossier contient aussi ceux des autres chefs, qui travaillent en parallèle.

## 2. Lancer les spécialistes

Par vagues de `PARALLEL` appels `Agent` **dans un seul message**, avec `subagent_type` = `PREFIX` suivi du nom de l'agent (`qa-reviewer:qa-ui-states`, ou `qa-ui-states` si `PREFIX` est vide). Ils ne voient pas ta conversation : tout passe par le prompt, avec des chemins absolus.

```text
Tu es <agent>, spécialiste qa-reviewer, sur le projet <PROJECT>.
1. Lis et suis : <QA_HOME>/references/specialist-protocol.md, puis ton propre protocole (ton fichier d'agent).
2. Contexte :
   QA_HOME=<…>  PROJECT=<…>  RUN=<…>  RUN_ID=<…>  BASE_URL=<…|none>  PWCLI=<…>
   BATCH=<RUN>/missions/batches/w<WAVE>/<agent>-b<n>.json
   REPORT=<RUN>/reports/<agent>-w<WAVE>-b<n>.json
   SESSION=<agent>-w<WAVE>-b<n>
   Stack : <une ligne>
3. Lecture seule sur le projet ; n'écris que dans <RUN>. Uniquement sur BASE_URL.
4. Réponse finale en 5 lignes au plus.
```

Les spécialistes tournent **en arrière-plan** : ton tour peut se terminer avant leur fin, et l'orchestrateur le reçoit alors comme ta réponse. Pour qu'il ne te prenne pas pour fini :

- tant qu'un rapport manque, termine ton tour par une seule ligne `EN ATTENTE: <agents encore en cours>` ;
- à chaque réveil (notification de fin d'un spécialiste ou message de l'orchestrateur), fais le point avec les fichiers, pas avec ta mémoire :

```bash
node "$QA_HOME/scripts/qa.mjs" status --run "$RUN" --wave "$WAVE"
```

- tous les rapports de ton domaine présents (`to consolidate`) : passe au contrôle (§ 3). Un spécialiste terminé sans rapport : relance-le une fois.

Ne refais pas leur travail en attendant, et ne vérifie pas en boucle (`sleep`, `echo`) : attends d'être réveillé.

## 3. Contrôler chaque rapport

```bash
cd "$PROJECT" && node "$QA_HOME/scripts/qa.mjs" reports --project "$PROJECT" --batch <BATCH> <REPORT>
```

Rapport `✗` (cases manquantes, champs absents, JSON invalide) : relance **une fois** le même spécialiste avec le même prompt, plus la liste des erreurs et la consigne de compléter le rapport existant. Toujours `✗` ensuite : garde ce qui est valide et note le reste dans ta consolidation.

Puis relis toi-même :
- **chaque P0 et P1** : ouvre la capture, relis la preuve `code`. Si elle ne montre pas le problème, rejette-le (`rejected`, avec la raison) ;
- les `na` et `blocked` : une raison vague (« non pertinent ») = la case sera reprise en vague 2, signale-la.

## 4. Consolider — `$RUN/leads/<DOMAIN>.json` (vague 2 : `<DOMAIN>-w2.json`)

Format dans `references/report-contract.md` § 3 :
- **fusionne** les findings qui ont la même cause (même composant, même handler, même règle CSS) en une `issue` `<DOMAINE>-nnn` (`FN`, `UI`, `UX`, `BUG`, `RSP`) ;
- **repère le systémique** : un même défaut sur plusieurs nœuds (aucun état de chargement nulle part, tous les boutons primaires sans focus visible) devient une entrée `systemic` ;
- **recalibre** la sévérité avec l'échelle du contrat : chaque changement porte `severity_from` et `severity_reason` (règle dans le contrat § 3) ;
- **transmets** les `observations` des spécialistes dans `handoffs` ;
- **`coverage`** : recopie la ligne de ton domaine affichée par `node "$QA_HOME/scripts/qa.mjs" coverage --run "$RUN"`, ne compte jamais toi-même.

Écris et corrige ce fichier avec l'outil Write ou Edit, jamais avec `sed` : un JSON abîmé bloque le run (`status` l'affiche `lead file is not valid JSON`).

## Réponse finale (6 lignes au plus)

Première ligne : `TERMINÉ: <DOMAIN>`, uniquement une fois ta consolidation écrite. Puis : chemin de ta consolidation · cases remplies / total · issues par sévérité · rejetés · le problème le plus grave · ce qui reste bloqué.
