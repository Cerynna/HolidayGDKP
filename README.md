# Holidays GDKP — Bot Discord de vérification de raid

Bot Discord serverless (Firebase Cloud Functions) qui vérifie automatiquement les
candidats à un raid GDKP : il croise les **performances Warcraft Logs** et le
**budget en or déclaré**, puis attribue les rôles Discord, la couleur du pseudo et
un **statut d'accès au raid**.

Configuré pour **Siege of Orgrimmar — MoP Classic** (zone WCL `1054`).

## Architecture

Le bot n'a **pas de gateway persistante** : Discord appelle un endpoint HTTP à
chaque interaction. Comme Discord impose une réponse en moins de 3 s alors qu'un
appel Warcraft Logs peut être bien plus long, tout traitement lourd est déporté sur
un **worker asynchrone** déclenché par Firestore.

```
Discord ──POST──> [interactions]  (Cloud Function HTTP, europe-west1)
                        │  vérif signature Ed25519 (tweetnacl)
                        │  réponse immédiate : éphémère, modal, ou DEFERRED
                        └──> Firestore: pendingInteractions/{id}
                                     │  (onDocumentCreated)
                                     ▼
                                [worker]  (Cloud Function Firestore)
                                     │  Warcraft Logs + API REST Discord
                                     │  rôles, pseudo, tableau du roster
                                     └──> PATCH webhook: édite la réponse différée
                                          puis supprime le job
```

Le token d'interaction reste valide 15 min, ce qui laisse au worker tout le temps
nécessaire pour répondre. Aucun appel à `discord.js` : uniquement l'API REST v10.

## Fonctionnalités

### Panneau interactif (usage courant)

`/setup` prépare le serveur de bout en bout : il crée les **14 rôles** manquants
(grades de parse avec leur couleur, grades financiers, `Valid`, `Caddie`), puis la
catégorie `GDKP` avec deux salons en lecture seule, et y publie tout :

- **`✅・vérification`** — panneau règlement + deux boutons :
  - **📝 Postuler** → menu de rôle (Tank / Heal / DPS / Auto) → modal (nom du perso, or).
  - **🔄 Réévaluer** → modal de mise à jour de l'or, relance l'analyse sur le perso déjà lié.
- **`🏆・roster`** — tableau du roster, paginé en embeds, **mis à jour automatiquement**
  à chaque `/grade`, `/refresh`, `/link` ou `/unlink`. Trié par parse décroissant puis or.

### Commandes slash

| Commande | Accès | Effet |
|---|---|---|
| `/link perso [role] [or]` | tous | Lie un perso (équivalent textuel du bouton Postuler) |
| `/unlink` | tous | Supprime le lien et **libère le perso** |
| `/whoami` | tous | Fiche du perso lié : parse, budget, statut, lien vers les logs |
| `/grade [membre]` | soi-même · admin pour autrui | Recalcule un membre |
| `/refresh` | Gérer les rôles | Recalcule **tout** le roster |
| `/panneau` | Gérer les rôles | Rafraîchit le panneau à sa place enregistrée |
| `/tableau` | Gérer les rôles | (Re)poste le tableau du roster ici |
| `/royaume nom` | Gérer le serveur | Change le royaume global appliqué à tous les persos |
| `/setup` | Gérer le serveur | Crée rôles + salons, publie panneau et tableau (idempotent) |

## Règles de classement

Trois dimensions **indépendantes**, chacune appliquée comme rôle exclusif (le bot
retire les autres rôles de la même dimension).

### 1. Grade de parse — couleur du pseudo

Score = `averageParse` sur la meilleure difficulté éligible (HM prioritaire, exige
6 boss classés ; repli sur NM sinon).

| Parse | Rôle | Couleur |
|-------|------|---------|
| 100   | `Parfait`    | 🟨 or (#E5CC80) |
| 99    | `Prodige`    | 🩷 rose (#E268A8) |
| 95–98 | `Légendaire` | 🟧 orange (#FF8000) |
| 75–94 | `Épique`     | 🟪 violet (#A335EE) |
| 50–74 | `Rare`       | 🟦 bleu (#0070FF) |
| 25–49 | `Inhabituel` | 🟩 vert (#1EFF00) |
| 0–24  | `Commun`     | ⬜ gris (#666666) |

### 2. Grade financier — or déclaré

| Or (PO) | Rôle | |
|---|---|---|
| ≥ 200 000 | `Diamant` | 💎 |
| ≥ 150 000 | `Argent`  | 🥈 |
| ≥ 100 000 | `Bronze`  | 🥉 |
| ≥ 50 000  | `Fer`     | ⚙️ |
| ≥ 0       | `Bois`    | 🪵 |

L'or est saisi librement (`150k`, `150 000`, `1.5m`) et normalisé par `parseGold`.

### 3. Statut d'accès au raid

| Statut | Rôle | Condition |
|---|---|---|
| ✅ Validé | `Valid` | parse ≥ 50 |
| 🛒 Caddie | `Caddie` | parse < 50 **mais** or ≥ 100 000 PO |
| ⛔ Refusé | *(aucun)* | parse < 50 **et** or < 100 000 PO |

### Pseudo

Le bot renomme le membre en `[<parse> - <emoji finance>] <nom de base>`
(ex. `[71 - 💎] Mystérias`), tronqué à 32 caractères. Le préfixe existant est
retiré avant réécriture, donc l'opération est idempotente.

## Configuration

Tout est **embarqué dans le code** (`functions/src/config.ts`) : pas de lecture de
fichier en serverless. Y sont définis `defaultRealm`, `zoneID`, `metric`,
`difficulties`, `grades`, `financeGrades`, `caddie` et `raidAccess`. Toute
modification passe donc par un redéploiement.

Seul le **royaume** est modifiable à chaud, via `/royaume` (stocké dans Firestore).

### Secrets

Les Cloud Functions lisent leurs secrets via **Secret Manager**
(`defineSecret`, `functions/src/index.ts:15`) :

```bash
firebase functions:secrets:set DISCORD_PUBLIC_KEY   # Developer Portal > General Information
firebase functions:secrets:set DISCORD_TOKEN        # Developer Portal > Bot
firebase functions:secrets:set WCL_CLIENT_ID
firebase functions:secrets:set WCL_CLIENT_SECRET    # warcraftlogs.com/api/clients/
```

Le fichier `.env` à la racine ne sert qu'au script local d'enregistrement des
commandes slash — voir `.env.example`.

## Déploiement

```bash
npm install -g firebase-tools && firebase login

# 1. Déployer les fonctions
cd functions && npm install
firebase deploy --only functions

# 2. Enregistrer les commandes slash — globalement, sur tous les serveurs (nécessite .env)
npm install && npm run register
#    --guild        : cible DISCORD_GUILD_ID (instantané, pour itérer en dev)
#    --clear-guild  : vide les commandes de cette guilde (évite les doublons
#                     avec les commandes globales)

# 3. Coller l'URL de l'endpoint dans le Developer Portal
#    General Information > Interactions Endpoint URL
#    https://europe-west1-<projet>.cloudfunctions.net/interactions
```

Discord valide l'URL en envoyant un PING signé : la fonction doit être déployée
**avant** de coller l'URL.

```bash
firebase functions:log          # logs
cd functions && npm run typecheck
```

### Permissions Discord

Invitation avec les scopes `bot applications.commands` et les permissions
**Gérer les rôles**, **Gérer les salons**, **Gérer les pseudos**.

⚠️ Le rôle du bot doit être **au-dessus** des rôles qu'il attribue dans la hiérarchie
du serveur, sinon il ne pourra ni les assigner ni les colorer. Discord crée les
nouveaux rôles tout en bas, donc `/setup` produit d'emblée une hiérarchie correcte —
à revérifier seulement si le rôle du bot a été descendu à la main.

`/setup` ne touche jamais à un rôle déjà présent : un serveur qui a ses propres
`Rare` ou `Valid` (couleur, permissions, position) les conserve tels quels. La
correspondance se fait sur le nom, insensible à la casse.

## Données (Firestore)

Le bot est **multi-serveur** : toutes les données sont scopées sous la guilde, si
bien que deux communautés peuvent l'utiliser sans se voir ni se marcher dessus.

| Collection / doc | Contenu |
|---|---|
| `guilds/{guildId}` | Royaume, IDs de la catégorie, des salons et des messages panneau/tableau |
| `guilds/{guildId}/links/{userId}` | Lien membre → perso : `name`, `wclMetric`, `gold`, `claimedAt`, `summary` |
| `guilds/{guildId}/claims/{realm:name}` | Réservation d'un perso, **au sein de cette guilde** |
| `pendingInteractions/{id}` | File de jobs (globale, éphémère) — chaque job porte son `guildId` |

Chaque guilde a donc son propre royaume (`/royaume`), ses propres salons, son propre
roster ; un perso réclamé sur un serveur reste libre sur les autres.

Les perfs Warcraft Logs ne sont jamais stockées telles quelles : seul le `summary`
calculé est mémorisé, pour que le tableau du roster se redessine sans re-requêter WCL.

L'anti-reclaim (`store.ts:105`) passe par une transaction Firestore : réclamer un
perso déjà pris échoue, et changer de perso libère l'ancien.

### Migration depuis la version mono-serveur

Les anciennes données vivaient à la racine (`config/global`, `discordWowLinks`,
`characterClaims`). Un script one-shot les recopie sous `guilds/{guildId}` :

```bash
node scripts/migrate-to-multiguild.cjs
```

Il refuse de s'exécuter si les salons enregistrés n'appartiennent pas à la guilde de
`DISCORD_GUILD_ID`, et laisse les anciennes collections en place (rollback possible).

## Structure

```
functions/src/
  index.ts          # entrées Cloud Functions : interactions (HTTP) + worker (Firestore)
  verify.ts         # vérification de la signature Ed25519 des requêtes Discord
  interactions.ts   # routage commandes / boutons / modals -> réponse ou mise en file
  jobs.ts           # dépôt d'un job dans Firestore
  worker.ts         # exécution du job puis édition de la réponse différée
  service.ts        # orchestration : WCL -> parse + finance + statut -> rôles + pseudo
  grades.ts         # logique pure de résolution des grades et du statut
  warcraftlogs.ts   # client WCL v2 (OAuth2 client credentials + GraphQL)
  discord.ts        # appels REST Discord v10 (rôles, membres, salons, messages)
  panel.ts          # panneau règlement, boutons, select de rôle, modals
  board.ts          # tableau du roster paginé en embeds
  format.ts         # helpers de présentation partagés (emojis, or, statuts)
  setup.ts          # création idempotente de la catégorie et des salons
  store.ts          # accès Firestore (liens, claims, config globale)
  config.ts         # configuration embarquée
  types.ts          # types partagés
register-commands.mjs  # enregistrement des commandes slash (script local)
scripts/
  migrate-to-multiguild.cjs  # migration one-shot mono-serveur -> multi-serveur
```

Seul `functions/` est déployé. À la racine, `register-commands.mjs` est un script
autonome (Node + `dotenv`) et ne partage aucun code avec les fonctions.
