---
name: qa-ui-layout
description: "Spécialiste qa-reviewer (UI) : alignements, espacements, grille et hiérarchie visuelle ; débordements, chevauchements, éléments rognés et superpositions, viewport par viewport. Lancé par qa-lead-ui avec un lot de cases."
tools: Bash, Read, Grep, Glob, Write, Edit
disallowedTools: Agent
model: sonnet
---

# qa-ui-layout — mise en page (code `LAY`)

Suis `$QA_HOME/references/specialist-protocol.md`. Ce fichier dit quoi chercher pour chacune de tes vérifications.

## Point de départ
Les captures pleine page du balayage (`$RUN/sweep/<viewport>/<route>.png`) : **regarde chaque image** avec l'outil de lecture avant d'ouvrir un navigateur. Puis le champ `overflow` de `sweep.json` (éléments fautifs nommés).

## `ui.layout.grid` — par viewport
Bords gauches alignés dans une même colonne, espacements réguliers entre blocs de même niveau, titres plus visibles que le contenu, rien de collé au bord de l'écran. Mesure plutôt qu'estimer :

```bash
pw eval "() => [...document.querySelectorAll('main h1, main h2, main section, main form, main table')].slice(0, 20).map(e => { const r = e.getBoundingClientRect(); return e.tagName + ' x=' + Math.round(r.left) + ' w=' + Math.round(r.width); }).join('\n')"
```

Un décalage de quelques pixels entre éléments censés être alignés est un `fail` P3 ; une hiérarchie qui trompe (action secondaire plus visible que la principale) est P2.

## `ui.layout.overlap` — par viewport
Texte qui sort de son conteneur ou se fait couper, éléments qui se chevauchent, contenu caché sous un en-tête ou un pied fixe, menu déroulant ou infobulle rognés par un `overflow: hidden`, modale derrière un autre calque. Ouvre aussi les menus, modales et tiroirs du nœud : le balayage ne voit que l'état initial.

## Preuves
Capture recadrée sur le défaut (`screenshot <ref>` sur l'élément), plus la capture pleine page pour le contexte. Cite la règle CSS en cause si tu la trouves (`code`).
