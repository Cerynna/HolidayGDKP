import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, } from 'discord.js';
import { updateMemberGrade, formatPerf, eligibilityLine } from '../service.js';
import { getConfig } from '../grades.js';
export const data = new SlashCommandBuilder()
    .setName('grade')
    .setDescription('Recalcule le grade selon les perfs Warcraft Logs')
    .addUserOption((o) => o
    .setName('membre')
    .setDescription('Membre à mettre à jour (admin uniquement, sinon toi-même)'));
export async function execute(interaction) {
    const targetUser = interaction.options.getUser('membre');
    const isOther = Boolean(targetUser && targetUser.id !== interaction.user.id);
    if (isOther && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
        await interaction.reply({
            content: "❌ Tu n'as pas la permission de mettre à jour le grade d'un autre membre.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    const member = (isOther
        ? await interaction.guild.members.fetch(targetUser.id)
        : interaction.member);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const cfg = await getConfig();
    try {
        const result = await updateMemberGrade(interaction.guild, member);
        if (!result.ok && result.reason === 'not_linked') {
            await interaction.editReply(isOther
                ? `ℹ️ ${member} n'a pas de perso lié.`
                : "ℹ️ Tu n'as pas de perso lié. Utilise `/link Nom-Royaume`.");
            return;
        }
        if (!result.ok && result.reason === 'no_grade' && result.character) {
            await interaction.editReply(`⚠️ Aucune perf exploitable pour **${result.character.name}**.\n${formatPerf(result.character, cfg)}`);
            return;
        }
        if (result.character && result.resolved && result.applied) {
            const who = isOther ? `${member} — ` : '';
            const c = result.character;
            const r = result.resolved;
            const badge = r.grade.emoji ?? '';
            const change = result.applied.changed
                ? `→ grade ${badge} **${r.grade.role}** ✅`
                : `→ grade ${badge} **${r.grade.role}** (inchangé)`;
            const elig = eligibilityLine(cfg, result.eligible);
            await interaction.editReply(`${who}**${c.name}** : ${formatPerf(c, cfg)} ${change} (sur ${r.difficultyLabel})` +
                (elig ? `\n${elig}` : ''));
        }
    }
    catch (err) {
        await interaction.editReply(`⚠️ Erreur : ${err.message}`);
    }
}
//# sourceMappingURL=grade.js.map