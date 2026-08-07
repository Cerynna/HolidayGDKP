# Discord WoW Bot — Grades via Warcraft Logs

Bot Discord (Node.js / discord.js v14) qui attribue automatiquement un **rôle de grade**
à un membre en fonction de son **best parse % (perf global)** récupéré sur
l'API **Warcraft Logs v2**.

## Fonctionnalités

- `/link Nom-Royaume [region]` — associe ton perso WoW à ton compte Discord.
- `/unlink` — supprime l'association.
- `/whoami` — affiche le perso lié.
- `/grade [membre]` — recalcule le grade (soi-même ; un autre membre = admin).
- `/refresh` — recalcule le grade de **tous** les membres liés (admin).

Le bot lit la perf sur Warcraft Logs, la compare aux seuils de `config.json`,
puis attribue le rôle correspondant et retire les autres rôles de grade.

## Installation

```bash
npm install
```

## Configuration

1. Copie `.env.example` en `.env` et remplis les valeurs :
   - `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` — Discord Developer Portal.
   - `DISCORD_GUILD_ID` — ID de ton serveur (active le mode développeur Discord,
     clic droit sur le serveur → « Copier l'identifiant »).
   - `WCL_CLIENT_ID`, `WCL_CLIENT_SECRET` — https://www.warcraftlogs.com/api/clients/

2. Ajuste `config.json` :
   - `classic` — `true` pour WoW Classic (API `classic.warcraftlogs.com`), `false` pour retail.
     Configuré sur **MoP Classic** ici.
   - `region` — région par défaut (`eu`, `us`, `kr`, `tw`).
   - `zoneID` — ID de zone WCL. MoP Classic : `1054` Siege of Orgrimmar, `1046` Throne of
     Thunder, `1040` HoF/ToES, `1038` Mogu'shan Vaults. `null` = tier par défaut.
   - `metric` — métrique de perf :
     - `averageParse` (**recommandé**) — moyenne des meilleurs parses sur les boss
       **tués** ; fonctionne même sans clear complet.
     - `bestOverall` — meilleur parse unique du perso.
     - `bestPerformanceAverage` / `medianPerformanceAverage` — natifs WCL, mais
       **null tant que le raid n'est pas full clear** (repli automatique vers
       `averageParse` puis `bestOverall`).
   - `difficulties` — difficultés interrogées (MoP SoO : `hm` = id 4, `nm` = id 3).
     `minBosses` = nombre de boss tués minimum pour être classé sur cette difficulté
     (HM exige 6 boss, sinon le joueur est classé sur son NM).
   - `gradePriority` — ordre d'évaluation des difficultés (`["hm","nm"]`).
   - `grades` — seuils de parse → grade. Chaque entrée : `min`, `role` (nom exact du
     rôle Discord), `color` (hexa, couleur de parse WCL), `emoji` (pastille affichée).
     Accepte aussi un objet `{ hm: [...], nm: [...] }` pour des grades distincts par
     difficulté.
   - `syncRoleColors` — si `true`, le bot force la couleur du rôle Discord pour qu'elle
     corresponde au `color` du grade (nécessite que le rôle du bot soit au-dessus).

## Rôles Discord à créer

Crée sur ton serveur des rôles portant **exactement** les noms de `config.json`.
Grille par défaut = couleurs de parse Warcraft Logs (le bot colore les rôles
automatiquement si `syncRoleColors` est activé) :

| Parse | Rôle | Couleur |
|-------|------|---------|
| 100   | `Parfait`    | 🟨 or (#E5CC80) |
| 99    | `Prodige`    | 🩷 rose (#E268A8) |
| 95–98 | `Légendaire` | 🟧 orange (#FF8000) |
| 75–94 | `Épique`     | 🟪 violet (#A335EE) |
| 50–74 | `Rare`       | 🟦 bleu (#0070FF) |
| 25–49 | `Inhabituel` | 🟩 vert (#1EFF00) |
| 0–24  | `Commun`     | ⬜ gris (#666666) |

⚠️ Le rôle du bot doit être **au-dessus** de ces rôles de grade dans la hiérarchie
(Paramètres du serveur → Rôles), sinon il ne pourra pas les attribuer.

## Permissions du bot

Lors de l'invitation (URL OAuth2 avec scope `bot applications.commands`), donne au
bot la permission **Gérer les rôles**. Active aussi l'intent **Server Members** dans
le Developer Portal (Bot → Privileged Gateway Intents).

## Lancement

Projet en **TypeScript**, lancé avec [`tsx`](https://github.com/privatenumber/tsx)
(pas de build nécessaire en dev).

```bash
# 1. Déployer les commandes slash (à refaire quand tu ajoutes/modifies une commande)
npm run deploy

# 2. Démarrer le bot (tsx, rechargement à chaud avec `npm run dev`)
npm start
```

Scripts utiles : `npm run typecheck` (vérif des types), `npm run build` (compile
vers `dist/`), `npm run start:prod` (exécute le build compilé).

## Structure

```
src/
  index.ts            # client Discord + routage des interactions
  deploy-commands.ts  # enregistrement des commandes slash
  types.ts            # types partagés (Config, Link, perfs WCL...)
  warcraftlogs.ts     # client API WCL (OAuth2 + GraphQL, DPS/HPS)
  grades.ts           # mapping perf -> grade + application des rôles
  service.ts          # orchestration lien -> perf -> rôle
  store.ts            # persistance des liens (Firestore)
  firebase.ts         # init Firebase Admin (Firestore)
  commands/
    index.ts          # registre statique typé des commandes
    *.ts              # une commande slash par fichier
config.json           # seuils de grades + options
tsconfig.json         # config TypeScript (ESM NodeNext, strict)
```

## Stockage des données (Firestore)

Le seul état persistant est l'association **membre Discord → perso WoW**, stockée
dans **Firestore** (collection `discordWowLinks`, un document par membre, id = user
Discord). Les perfs Warcraft Logs ne sont pas stockées : elles sont relues à la volée
à chaque `/grade` ou `/refresh`, donc toujours à jour.

### Configurer Firebase

1. Console Firebase → **Paramètres du projet → Comptes de service** →
   *Générer une nouvelle clé privée*. Tu obtiens un fichier JSON.
2. Place-le à la racine du projet sous le nom **`serviceAccount.json`**
   (déjà dans `.gitignore`), ou indique son chemin via `FIREBASE_SERVICE_ACCOUNT_PATH`.
3. (Optionnel) `FIREBASE_COLLECTION` pour changer le nom de la collection.

Tout l'accès au stockage est isolé dans `src/store.ts` (get/set/remove/all) au-dessus
de `src/firebase.ts` (init Admin SDK).

Comme tout passe par `src/store.ts`, changer de backend plus tard (autre base,
cache, front web temps réel) ne toucherait que ce fichier.
