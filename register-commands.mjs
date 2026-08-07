// Enregistrement des commandes slash (indépendant du code du bot).
import 'dotenv/config';

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;
const MANAGE_ROLES = '268435456';
const MANAGE_GUILD = '32';

const commands = [
  {
    name: 'link',
    description: 'Lie ton perso WoW pour la vérif GDKP',
    options: [
      { type: 3, name: 'perso', description: 'Nom du personnage (ex: Thrall)', required: true },
      {
        type: 3,
        name: 'role',
        description: 'Rôle de jeu (défaut: auto)',
        choices: [
          { name: 'Auto (détection)', value: 'auto' },
          { name: 'DPS', value: 'dps' },
          { name: 'Heal', value: 'hps' },
          { name: 'Tank', value: 'tank' },
        ],
      },
      { type: 3, name: 'or', description: 'Or disponible (ex: 150k)' },
    ],
  },
  { name: 'unlink', description: 'Supprime le lien avec ton perso' },
  { name: 'whoami', description: 'Affiche ton perso lié' },
  {
    name: 'grade',
    description: 'Recalcule le grade selon Warcraft Logs',
    options: [{ type: 6, name: 'membre', description: 'Membre à mettre à jour (admin)' }],
  },
  {
    name: 'refresh',
    description: 'Recalcule tout le roster (admin)',
    default_member_permissions: MANAGE_ROLES,
  },
  {
    name: 'panneau',
    description: 'Poste le panneau GDKP (admin)',
    default_member_permissions: MANAGE_ROLES,
  },
  {
    name: 'royaume',
    description: 'Définit le royaume par défaut (admin)',
    default_member_permissions: MANAGE_GUILD,
    options: [{ type: 3, name: 'nom', description: 'Nom du royaume (ex: Auberdine)', required: true }],
  },
  {
    name: 'setup',
    description: 'Crée les salons vérification + roster et publie tout (admin)',
    default_member_permissions: MANAGE_GUILD,
  },
  {
    name: 'tableau',
    description: 'Poste le tableau du roster dans ce salon (admin)',
    default_member_permissions: MANAGE_ROLES,
  },
];

const url = `https://discord.com/api/v10/applications/${DISCORD_CLIENT_ID}/guilds/${DISCORD_GUILD_ID}/commands`;
const res = await fetch(url, {
  method: 'PUT',
  headers: { Authorization: `Bot ${DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(commands),
});
if (res.ok) {
  const data = await res.json();
  console.log(`✅ ${data.length} commandes déployées :`, data.map((c) => '/' + c.name).join(' '));
} else {
  console.log('❌ Échec', res.status, await res.text());
}
