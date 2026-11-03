# Graphe des nœuds de fonctionnalité — `$RUN/feature-graph.json`

Le graphe est la liste exhaustive de **tout ce qui peut être testé** dans l'application. La matrice de couverture en est tirée par un script : ce qui manque au graphe ne sera testé par personne. Le cartographe le construit, `qa.mjs graph-check` le valide.

## Format

```json
{
  "project": "boutique",
  "base_url": "http://localhost:3000",
  "generated_at": "2026-11-02T10:00:00Z",
  "stack": "Next.js 15 App Router · Prisma/Postgres · NextAuth · Zod · Stripe",
  "roles": ["anon", "user", "admin"],
  "nodes": [
    {
      "id": "checkout",
      "kind": "page",
      "title": "Paiement",
      "route": "/checkout",
      "url": "/checkout",
      "roles": ["user"],
      "critical": true,
      "states": ["default", "empty", "loading", "error", "success"],
      "actions": ["Payer", "Appliquer le code", "Retour au panier"],
      "destructive": [],
      "inputs": [
        { "name": "coupon", "type": "text", "required": false, "rules": "max 20, majuscules" }
      ],
      "api": ["api.orders.create"],
      "entities": ["Order", "Payment"],
      "integrations": ["payment"],
      "source": ["app/checkout/page.tsx:1", "app/checkout/actions.ts:12"]
    },
    {
      "id": "api.orders.create",
      "kind": "api",
      "title": "Créer une commande",
      "route": "POST /api/orders",
      "roles": ["user"],
      "critical": true,
      "entities": ["Order"],
      "source": ["app/api/orders/route.ts:8"]
    }
  ],
  "flows": [
    { "id": "F01", "title": "Achat", "critical": true, "roles": ["user"],
      "steps": ["cart", "checkout", "order-confirmation"] }
  ],
  "edges": [
    { "from": "cart", "to": "checkout", "via": "clic « Commander »" }
  ],
  "out_of_scope": [
    { "item": "app/admin/legacy/page.tsx", "reason": "route désactivée par le middleware (middleware.ts:14)" }
  ]
}
```

## Champs d'un nœud

| Champ | Obligatoire | Valeurs |
|---|---|---|
| `id` | oui | unique, `[a-z0-9][a-z0-9._-]*` |
| `kind` | oui | `page` · `modal` (dialog, drawer, sheet, menu) · `form` (formulaire dans une page ou une modale) · `layout` (en-tête, navigation, pied de page, barre latérale partagés : leurs `actions` valent pour toutes les pages) · `api` (endpoint, server action, webhook) · `job` (tâche de fond, email, cron) |
| `title` | oui | nom lisible |
| `route` | oui | motif de route (`/orders/[id]`) ou `MÉTHODE /chemin` pour une API |
| `url` | page, modal, layout | URL concrète avec un id réel du seed (`/orders/ord_1`) ; pour une modale ou un layout, une page où on le voit |
| `parent` | form, modal | id du nœud qui la contient |
| `roles` | oui | sous-ensemble de `roles` du graphe ; `anon` = accessible sans session. C'est l'accès **voulu**, pas celui que l'app laisse passer : sinon une garde oubliée devient la norme et le test d'accès passe |
| `critical` | non | `true` pour l'authentification, l'inscription, le paiement, la création de la donnée principale, et tout ce dont un flow critique dépend |
| `states` | page, modal, form | parmi `default` `empty` `loading` `error` `success` `disabled` `partial` (pagination, résultats tronqués) — **tous ceux que le nœud peut afficher**, pas seulement ceux qui sont bien gérés |
| `actions` | page, modal, form | libellés visibles de chaque bouton, lien d'action, onglet, menu, toggle — y compris ceux cachés derrière un survol ou un menu |
| `destructive` | non | sous-ensemble de `actions` qui suppriment, annulent ou envoient de façon irréversible |
| `inputs` | form, et toute page qui a des champs hors formulaire | chaque champ : `name`, `label` (libellé visible, placeholder ou aria-label, tel que le balayage le lit), `type`, `required`, `rules` (contraintes connues côté client, serveur et DB) |
| `api` | non | ids des nœuds `api` appelés |
| `entities` | non | entités de données lues ou écrites |
| `integrations` | non | `email` `payment` `upload` `oauth` `maps` `analytics` `realtime` `other` |
| `notes` | non | ce que les spécialistes doivent savoir sur ce nœud (écart entre l'accès voulu et l'accès constaté, donnée de seed utile) ; recopié dans leurs lots |
| `source` | oui sauf `job` sans code | `fichier:ligne`, relatif à `$PROJECT` |

Un **flow** est un parcours utilisateur de bout en bout : `steps` liste les nœuds dans l'ordre. Chaque nœud `critical` doit appartenir à au moins un flow.

## Les règles d'exhaustivité (vérifiées par `qa.mjs graph-check`)

1. Chaque fichier de `discovery.txt` est cité dans un `source` ou dans `out_of_scope` avec une raison.
2. Chaque route visitée par le balayage correspond à un nœud (par `url` ou par motif de `route`).
3. Chaque lien de même origine trouvé par le balayage et absent de `routes.json` est soit ajouté, soit mis en `out_of_scope`.
4. Chaque action visible ou cachée inventoriée par le balayage sur une page figure dans `actions` du nœud de cette page, d'un de ses enfants ou d'un nœud `layout`. Les libellés se comparent sans tenir compte de la casse ni des espaces : reprends ceux du balayage.
5. Chaque `parent`, `api`, `steps` et extrémité d'`edges` pointe vers un nœud qui existe ; chaque rôle cité est déclaré ; `destructive` est inclus dans `actions`.
6. Chaque nœud est relié : arête, étape d'un flow, `parent`, ou cité dans `api` d'un autre nœud (pas d'îlot oublié). Chaque nœud `critical` appartient à un flow.

Tant que `graph-check` signale un écart, le graphe n'est pas terminé.
