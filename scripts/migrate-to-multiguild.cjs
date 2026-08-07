// Migration one-shot vers le modèle multi-guilde.
//   config/global            -> guilds/{guildId}
//   discordWowLinks/{userId} -> guilds/{guildId}/links/{userId}
//   characterClaims/{key}    -> guilds/{guildId}/claims/{key}
//
// Les anciennes collections sont conservées (rollback possible) : à supprimer
// à la main une fois le bot validé en production.
//
//   node scripts/migrate-to-multiguild.cjs
//
// Requiert .env (DISCORD_GUILD_ID, DISCORD_TOKEN) et serviceAccount.json à la racine.
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'node_modules/dotenv')).config({ path: path.join(ROOT, '.env') });

const admin = require(path.join(ROOT, 'functions/node_modules/firebase-admin'));
admin.initializeApp({
  credential: admin.credential.cert(require(path.join(ROOT, 'serviceAccount.json'))),
});
const db = admin.firestore();

const GUILD_ID = process.env.DISCORD_GUILD_ID;

async function main() {
  if (!GUILD_ID) throw new Error('DISCORD_GUILD_ID absent du .env');

  const legacy = await db.doc('config/global').get();
  if (!legacy.exists) {
    console.log('config/global introuvable — rien à migrer.');
    return;
  }
  const { boardMessageId, ...conf } = legacy.data();

  // Garde-fou : les salons enregistrés doivent appartenir à la guilde ciblée.
  const res = await fetch(`https://discord.com/api/v10/channels/${conf.panelChannelId}`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
  });
  const channel = await res.json();
  if (!res.ok || channel.guild_id !== GUILD_ID) {
    throw new Error(
      `Le salon ${conf.panelChannelId} appartient à la guilde ${channel.guild_id ?? '?'}, ` +
        `pas à ${GUILD_ID}. Migration annulée.`,
    );
  }

  const guildRef = db.collection('guilds').doc(GUILD_ID);
  const batch = db.batch();
  batch.set(guildRef, conf, { merge: true });

  const links = await db.collection('discordWowLinks').get();
  links.forEach((d) => batch.set(guildRef.collection('links').doc(d.id), d.data()));

  const claims = await db.collection('characterClaims').get();
  claims.forEach((d) => batch.set(guildRef.collection('claims').doc(d.id), d.data()));

  await batch.commit();

  console.log(`✅ guilds/${GUILD_ID} — config + ${links.size} lien(s) + ${claims.size} claim(s)`);
  if (boardMessageId) console.log(`   champ legacy boardMessageId (${boardMessageId}) non repris`);
  console.log('   anciennes collections conservées — supprime-les après validation.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌', e.message);
    process.exit(1);
  });
