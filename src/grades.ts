// Logique de mapping perf -> grade + application des rôles Discord.
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Guild, GuildMember, Role } from 'discord.js';
import type { Config, Grade, CharacterPerformance, ResolvedGrade } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, '..', 'config.json');

let config: Config | null = null;

export async function getConfig(): Promise<Config> {
  if (config) return config;
  const raw = await readFile(CONFIG_FILE, 'utf8');
  config = JSON.parse(raw) as Config;
  return config;
}

/** Retourne toutes les tables de grade (une par difficulté) sous forme normalisée. */
function gradeTablesFor(cfg: Config): Record<string, Grade[]> {
  // Deux formes acceptées :
  //  - grades = [ {min, role}, ... ]        -> table unique, toutes difficultés
  //  - grades = { hm: [...], nm: [...] }    -> une table par clé de difficulté
  if (Array.isArray(cfg.grades)) {
    return { __all: [...cfg.grades].sort((a, b) => b.min - a.min) };
  }
  const out: Record<string, Grade[]> = {};
  for (const [key, table] of Object.entries(cfg.grades)) {
    out[key] = [...table].sort((a, b) => b.min - a.min);
  }
  return out;
}

/** Ensemble (minuscules) de tous les noms de rôles de grade, toutes difficultés confondues. */
export function allGradeRoleNames(cfg: Config): Set<string> {
  const tables = gradeTablesFor(cfg);
  const names = new Set<string>();
  for (const table of Object.values(tables)) {
    for (const g of table) names.add(g.role.toLowerCase());
  }
  return names;
}

/**
 * Détermine le grade d'un perso à partir de ses perfs par difficulté.
 * Parcourt les difficultés par ordre de priorité (HM avant NM par défaut)
 * et attribue le grade de la première difficulté où le perso a des logs
 * suffisants (>= minBosses).
 */
export function resolveGrade(cfg: Config, character: CharacterPerformance): ResolvedGrade | null {
  const metric = cfg.metric || 'averageParse';
  const priority = cfg.gradePriority ?? cfg.difficulties.map((d) => d.key);
  const tables = gradeTablesFor(cfg);

  for (const key of priority) {
    const p = character.byKey[key];
    if (!p) continue;

    // Seuil de boss minimum pour être classé sur cette difficulté.
    const diffCfg = cfg.difficulties.find((d) => d.key === key);
    const minBosses = diffCfg?.minBosses ?? 1;
    if (p.bossesRanked < minBosses) continue;

    const score = (p[metric as keyof typeof p] as number | undefined) ?? p.averageParse ?? p.bestOverall;
    if (score === null || score === undefined) continue;

    const table = tables[key] ?? tables.__all ?? [];
    const grade = table.find((g) => score >= g.min);
    if (!grade) continue;

    return {
      grade,
      score,
      difficultyKey: key,
      difficultyLabel: diffCfg?.label ?? key.toUpperCase(),
      perf: p,
    };
  }
  return null;
}

/**
 * Applique le rôle de grade à un membre : ajoute le bon rôle et retire
 * les autres rôles de grade. Ne touche à aucun autre rôle.
 */
export async function applyGradeRole(
  guild: Guild,
  member: GuildMember,
  targetGrade: Grade,
): Promise<{ added: boolean; roleName: string; changed: boolean }> {
  const cfg = await getConfig();
  const gradeRoleNames = allGradeRoleNames(cfg);

  const targetName = targetGrade.role;
  const targetRole = guild.roles.cache.find(
    (r) => r.name.toLowerCase() === targetName.toLowerCase(),
  );
  if (!targetRole) {
    throw new Error(
      `Le rôle "${targetName}" n'existe pas sur le serveur. Crée-le (nom exact) puis réessaie.`,
    );
  }

  // Synchronise la couleur du rôle avec la couleur de parse (si activé et possible).
  if (cfg.syncRoleColors && targetGrade.color) {
    const wanted = targetGrade.color.toUpperCase();
    if ((targetRole.hexColor || '').toUpperCase() !== wanted) {
      try {
        await targetRole.setColor(wanted as `#${string}`, 'Couleur de parse WoW');
      } catch {
        // pas bloquant : le bot n'est peut-être pas au-dessus du rôle
      }
    }
  }

  // Rôles de grade à retirer (tous sauf la cible)
  const toRemove = member.roles.cache.filter(
    (r: Role) => gradeRoleNames.has(r.name.toLowerCase()) && r.id !== targetRole.id,
  );

  const alreadyHas = member.roles.cache.has(targetRole.id);
  let changed = false;

  if (toRemove.size > 0) {
    await member.roles.remove(toRemove, 'Mise à jour du grade WoW');
    changed = true;
  }
  if (!alreadyHas) {
    await member.roles.add(targetRole, 'Attribution du grade WoW');
    changed = true;
  }

  return { added: !alreadyHas, roleName: targetRole.name, changed };
}

/**
 * Ajoute ou retire le rôle "Validé raid" selon l'éligibilité (parse >= seuil).
 * Ne fait rien si raidAccess n'est pas configuré. Non bloquant si le rôle manque.
 */
export async function applyRaidAccessRole(
  guild: Guild,
  member: GuildMember,
  eligible: boolean,
  cfg: Config,
): Promise<{ eligible: boolean; changed: boolean; missingRole: boolean }> {
  if (!cfg.raidAccess) return { eligible, changed: false, missingRole: false };

  const role = guild.roles.cache.find(
    (r) => r.name.toLowerCase() === cfg.raidAccess!.role.toLowerCase(),
  );
  if (!role) return { eligible, changed: false, missingRole: true };

  const has = member.roles.cache.has(role.id);
  if (eligible && !has) {
    await member.roles.add(role, 'Éligible raid GDKP');
    return { eligible, changed: true, missingRole: false };
  }
  if (!eligible && has) {
    await member.roles.remove(role, 'Non éligible raid GDKP');
    return { eligible, changed: true, missingRole: false };
  }
  return { eligible, changed: false, missingRole: false };
}
