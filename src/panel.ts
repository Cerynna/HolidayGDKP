// Panneau d'accueil GDKP : un post explicatif + un bouton "Lier mon perso".
// Parcours : bouton -> menu déroulant du rôle -> formulaire (nom + royaume).
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  MessageFlags,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type GuildMember,
  type BaseMessageOptions,
} from 'discord.js';
import { getConfig } from './grades.js';
import { processLink } from './service.js';
import type { Grade, WclMetric } from './types.js';

export const LINK_BUTTON_ID = 'wow_link_button';
export const ROLE_SELECT_ID = 'wow_role_select';
export const LINK_MODAL_PREFIX = 'wow_link_modal'; // customId = `wow_link_modal:<role>`
const FIELD_NAME = 'name';
const FIELD_REALM = 'realm';

function allGrades(grades: Grade[] | Record<string, Grade[]>): Grade[] {
  return Array.isArray(grades) ? grades : Object.values(grades).flat();
}

/** Construit le message du panneau (embed + bouton). */
export async function buildPanel(): Promise<BaseMessageOptions> {
  const cfg = await getConfig();

  // Légende compacte des couleurs de parse (depuis la config).
  const seen = new Set<string>();
  const legend = allGrades(cfg.grades)
    .filter((g) => (seen.has(g.role) ? false : (seen.add(g.role), true)))
    .sort((a, b) => b.min - a.min)
    .map((g) => `${g.emoji ?? '•'}${g.min}`)
    .join(' · ');

  const minParse = cfg.raidAccess?.minParse ?? 50;
  const accessRole = cfg.raidAccess?.role ?? 'Validé raid';

  const content = [
    '# 🏆 HOLIDAYS GDKP — Roster Élite · Jeudi soir 🏆',
    '',
    'Afin de proposer un raid **ultra propre, rapide et rentable**, Holidays GDKP ouvre son **Roster Élite** pour les soirées du **JEUDI SOIR** !',
    '',
    '🎯 **L’objectif** : un Full Clean rapide, zéro prise de tête, avec un niveau de jeu élevé.',
    '',
    '## 📋 Conditions d’entrée',
    `- **Logs BLEUS (${minParse}+) minimum** sur ton perso (Violets/Orange très appréciés 🟪🟧)`,
    '- Connaissance parfaite du raid et **équipement optimisé**',
    '- Addon **Gargul** à jour',
    '',
    '## 💰 Concept exclusif : la prime à la performance !',
    'L’organisation **NE PREND AUCUNE COMMISSION** sur ce raid.',
    '👉 Les **10 % de part orga** sont **intégralement redistribués** le lendemain en **BONUS CASH** aux **10 meilleurs joueurs** (classement selon les meilleurs logs DPS / Heal / Tank) !',
    '',
    '## ⚠️ Règle anti-parse monkey',
    'Le respect des **strats et du groupe** passe avant les chiffres ! Les orgas / Raid Leaders se réservent le droit de **DISQUALIFIER de la prime** tout joueur qui ignore les mécaniques, cause des wipes ou met le groupe en danger pour gonfler ses logs.',
    '',
    '## 📝 Comment postuler ?',
    `Clique sur **🔗 Postuler** ci-dessous : choisis ton rôle, renseigne ton perso, et le bot vérifie automatiquement tes **WarcraftLogs**. Si tu es au niveau (parse ≥ **${minParse} %**), tu reçois le rôle **« ${accessRole} »**.`,
    '**Places limitées !**',
    '',
    `-# 🎨 ${legend} — la couleur de ton rôle = ta moyenne de parse · Siege of Orgrimmar · MoP Classic`,
  ].join('\n');

  const button = new ButtonBuilder()
    .setCustomId(LINK_BUTTON_ID)
    .setLabel('🔗 Postuler (lier mon perso)')
    .setStyle(ButtonStyle.Success);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);
  return { content, components: [row] };
}

/** Étape 1 : le bouton ouvre un menu déroulant pour choisir le rôle de jeu. */
export async function showRoleSelect(interaction: ButtonInteraction): Promise<void> {
  const select = new StringSelectMenuBuilder()
    .setCustomId(ROLE_SELECT_ID)
    .setPlaceholder('Choisis ton rôle de jeu')
    .addOptions(
      { label: 'Auto (détection)', value: 'auto', emoji: '🔍', description: 'Le bot détecte DPS ou Heal' },
      { label: 'DPS', value: 'dps', emoji: '⚔️' },
      { label: 'Heal', value: 'hps', emoji: '💚' },
      { label: 'Tank', value: 'tank', emoji: '🛡️' },
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  await interaction.reply({
    content: 'Quel est ton **rôle de jeu** ?',
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

/** Étape 2 : le choix du rôle ouvre le formulaire (nom + royaume). */
export async function showLinkModal(interaction: StringSelectMenuInteraction): Promise<void> {
  const role = interaction.values[0] ?? 'auto';

  const modal = new ModalBuilder()
    .setCustomId(`${LINK_MODAL_PREFIX}:${role}`)
    .setTitle('Lier mon perso WoW');

  const name = new TextInputBuilder()
    .setCustomId(FIELD_NAME)
    .setLabel('Nom du personnage')
    .setPlaceholder('ex : Thrall')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const realm = new TextInputBuilder()
    .setCustomId(FIELD_REALM)
    .setLabel('Royaume')
    .setPlaceholder('ex : Hyjal')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(name),
    new ActionRowBuilder<TextInputBuilder>().addComponents(realm),
  );

  await interaction.showModal(modal);
}

/** Étape 3 : traitement du formulaire (le rôle est encodé dans le customId). */
export async function handleLinkModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const wclMetric = (interaction.customId.split(':')[1] ?? 'auto') as WclMetric;
  const name = interaction.fields.getTextInputValue(FIELD_NAME);
  const realm = interaction.fields.getTextInputValue(FIELD_REALM);

  const message = await processLink(
    interaction.guild!,
    interaction.member as GuildMember,
    name,
    realm,
    null, // région : défaut de la config
    wclMetric,
  );
  await interaction.editReply(message);
}
