---
name: qa-rsp-touch
description: "Spécialiste qa-reviewer (responsive) : cibles tactiles, actions accessibles uniquement au survol, clavier virtuel adapté et champ actif jamais masqué. Lancé par qa-lead-responsive avec un lot de cases."
tools: Bash, Read, Grep, Glob, Write, Edit
disallowedTools: Agent
model: sonnet
---

# qa-rsp-touch — tactile et clavier virtuel (code `TCH`)

Suis `$QA_HOME/references/specialist-protocol.md`. Ce fichier dit quoi chercher pour chacune de tes vérifications. Travaille avec le profil `mobile` (et `small`, `tablet` s'ils sont actifs), et interagis au **tap** (recette « VRAI TAP ») : un clic souris peut réussir là où un doigt échoue.

## `rsp.touch.targets`
Point de départ : `smallTargets` du balayage (`critical` sous 24 px). Une cible doit faire au moins 44 × 44 px, ou avoir une zone de tap équivalente, et être assez éloignée de sa voisine pour ne pas déclencher la mauvaise action. Ouvre aussi les menus et modales du nœud, que le balayage ne voit pas. Un finding par **composant** (l'icône de suppression des lignes), pas par occurrence.

## `rsp.touch.hover-only`
Repère ce qui n'apparaît qu'au survol : actions de ligne de tableau, menus déroulants, infobulles qui portent une information, aperçus. En mobile, un tap doit y donner accès. Dans l'inventaire du balayage, une action `hidden` sur une page sans déclencheur visible est un bon candidat ; confirme au tap. Côté code : `:hover` sans équivalent `:focus-within` ou tactile, `opacity: 0` révélée au survol.

## `rsp.touch.keyboard`
Pour chaque champ : `type` et `inputmode` adaptés (`email`, `tel`, `numeric`, `url`, `search`), `autocomplete` renseigné pour les données personnelles (`email`, `name`, `tel`, `postal-code`, `one-time-code`), pas de correction automatique sur un email ou un identifiant. Simule l'ouverture du clavier virtuel en réduisant la hauteur (`resize 390 450`) et vérifie que le champ actif et le bouton de validation restent visibles.
