import {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
  ChatInputCommandInteraction,
  TextChannel,
} from 'discord.js';
import { buildPanel } from '../panel.js';

export const data = new SlashCommandBuilder()
  .setName('panneau')
  .setDescription('Poste le panneau explicatif avec le bouton de liaison (admin)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel;
  if (!channel || !channel.isTextBased() || !('send' in channel)) {
    await interaction.reply({
      content: '❌ Impossible de poster ici.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Vérifie les permissions du bot dans ce salon avant d'envoyer.
  const me = interaction.guild?.members.me;
  const perms = me ? (channel as TextChannel).permissionsFor(me) : null;
  const missing: string[] = [];
  if (perms) {
    if (!perms.has(PermissionFlagsBits.ViewChannel)) missing.push('Voir le salon');
    if (!perms.has(PermissionFlagsBits.SendMessages)) missing.push('Envoyer des messages');
  }
  if (missing.length > 0) {
    await interaction.reply({
      content:
        `❌ Il me manque des permissions dans ce salon : **${missing.join(', ')}**.\n` +
        'Ajoute-les au rôle HolidayBot (dans les autorisations du salon), puis réessaie.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    const panel = await buildPanel();
    await (channel as TextChannel).send(panel);
    await interaction.reply({ content: '✅ Panneau posté.', flags: MessageFlags.Ephemeral });
  } catch (err) {
    await interaction.reply({
      content: `❌ Envoi impossible : ${(err as Error).message}. Vérifie mes permissions dans ce salon.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
