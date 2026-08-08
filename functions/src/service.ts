// Orchestration métier (worker) : WCL -> grade parse + finance + statut -> rôles + pseudo + tableau.
import { config as cfg } from './config';
import {
  getLink,
  setLink,
  allLinks,
  getRealm,
  getReport,
  saveReport,
  addReportExclusion,
} from './store';
import { fmtGold } from './format';
import { buildReportButtons } from './panel';
import {
  getCharacterPerformance,
  slugifyServer,
  getReportTop,
  extractReportCode,
} from './warcraftlogs';
import {
  resolveGrade,
  resolveFinanceGrade,
  resolveStatus,
  allGradeRoleNames,
  allFinanceRoleNames,
  allStatusRoleNames,
} from './grades';
import {
  getGuildRoles,
  getMember,
  addMemberRole,
  removeMemberRole,
  setRoleColor,
  setNickname,
  type DiscordRole,
  type MessagePayload,
} from './discord';
import { updateBoard } from './board';
import { statusBadge, buildSummaryEmbed } from './format';
import type { CharacterPerformance, LinkSummary, WclMetric } from './types';

export function normalizeRole(input: string | null | undefined): WclMetric {
  const v = (input ?? '').trim().toLowerCase();
  if (v.startsWith('heal') || v === 'hps' || v === 'soin') return 'hps';
  if (v.startsWith('tank')) return 'tank';
  if (v === 'dps' || v.startsWith('dd') || v.startsWith('dmg')) return 'dps';
  return 'auto';
}

/** Parse un montant d'or : "150k", "150 000", "150000", "1.5m" -> nombre de PO. */
export function parseGold(input: string | null | undefined): number {
  if (!input) return 0;
  const s = input.toLowerCase().replace(/\s|po|g/g, '').replace(',', '.').trim();
  const m = s.match(/^([0-9]*\.?[0-9]+)\s*(k|m)?$/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (m[2] === 'k') n *= 1_000;
  else if (m[2] === 'm') n *= 1_000_000;
  return Math.round(n);
}

function fmt(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : v.toFixed(1);
}

function formatPerf(character: CharacterPerformance): string {
  const parts: string[] = [];
  for (const d of cfg.difficulties) {
    const p = character.byKey[d.key];
    if (p) {
      const tag = p.metric ? ` ${p.metric.toUpperCase()}` : '';
      parts.push(`**${d.label}** ${fmt(p.averageParse)}%${tag} (${p.bossesRanked}/${p.bossesTotal})`);
    } else {
      parts.push(`**${d.label}** —`);
    }
  }
  return parts.join(' · ');
}

function findRole(roles: DiscordRole[], name: string): DiscordRole | undefined {
  return roles.find((r) => r.name.toLowerCase() === name.toLowerCase());
}

/** Applique un rôle exclusif dans une dimension (retire les autres, ajoute la cible). */
async function applyExclusiveRole(
  guildId: string,
  userId: string,
  memberRoleIds: string[],
  targetName: string | null,
  dimensionNames: Set<string>,
  roles: DiscordRole[],
  colorHex?: string,
): Promise<void> {
  const target = targetName ? findRole(roles, targetName) : undefined;
  if (targetName && !target) throw new Error(`Le rôle "${targetName}" n'existe pas sur le serveur.`);

  for (const rid of memberRoleIds) {
    const r = roles.find((x) => x.id === rid);
    if (r && dimensionNames.has(r.name.toLowerCase()) && (!target || r.id !== target.id)) {
      await removeMemberRole(guildId, userId, r.id);
    }
  }
  if (target) {
    if (colorHex) {
      const wanted = parseInt(colorHex.replace('#', ''), 16);
      if (target.color !== wanted) await setRoleColor(guildId, target.id, colorHex);
    }
    if (!memberRoleIds.includes(target.id)) await addMemberRole(guildId, userId, target.id);
  }
}

function baseName(nick: string | null, globalName: string | null, username: string): string {
  const raw = (nick || globalName || username || '').trim();
  return raw.replace(/^\[[^\]]*\]\s*/, '').trim() || username;
}

function buildNick(parseScore: number | null, financeEmoji: string, base: string): string {
  const p = parseScore === null ? '--' : String(Math.round(parseScore));
  const prefix = `[${p} - ${financeEmoji}] `;
  const room = Math.max(1, 32 - prefix.length);
  return (prefix + base).slice(0, prefix.length + room);
}

interface GradeResult {
  perfDetail: string;
  summary: LinkSummary;
}

/** Cœur : calcule et applique parse + finance + statut + pseudo pour un membre. */
async function gradeMemberCore(
  guildId: string,
  userId: string,
  name: string,
  gold: number,
  wclMetric: WclMetric,
  realm: string,
  roles: DiscordRole[],
  member: { roles: string[]; nick: string | null; username: string; globalName: string | null },
): Promise<GradeResult> {
  const character = await getCharacterPerformance({
    name,
    server: realm,
    region: cfg.region,
    zoneID: cfg.zoneID,
    classic: cfg.classic ?? false,
    difficulties: cfg.difficulties,
    wclMetric,
  });

  const resolved = resolveGrade(cfg, character);
  const finance = resolveFinanceGrade(cfg, gold);
  const parseScore = resolved ? resolved.score : null;
  const status = resolveStatus(cfg, parseScore, gold);

  // 1) rôle de parse (avec couleur)
  if (resolved) {
    await applyExclusiveRole(
      guildId,
      userId,
      member.roles,
      resolved.grade.role,
      allGradeRoleNames(cfg),
      roles,
      cfg.syncRoleColors ? resolved.grade.color : undefined,
    );
  }
  // 2) rôle de finance
  await applyExclusiveRole(guildId, userId, member.roles, finance.role, allFinanceRoleNames(cfg), roles);
  // 3) rôle de statut (valid / caddie / aucun)
  const statusRole =
    status === 'valid' ? cfg.raidAccess?.role ?? null : status === 'caddie' ? cfg.caddie.role : null;
  await applyExclusiveRole(guildId, userId, member.roles, statusRole, allStatusRoleNames(cfg), roles);

  // 4) pseudo [parse - emoji finance] Nom
  const nick = buildNick(parseScore, finance.emoji ?? '', baseName(member.nick, member.globalName, member.username));
  await setNickname(guildId, userId, nick).catch(() => {});

  const host = cfg.classic ? 'classic.warcraftlogs.com' : 'www.warcraftlogs.com';
  const logUrl = `https://${host}/character/${cfg.region}/${slugifyServer(realm)}/${encodeURIComponent(character.name)}`;

  // Rôle affiché : tank si choisi, sinon métrique détectée (hps=heal, dps=dps).
  const detected = resolved?.perf.metric;
  const role: 'tank' | 'heal' | 'dps' =
    wclMetric === 'tank'
      ? 'tank'
      : wclMetric === 'hps'
        ? 'heal'
        : wclMetric === 'dps'
          ? 'dps'
          : detected === 'hps'
            ? 'heal'
            : 'dps';

  const summary: LinkSummary = {
    char: character.name,
    logUrl,
    role,
    parseEmoji: resolved?.grade.emoji ?? '⚪',
    parseRole: resolved?.grade.role ?? '—',
    parseScore: parseScore ?? 0,
    parseDiff: resolved?.difficultyLabel ?? '—',
    financeEmoji: finance.emoji ?? '',
    financeRole: finance.role,
    gold,
    status,
    updatedAt: Date.now(),
  };

  return { perfDetail: formatPerf(character), summary };
}

/** /link et /grade : traite un membre, met à jour le tableau. */
export async function runGrade(guildId: string, userId: string): Promise<MessagePayload> {
  const link = await getLink(guildId, userId);
  if (!link) {
    return { content: "ℹ️ Aucun perso lié. Utilise le bouton **📝 Postuler** ou `/link`." };
  }

  const member = await getMember(guildId, userId);
  if (!member) return { content: '⚠️ Membre introuvable sur le serveur.' };

  const roles = await getGuildRoles(guildId);
  const realm = await getRealm(guildId);
  const { perfDetail, summary } = await gradeMemberCore(
    guildId,
    userId,
    link.name,
    link.gold ?? 0,
    link.wclMetric ?? 'auto',
    realm,
    roles,
    member,
  );

  await setLink(guildId, userId, { ...link, summary });
  await updateBoard(guildId).catch(() => {});

  const embed = buildSummaryEmbed(summary, realm, [
    { name: '🗡️ Détail par difficulté', value: perfDetail },
  ]);
  return { embeds: [embed] };
}

/** /refresh : recalcule tout le roster. */
export async function runRefresh(guildId: string): Promise<MessagePayload> {
  const links = await allLinks(guildId);
  if (links.length === 0) return { content: 'ℹ️ Aucun membre lié pour le moment.' };

  const roles = await getGuildRoles(guildId);
  const realm = await getRealm(guildId);
  const lines: string[] = [];
  let ok = 0;
  let errors = 0;

  for (const link of links) {
    const member = await getMember(guildId, link.userId);
    if (!member) {
      lines.push(`⚪ <@${link.userId}> — plus sur le serveur`);
      continue;
    }
    try {
      const { summary } = await gradeMemberCore(
        guildId,
        link.userId,
        link.name,
        link.gold ?? 0,
        link.wclMetric ?? 'auto',
        realm,
        roles,
        member,
      );
      await setLink(guildId, link.userId, { ...link, summary });
      ok++;
      const badge = statusBadge(summary.status);
      lines.push(
        `${badge} ${summary.char} : ${summary.parseEmoji}${summary.parseScore}% · ${summary.financeEmoji}${summary.financeRole}`,
      );
    } catch (e) {
      errors++;
      lines.push(`🔴 <@${link.userId}> — ${truncate((e as Error).message, 60)}`);
    }
  }

  await updateBoard(guildId).catch(() => {});
  const header = `**Refresh** — ${links.length} lié(s), ${ok} classé(s), ${errors} erreur(s).\n`;
  return { content: truncate(header + lines.join('\n'), 1900) };
}

/** Emoji du grade de parse correspondant à un score. */
function parseEmojiFor(score: number): string {
  const table = Array.isArray(cfg.grades) ? cfg.grades : Object.values(cfg.grades).flat();
  const g = [...table].sort((a, b) => b.min - a.min).find((x) => score >= x.min);
  return g?.emoji ?? '⚪';
}

const REPORT_ROLE_EMOJI = { tank: '🛡️', heal: '💚', dps: '⚔️' } as const;

export interface ReportOptions {
  reportUrl?: string;
  pot?: number;
  excludeName?: string;
}

/** /rapport : refresh du roster + Top 10 (bonus, mentions Discord, exclusions). */
export async function runReport(guildId: string, opts: ReportOptions): Promise<MessagePayload> {
  const code = extractReportCode(opts.reportUrl ?? '');
  if (!code) {
    return {
      content:
        '❌ Lien de rapport invalide. Exemple :\n`https://fr.classic.warcraftlogs.com/reports/aBcD1234efGh`',
    };
  }

  // Exclusion demandée (pour CE rapport) enregistrée avant la lecture.
  if (opts.excludeName) await addReportExclusion(guildId, code, opts.excludeName);

  const saved = await getReport(guildId, code);
  const pot = opts.pot ?? saved?.pot ?? 0;
  const excluded = new Set((saved?.excluded ?? []).map((s) => s.toLowerCase()));
  if (opts.excludeName) excluded.add(opts.excludeName.toLowerCase());

  const report = await getReportTop(code, cfg.classic ?? false);

  // Met à jour tout le roster déjà en base (grades, rôles, pseudos, tableau).
  await runRefresh(guildId).catch(() => {});

  // Classement pas encore prêt (raid trop récent) : bouton pour réessayer.
  if (report.players.length === 0) {
    await saveReport(guildId, code, { pot });
    return {
      content:
        '⏳ **Classement pas encore disponible** pour ce rapport (le raid est peut-être trop récent). ' +
        'Réessaie dans quelques minutes avec le bouton ci-dessous.',
      components: buildReportButtons(code, pot, false),
    };
  }

  const eligible = report.players.filter((p) => !excluded.has(p.name.toLowerCase()));
  const top = eligible.slice(0, 10);

  // Mentions Discord : nom de perso -> userId lié.
  const links = await allLinks(guildId);
  const byChar = new Map<string, string>();
  for (const l of links) {
    if (l.name) byChar.set(l.name.toLowerCase(), l.userId);
    if (l.summary?.char) byChar.set(l.summary.char.toLowerCase(), l.userId);
  }

  // Bonus = 10 % du pot, réparti en parts égales entre le Top.
  const bonusPool = Math.round(pot * 0.1);
  const bonusPer = top.length ? Math.floor(bonusPool / top.length) : 0;

  const already = saved?.processedAt ? '⚠️ *Rapport déjà traité — recalcul.*\n' : '';

  // Tableau aligné (monospace) : pas d'emoji/lien dans le bloc code pour garder l'alignement.
  const roleTxt: Record<string, string> = { tank: 'TANK', heal: 'HEAL', dps: 'DPS' };
  const rows = top.map((p, i) => {
    const rank = String(i + 1).padStart(2);
    const name = (p.name.length > 15 ? p.name.slice(0, 14) + '…' : p.name).padEnd(15);
    const role = (roleTxt[p.role] ?? '').padEnd(4);
    const parse = `${p.avgParse.toFixed(1)}%`.padStart(6);
    const bonus = pot > 0 ? `  ${`+${fmtGold(bonusPer)}`.padStart(6)}` : '';
    return `${rank}  ${name} ${role} ${parse}${bonus}`;
  });
  const header =
    `${'#'.padStart(2)}  ${'Joueur'.padEnd(15)} ${'Rôle'.padEnd(4)} ${'Parse'.padStart(6)}` +
    (pot > 0 ? `  ${'Bonus'.padStart(6)}` : '');
  const table = '```\n' + header + '\n' + rows.join('\n') + '\n```';

  // Mentions Discord des joueurs du Top (pour ping / paiement du bonus).
  const mentions = top
    .map((p) => byChar.get(p.name.toLowerCase()))
    .filter((v): v is string => Boolean(v))
    .map((uid) => `<@${uid}>`);
  const mentionLine = mentions.length ? `👉 **À récompenser :** ${mentions.join(' ')}` : '';

  await saveReport(guildId, code, { processedAt: Date.now(), pot, excluded: [...excluded] });

  const footer = [
    `${report.zoneName || 'Raid'} · ${report.bossCount} boss · ${eligible.length}/${report.totalPlayers} éligibles`,
  ];
  if (pot > 0) {
    footer.push(`Pot ${fmtGold(pot)} · bonus 10% = ${fmtGold(bonusPool)} → +${fmtGold(bonusPer)}/joueur`);
  }
  if (excluded.size) footer.push(`${excluded.size} exclu(s)`);

  const embed = {
    color: 0xe5cc80,
    title: `🏆 Top ${top.length} — ${report.title || 'Raid'}`,
    description: [already + table, mentionLine].filter(Boolean).join('\n'),
    footer: { text: footer.join(' · ') },
  };
  return { embeds: [embed], components: buildReportButtons(code, pot, true) };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
