import { SlashCommandBuilder, MessageFlags, ChatInputCommandInteraction } from 'discord.js';
import { removeLink } from '../store.js';

export const data = new SlashCommandBuilder()
  .setName('unlink')
  .setDescription('Supprime le lien avec ton perso Warcraft Logs');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const existed = await removeLink(interaction.user.id);
  await interaction.reply({
    content: existed ? '✅ Lien supprimé.' : "ℹ️ Tu n'avais aucun perso lié.",
    flags: MessageFlags.Ephemeral,
  });
}
