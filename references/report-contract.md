# Contrat des rapports

Trois niveaux de sortie : le **rapport d'un spécialiste** (couche 3), la **consolidation d'un chef de domaine** (couche 2), la **sortie du contrôleur** (couche 1). Les chemins de preuve sont **relatifs à `$PROJECT`**.

## 1. Rapport d'un spécialiste — `$RUN/reports/<agent>-<lot>.json`

```json
{
  "agent": "qa-ui-states",
  "batch": "b1",
  "run_id": "20261102-1000",
  "generated_at": "2026-11-02T10:42:00Z",
  "cells": [
    { "id": "checkout::ui.state.render::state=empty", "status": "fail", "finding": "STA-001" },
    { "id": "checkout::ui.state.render::state=loading", "status": "pass",
      "evidence": ".qa-reviewer/runs/20261102-1000/screens/qa-ui-states/checkout-loading.png" },
    { "id": "checkout::ui.state.render::state=partial", "status": "na",
      "reason": "la page n'a pas de pagination (app/checkout/page.tsx lu en entier)" },
    { "id": "checkout::ui.state.render::state=error", "status": "blocked",
      "reason": "impossible de provoquer l'erreur : la requête part du serveur (RSC), pas du navigateur" }
  ],
  "extra_cells": [
    { "id": "X-checkout-coupon-expired", "node": "checkout", "title": "Code promo expiré : message dédié",
      "status": "fail", "finding": "STA-002" }
  ],
  "findings": [
    {
      "id": "STA-001",
      "title": "Panier vide : la page de paiement affiche un total « NaN € » et un bouton Payer actif",
      "severity": "P1",
      "confidence": "high",
      "category": "state",
      "nodes": ["checkout"],
      "cells": ["checkout::ui.state.render::state=empty"],
      "viewports": ["desktop", "mobile"],
      "evidence": [
        { "kind": "screenshot", "ref": ".qa-reviewer/runs/20261102-1000/screens/qa-ui-states/STA-001-empty.png" },
        { "kind": "code", "ref": "app/checkout/page.tsx:31-33", "excerpt": "const total = items.reduce((s, i) => s + i.price) / items.length" }
      ],
      "repro": ["Se connecter en qa-a", "Vider le panier", "Ouvrir /checkout"],
      "expected": "Message « Votre panier est vide » et lien vers le catalogue ; bouton Payer absent",
      "actual": "Total « NaN € », bouton Payer cliquable qui renvoie une erreur 500",
      "suspected_cause": "reduce sans valeur initiale sur une liste vide",
      "suggestion": "Afficher un état vide dédié avant le calcul du total"
    }
  ],
  "observations": [
    { "for": "qa-bug-network", "note": "POST /api/orders répond 500 au lieu de 400 quand le panier est vide" }
  ]
}
```

### Les cases (`cells`)

Ta mission te donne une liste de cases. **Chacune doit revenir avec un statut**, sans exception :

| Statut | Signifie | Champ obligatoire |
|---|---|---|
| `pass` | vérifié, conforme | `evidence` : capture, commande ou `fichier:ligne` qui le montre |
| `fail` | vérifié, non conforme | `finding` : id d'un finding de ce rapport |
| `na` | la case ne s'applique pas à ce nœud | `reason` : pourquoi, avec ce que tu as lu pour le savoir |
| `blocked` | impossible à vérifier | `reason` : ce qui bloque et ce qu'il faudrait pour débloquer |

`na` et `blocked` ne sont pas des échappatoires : une raison vague (« pas le temps », « non pertinent ») sera renvoyée à la vague 2.

`extra_cells` : les vérifications que tu as ajoutées toi-même parce que le nœud le demandait (id commençant par `X-`). Elles comptent dans la couverture.

### Les findings

| Champ | Valeurs |
|---|---|
| `id` | `<CODE>-nnn`, où `CODE` est celui du spécialiste dans `checks.json` (`STA-001`) |
| `severity` | `P0` · `P1` · `P2` · `P3` (échelle ci-dessous) |
| `confidence` | `high` = reproduit et prouvé · `medium` = observé une fois ou lu dans le code sans repro · `low` = soupçon à confirmer |
| `category` | `flow` `action` `rule` `validation` `permission` `data` `layout` `design` `state` `content` `journey` `feedback` `copy` `a11y` `input` `network` `console` `concurrency` `navigation` `session` `responsive` `touch` `parity` `zoom` `perf` `security` `other` |
| `nodes`, `cells` | ids du graphe et des cases concernées |
| `viewports` | parmi `small` `mobile` `tablet` `laptop` `desktop` `wide`, ou `[]` si sans objet |
| `evidence[].kind` | `screenshot` · `snapshot` (`ref` = fichier) · `code` (`ref` = `chemin:ligne` ou `chemin:début-fin`) · `console` · `network` (`ref` = route, `excerpt` = message) · `command` (`ref` = commande exacte, `excerpt` = sortie) |
| `repro` | étapes exactes, rejouables par quelqu'un d'autre |
| `expected` / `actual` | ce qui devrait se passer / ce qui se passe |
| `suspected_cause`, `suggestion` | facultatifs |

Règles :
- **Au moins une preuve par finding.** Une preuve `screenshot` doit montrer le problème, pas seulement la page.
- `excerpt` : copie exacte, 3 lignes au plus. Jamais de secret réel.
- Un même problème vu sur plusieurs cases ou viewports = **un** finding qui liste toutes ses cases.
- Ce que tu remarques hors de ton périmètre va dans `observations`, avec le spécialiste concerné dans `for` : un nom exact de `references/checks.json` (`qa-rsp-touch`, pas « l'équipe responsive »), sinon `qa.mjs reports` refuse le rapport. Ne le teste pas toi-même.
- **Écart voulu et documenté** (README, commentaire, ticket qui dit « c'est une démo ») : c'est quand même un finding s'il gêne l'utilisateur ou expose des données. Garde la sévérité de l'impact réel, et cite la documentation en preuve `code` pour que l'équipe tranche.

## 2. Échelle de sévérité

| Prio | Signification | Exemples |
|---|---|---|
| **P0** | Bloquant | flow critique impossible sur un viewport, perte ou corruption de données, accès aux données d'un autre utilisateur, écran blanc sur une page critique |
| **P1** | Majeur | fonctionnalité cassée hors flow critique, erreur qui casse la page, doublon créé par un double clic, action desktop inaccessible en mobile, validation incohérente qui finit en 500, formulaire impossible au clavier |
| **P2** | Mineur | état vide ou chargement absent, message d'erreur peu clair, cible tactile trop petite, contraste insuffisant, débordement sans perte d'action |
| **P3** | Cosmétique | alignement, espacement, incohérence visuelle légère, faute de frappe |

## 3. Consolidation d'un chef de domaine — `$RUN/leads/<domaine>.json`

```json
{
  "domain": "ui",
  "lead": "qa-lead-ui",
  "wave": 1,
  "reports": [".qa-reviewer/runs/20261102-1000/reports/qa-ui-states-b1.json"],
  "issues": [
    { "id": "UI-001", "title": "États vides non conçus sur les pages de liste", "severity": "P2",
      "nodes": ["orders", "invoices"], "merged_from": ["STA-001", "STA-004", "TXT-002"],
      "summary": "Même cause sur trois pages : aucun composant d'état vide.",
      "severity_from": "P3", "severity_reason": "STA-004 : la liste vide masque aussi le bouton « Ajouter », donc l'action principale" }
  ],
  "systemic": [
    { "title": "Aucun état de chargement dans l'application", "merged_from": ["STA-003", "STA-005"] }
  ],
  "handoffs": [
    { "to": "qa-bug-network", "note": "POST /api/orders répond 500 au lieu de 400 quand le panier est vide" }
  ],
  "rejected": [{ "finding": "LAY-004", "reason": "la capture ne montre pas de chevauchement" }],
  "coverage": "ui  412 cases · pass 301 · fail 61 · na 18 · blocked 32 · empty 0"
}
```

`coverage` recopie la ligne du domaine affichée par `qa.mjs coverage`, jamais un comptage fait à la main.

`severity_from` et `severity_reason` sont obligatoires dès que la sévérité d'une issue diffère de celle de ses findings. Relever une sévérité ne demande pas de nouvelle preuve si les preuves existantes montrent l'impact ; sinon, fais rejouer ou garde la sévérité d'origine.

Vocabulaire de la couverture : une case **remplie** a un statut (`pass`, `fail`, `na` ou `blocked`) ; une case **couverte** est remplie sans être `blocked`. Le rapport donne les deux.

## 4. Sortie du contrôleur — `$RUN/consolidated.json`

```json
{
  "run_id": "20261102-1000",
  "issues": [
    {
      "id": "QA-001",
      "severity": "P0",
      "status": "confirmed",
      "title": "…",
      "domains": ["functional", "bugs"],
      "nodes": ["checkout"],
      "viewports": ["desktop", "mobile"],
      "merged_from": ["UI-001", "NET-002"],
      "evidence": [{ "kind": "screenshot", "ref": "…" }],
      "repro": ["…"],
      "expected": "…",
      "actual": "…",
      "cause": "app/checkout/page.tsx:31 — reduce sans valeur initiale",
      "verification": "Rejoué en qa-a sur /checkout panier vide : NaN affiché",
      "retest": "étapes ou commande qui échouent aujourd'hui et passeront une fois corrigé"
    }
  ],
  "rejected": [{ "finding": "LAY-004", "reason": "…" }],
  "coverage": { "cells": 412, "pass": 301, "fail": 61, "na": 18, "blocked": 32, "empty": 0 }
}
```

`status` : `confirmed` (le contrôleur l'a vu lui-même) ou `plausible` (cohérent, non reproduit, gardé seulement s'il est argumenté).
