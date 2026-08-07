import { SlashCommandBuilder, MessageFlags, ChatInputCommandInteraction } from 'discord.js';
import { getLink } from '../store.js';

const ROLE_LABEL: Record<string, string> = {
  auto: 'Auto',
  dps: 'DPS',
  hps: 'Heal',
  tank: 'Tank',
};

export const data = new SlashCommandBuilder()
  .setName('whoami')
  .setDescription('Affiche le perso Warcraft Logs lié à ton compte');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const link = await getLink(interaction.user.id);
  await interaction.reply({
    content: link
      ? `🔗 Lié à **${link.name}-${link.server}** (${link.region.toUpperCase()}) — rôle : ${
          ROLE_LABEL[link.wclMetric ?? 'auto']
        }.`
      : "ℹ️ Aucun perso lié. Utilise `/link Nom-Royaume`.",
    flags: MessageFlags.Ephemeral,
  });
}
