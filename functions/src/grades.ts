// Mapping perf -> grade (logique pure, sans appel Discord).
import type { Config, Grade, FinanceGrade, CharacterPerformance, ResolvedGrade } from './types';

export type MemberStatus = 'valid' | 'caddie' | 'refused' | 'nograde';

/** Grade financier selon l'or déclaré (PO). */
export function resolveFinanceGrade(cfg: Config, gold: number): FinanceGrade {
  const sorted = [...cfg.financeGrades].sort((a, b) => b.min - a.min);
  return sorted.find((g) => gold >= g.min) ?? sorted[sorted.length - 1];
}

/**
 * Statut d'accès au raid :
 *  - valid  : parse >= seuil (bon joueur)
 *  - caddie : parse < seuil MAIS or >= caddie.minGold (mauvais mais riche)
 *  - refused: parse < seuil ET or < caddie.minGold
 */
export function resolveStatus(cfg: Config, parseScore: number | null, gold: number): MemberStatus {
  const minParse = cfg.raidAccess?.minParse ?? 50;
  if (parseScore !== null && parseScore >= minParse) return 'valid';
  if (gold >= cfg.caddie.minGold) return 'caddie';
  return 'refused';
}

/** Noms (minuscules) de tous les rôles de grade financier. */
export function allFinanceRoleNames(cfg: Config): Set<string> {
  return new Set(cfg.financeGrades.map((g) => g.role.toLowerCase()));
}

/** Noms (minuscules) des rôles de statut (Valid, Caddie). */
export function allStatusRoleNames(cfg: Config): Set<string> {
  const s = new Set<string>();
  if (cfg.raidAccess) s.add(cfg.raidAccess.role.toLowerCase());
  s.add(cfg.caddie.role.toLowerCase());
  return s;
}

function gradeTablesFor(cfg: Config): Record<string, Grade[]> {
  if (Array.isArray(cfg.grades)) {
    return { __all: [...cfg.grades].sort((a, b) => b.min - a.min) };
  }
  const out: Record<string, Grade[]> = {};
  for (const [key, table] of Object.entries(cfg.grades)) {
    out[key] = [...table].sort((a, b) => b.min - a.min);
  }
  return out;
}

/** Tous les noms de rôles de grade (minuscules). */
export function allGradeRoleNames(cfg: Config): Set<string> {
  const tables = gradeTablesFor(cfg);
  const names = new Set<string>();
  for (const table of Object.values(tables)) {
    for (const g of table) names.add(g.role.toLowerCase());
  }
  return names;
}

/** Détermine le grade selon les perfs par difficulté (HM prioritaire si >= minBosses). */
export function resolveGrade(cfg: Config, character: CharacterPerformance): ResolvedGrade | null {
  const metric = cfg.metric || 'averageParse';
  const priority = cfg.gradePriority ?? cfg.difficulties.map((d) => d.key);
  const tables = gradeTablesFor(cfg);

  for (const key of priority) {
    const p = character.byKey[key];
    if (!p) continue;

    const diffCfg = cfg.difficulties.find((d) => d.key === key);
    const minBosses = diffCfg?.minBosses ?? 1;
    if (p.bossesRanked < minBosses) continue;

    const score =
      (p[metric as keyof typeof p] as number | undefined) ?? p.averageParse ?? p.bestOverall;
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
