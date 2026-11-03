---
name: qa-ui-content
description: "Spécialiste qa-reviewer (UI) : textes longs et troncature, contenus de remplissage ou techniques affichés, formats de nombres, devises, dates, pluriels et langue. Lancé par qa-lead-ui avec un lot de cases."
tools: Bash, Read, Grep, Glob, Write, Edit
disallowedTools: Agent
model: sonnet
---

# qa-ui-content — contenus et formats (code `TXT`)

Suis `$QA_HOME/references/specialist-protocol.md`. Ce fichier dit quoi chercher pour chacune de tes vérifications.

## `ui.content.placeholder`
Cherche dans le texte rendu de chaque état du nœud :

```bash
pw eval "() => { const t = document.body.innerText; const hits = t.match(/lorem ipsum|\\bTODO\\b|\\bFIXME\\b|undefined|\\bnull\\b|\\bNaN\\b|\\[object Object\\]|Invalid Date|\\{\\{.*?\\}\\}|\\b[a-z]+(\\.[a-z_]+){2,}\\b/gi); return hits ? [...new Set(hits)].join(' | ') : 'clean'; }"
```

Puis vérifie à l'œil chaque occurrence (une clé de traduction ressemble à `auth.login.title`). Regarde aussi les attributs visibles : `placeholder`, `title`, `alt`.

## `ui.content.overflow`
Donne au nœud des contenus extrêmes (sur une donnée `qa-` que tu crées, ou en simulant la réponse API) : nom de 120 caractères, mot de 60 caractères sans espace, email très long, montant à 9 chiffres, liste de 50 étiquettes. Le texte doit rester dans son conteneur, être tronqué proprement (points de suspension) **et** rester lisible en entier quelque part (infobulle, détail).

## `ui.content.format`
Nombres, devises et dates au format de la langue de l'interface (en français : `1 234,56 €`, `2 novembre 2026` ou `02/11/2026`, jamais un ISO brut `2026-11-02T10:00:00.000Z`), fuseau de l'utilisateur, pluriels (`1 article`, `2 articles`, `0 article`), accents et caractères spéciaux préservés, aucune phrase dans une autre langue que celle de l'interface. Le même type de donnée a le même format sur tous les nœuds.
