// Orchestration métier (worker) : WCL -> grade parse + finance + statut -> rôles + pseudo + tableau.
import { config as cfg } from './config';
import { getLink, setLink, allLinks, getRealm } from './store';
import { getCharacterPerformance, slugifyServer } from './warcraftlogs';
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
} from './discord';
import { updateBoard } from './board';
import { statusBadge, fmtGold, STATUS_TEXT } from './format';
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
  message: string;
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

  const message =
    `✅ **${character.name}-${realm}**\n` +
    `${formatPerf(character)}\n` +
    `→ Parse ${summary.parseEmoji} **${summary.parseRole}**` +
    (resolved ? ` (${fmt(parseScore)}% ${summary.parseDiff})` : '') +
    ` · Finance ${finance.emoji} **${finance.role}** (${fmtGold(gold)})\n` +
    STATUS_TEXT[status];

  return { message, summary };
}

/** /link et /grade : traite un membre, met à jour le tableau. */
export async function runGrade(guildId: string, userId: string): Promise<string> {
  const link = await getLink(guildId, userId);
  if (!link) return "ℹ️ Aucun perso lié. Utilise le bouton **Postuler** ou `/link`.";

  const member = await getMember(guildId, userId);
  if (!member) return '⚠️ Membre introuvable sur le serveur.';

  const roles = await getGuildRoles(guildId);
  const realm = await getRealm(guildId);
  const { message, summary } = await gradeMemberCore(
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
  return message;
}

/** /refresh : recalcule tout le roster. */
export async function runRefresh(guildId: string): Promise<string> {
  const links = await allLinks(guildId);
  if (links.length === 0) return 'ℹ️ Aucun membre lié pour le moment.';

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
  return truncate(header + lines.join('\n'), 1900);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
