import { getLink, setLink } from './store.js';
import { getCharacterPerformance } from './warcraftlogs.js';
import { getConfig, resolveGrade, applyGradeRole, applyRaidAccessRole } from './grades.js';
/** Récupère les perfs (toutes difficultés) d'un membre lié, sans toucher aux rôles. */
export async function fetchMemberPerformance(member) {
    const link = await getLink(member.id);
    if (!link)
        return { ok: false, reason: 'not_linked' };
    const cfg = await getConfig();
    const character = await getCharacterPerformance({
        name: link.name,
        server: link.server,
        region: link.region,
        zoneID: cfg.zoneID,
        classic: cfg.classic ?? false,
        difficulties: cfg.difficulties,
        wclMetric: link.wclMetric ?? 'auto',
    });
    const resolved = resolveGrade(cfg, character);
    return { ok: true, character, resolved, link };
}
/**
 * Met à jour le grade d'un membre Discord (récupère les perfs puis applique le rôle).
 */
export async function updateMemberGrade(guild, member) {
    const cfg = await getConfig();
    const res = await fetchMemberPerformance(member);
    if (!res.ok)
        return res;
    if (!res.resolved) {
        // Aucune perf : pas de grade, et on retire l'accès raid s'il l'avait.
        await applyRaidAccessRole(guild, member, false, cfg);
        return { ok: false, reason: 'no_grade', character: res.character, eligible: false };
    }
    const applied = await applyGradeRole(guild, member, res.resolved.grade);
    const eligible = cfg.raidAccess ? res.resolved.score >= cfg.raidAccess.minParse : true;
    await applyRaidAccessRole(guild, member, eligible, cfg);
    return { ok: true, character: res.character, resolved: res.resolved, applied, eligible };
}
/**
 * Formate les perfs NM/HM d'un perso en texte lisible pour Discord.
 * Ex: "HM 63.1% DPS (2/14) · NM 68.0% DPS (12/14)"
 */
export function formatPerf(character, cfg, metric = 'averageParse') {
    const parts = [];
    for (const d of cfg.difficulties) {
        const p = character.byKey[d.key];
        if (p) {
            const v = p[metric] ?? p.averageParse ?? p.bestOverall;
            const tag = p.metric ? ` ${p.metric.toUpperCase()}` : '';
            parts.push(`**${d.label}** ${fmt(v)}%${tag} (${p.bossesRanked}/${p.bossesTotal})`);
        }
        else {
            parts.push(`**${d.label}** —`);
        }
    }
    return parts.join(' · ');
}
function fmt(v) {
    return v === null || v === undefined ? '—' : v.toFixed(1);
}
/** Ligne de statut d'éligibilité au raid GDKP (vide si non configuré). */
export function eligibilityLine(cfg, eligible) {
    if (!cfg.raidAccess)
        return '';
    return eligible
        ? `🪙 **Éligible au raid GDKP** — rôle « ${cfg.raidAccess.role} » attribué.`
        : `⛔ **Non éligible** — parse moyen sous le seuil requis (${cfg.raidAccess.minParse}%).`;
}
/** Normalise un texte libre de rôle vers une métrique WCL. */
export function normalizeRole(input) {
    const v = (input ?? '').trim().toLowerCase();
    if (v.startsWith('heal') || v === 'hps' || v === 'soin')
        return 'hps';
    if (v.startsWith('tank'))
        return 'tank';
    if (v === 'dps' || v.startsWith('dd') || v.startsWith('dmg'))
        return 'dps';
    return 'auto';
}
/**
 * Enregistre le lien d'un membre puis calcule/applique son grade.
 * Partagé par la commande /link et le modal du panneau.
 * @returns le message (Markdown) à renvoyer au membre.
 */
export async function processLink(guild, member, nameInput, serverInput, regionInput, wclMetric) {
    const cfg = await getConfig();
    const region = (regionInput?.trim() || cfg.region).toLowerCase();
    const name = nameInput.trim();
    const server = serverInput.trim();
    if (!name || !server) {
        return '❌ Renseigne le **nom du perso** et le **royaume**.';
    }
    await setLink(member.id, { name, server, region, wclMetric });
    try {
        const result = await updateMemberGrade(guild, member);
        if (result.ok && result.resolved && result.character) {
            const c = result.character;
            const r = result.resolved;
            return (`✅ Lié à **${c.name}-${server}** (${region.toUpperCase()}).\n` +
                `${formatPerf(c, cfg)}\n` +
                `→ grade ${r.grade.emoji ?? ''} **${r.grade.role}** (sur ${r.difficultyLabel}).\n` +
                eligibilityLine(cfg, result.eligible));
        }
        if (result.reason === 'no_grade' && result.character) {
            return (`✅ Lié à **${result.character.name}-${server}**, mais aucune perf exploitable pour attribuer un grade.\n` +
                formatPerf(result.character, cfg));
        }
        return `✅ Lié à **${name}-${server}**.`;
    }
    catch (err) {
        return `⚠️ Lié à **${name}-${server}**, mais impossible de récupérer les perfs :\n> ${err.message}`;
    }
}
//# sourceMappingURL=service.js.map