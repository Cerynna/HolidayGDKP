import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { processLink } from '../service.js';
export const data = new SlashCommandBuilder()
    .setName('link')
    .setDescription('Associe ton perso Warcraft Logs à ton compte Discord')
    .addStringOption((o) => o.setName('perso').setDescription('Nom du personnage, ex: Thrall').setRequired(true))
    .addStringOption((o) => o.setName('royaume').setDescription('Royaume, ex: Hyjal').setRequired(true))
    .addStringOption((o) => o
    .setName('role')
    .setDescription('Rôle de jeu (défaut : détection auto DPS/Heal)')
    .addChoices({ name: 'Auto (détection)', value: 'auto' }, { name: 'DPS', value: 'dps' }, { name: 'Heal', value: 'hps' }, { name: 'Tank', value: 'tank' }))
    .addStringOption((o) => o
    .setName('region')
    .setDescription('Région (par défaut celle de la config)')
    .addChoices({ name: 'EU', value: 'eu' }, { name: 'US', value: 'us' }, { name: 'KR', value: 'kr' }, { name: 'TW', value: 'tw' }));
export async function execute(interaction) {
    const name = interaction.options.getString('perso', true);
    const server = interaction.options.getString('royaume', true);
    const region = interaction.options.getString('region');
    const wclMetric = (interaction.options.getString('role') ?? 'auto');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const message = await processLink(interaction.guild, interaction.member, name, server, region, wclMetric);
    await interaction.editReply(message);
}
//# sourceMappingURL=link.js.map