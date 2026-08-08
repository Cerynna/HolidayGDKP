import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, } from 'discord.js';
import { allLinks } from '../store.js';
import { updateMemberGrade } from '../service.js';
export const data = new SlashCommandBuilder()
    .setName('refresh')
    .setDescription('Recalcule le grade de tous les membres liés (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);
export async function execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const links = await allLinks();
    if (links.length === 0) {
        await interaction.editReply('ℹ️ Aucun membre lié pour le moment.');
        return;
    }
    const lines = [];
    let updated = 0;
    let errors = 0;
    for (const link of links) {
        let member;
        try {
            member = await interaction.guild.members.fetch(link.userId);
        }
        catch {
            lines.push(`⚪ <@${link.userId}> — plus sur le serveur, ignoré`);
            continue;
        }
        try {
            const result = await updateMemberGrade(interaction.guild, member);
            if (result.ok && result.resolved && result.applied && result.character) {
                if (result.applied.changed)
                    updated++;
                const r = result.resolved;
                const elig = result.eligible === false ? ' ⛔' : result.eligible ? ' 🪙' : '';
                lines.push(`${result.applied.changed ? '🟢' : '⚪'} ${member.displayName} — ` +
                    `${result.character.name} : ${r.difficultyLabel} ${fmt(r.score)}% → ${r.grade.emoji ?? ''} ${r.grade.role}${elig}`);
            }
            else {
                lines.push(`⚪ ${member.displayName} — pas de grade attribuable`);
            }
        }
        catch (err) {
            errors++;
            lines.push(`🔴 ${member.displayName} — ${truncate(err.message, 80)}`);
        }
    }
    const header = `**Refresh terminé** — ${links.length} lié(s), ${updated} mis à jour, ${errors} erreur(s).\n`;
    await interaction.editReply(header + truncate(lines.join('\n'), 1800));
}
function fmt(v) {
    return v === null || v === undefined ? '—' : v.toFixed(1);
}
function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
//# sourceMappingURL=refresh.js.map