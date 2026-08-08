// Client Warcraft Logs API v2 (OAuth2 client credentials + GraphQL).
import type { Difficulty, DifficultyPerf, CharacterPerformance, WclMetric } from './types';

const TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';
const GRAPHQL_URL_RETAIL = 'https://www.warcraftlogs.com/api/v2/client';
const GRAPHQL_URL_CLASSIC = 'https://classic.warcraftlogs.com/api/v2/client';

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60_000) return cachedToken;

  const id = process.env.WCL_CLIENT_ID;
  const secret = process.env.WCL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('WCL_CLIENT_ID / WCL_CLIENT_SECRET manquants');

  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Auth WCL échouée (${res.status})`);

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in ?? 3600) * 1000;
  return cachedToken;
}

async function graphql<T = unknown>(
  query: string,
  variables: Record<string, unknown>,
  classic = false,
): Promise<T> {
  const token = await getToken();
  const url = classic ? GRAPHQL_URL_CLASSIC : GRAPHQL_URL_RETAIL;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Requête WCL échouée (${res.status})`);
  const json = (await res.json()) as { data: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(`GraphQL: ${json.errors.map((e) => e.message).join(' | ')}`);
  return json.data;
}

function buildRankingsQuery(difficulties: Difficulty[], metrics: string[]): string {
  const fields: string[] = [];
  for (const d of difficulties) {
    for (const m of metrics) {
      fields.push(
        `        ${d.key}__${m}: zoneRankings(zoneID: $zone, difficulty: ${d.id}, metric: ${m})`,
      );
    }
  }
  return `
  query CharacterRankings($name: String!, $server: String!, $region: String!, $zone: Int) {
    characterData {
      character(name: $name, serverSlug: $server, serverRegion: $region) {
        name
        classID
${fields.join('\n')}
      }
    }
  }
`;
}

export function slugifyServer(server: string): string {
  return server
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/['\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const DEFAULT_DIFFICULTIES: Difficulty[] = [
  { key: 'hm', label: 'HM', id: 4 },
  { key: 'nm', label: 'NM', id: 3 },
];

interface RawRanking {
  rankPercent: number | null;
  totalKills?: number;
}
interface RawZoneRankings {
  error?: string;
  bestPerformanceAverage?: number | null;
  medianPerformanceAverage?: number | null;
  rankings?: RawRanking[];
}

function parseZoneRankings(zr: RawZoneRankings | undefined, metric: string): DifficultyPerf | null {
  if (!zr || zr.error || !Array.isArray(zr.rankings)) return null;
  const killed = zr.rankings.filter(
    (r): r is RawRanking & { rankPercent: number } => typeof r.rankPercent === 'number',
  );
  if (killed.length === 0) return null;

  const bestOverall = killed.reduce((max, r) => (r.rankPercent > max ? r.rankPercent : max), 0);
  const averageParse = killed.reduce((sum, r) => sum + r.rankPercent, 0) / killed.length;

  return {
    metric,
    averageParse: round1(averageParse),
    bestOverall: round1(bestOverall),
    bossesRanked: killed.length,
    bossesTotal: zr.rankings.length,
    bestPerformanceAverage: numOrNull(zr.bestPerformanceAverage),
    medianPerformanceAverage: numOrNull(zr.medianPerformanceAverage),
    totalKills: killed.reduce((sum, r) => sum + (r.totalKills ?? 0), 0) || null,
  };
}

function metricsForRole(wclMetric: WclMetric): string[] {
  if (wclMetric === 'hps') return ['hps'];
  if (wclMetric === 'dps' || wclMetric === 'tank') return ['dps'];
  return ['dps', 'hps'];
}

interface GetPerformanceOptions {
  name: string;
  server: string;
  region: string;
  zoneID?: number | null;
  classic?: boolean;
  difficulties?: Difficulty[];
  wclMetric?: WclMetric;
}

export async function getCharacterPerformance({
  name,
  server,
  region,
  zoneID,
  classic = false,
  difficulties = DEFAULT_DIFFICULTIES,
  wclMetric = 'auto',
}: GetPerformanceOptions): Promise<CharacterPerformance> {
  const metrics = metricsForRole(wclMetric);
  const query = buildRankingsQuery(difficulties, metrics);
  const data = await graphql<{
    characterData?: { character?: ({ name: string } & Record<string, RawZoneRankings>) | null };
  }>(
    query,
    { name, server: slugifyServer(server), region: region.toLowerCase(), zone: zoneID ?? null },
    classic,
  );

  const character = data?.characterData?.character;
  if (!character) {
    throw new Error(
      `Perso introuvable sur Warcraft Logs : "${name}-${server}" (${region.toUpperCase()}).`,
    );
  }

  const byKey: Record<string, DifficultyPerf | null> = {};
  for (const d of difficulties) {
    const candidates = metrics
      .map((m) => parseZoneRankings(character[`${d.key}__${m}`], m))
      .filter((p): p is DifficultyPerf => p !== null);
    candidates.sort((a, b) => b.averageParse - a.averageParse);
    byKey[d.key] = candidates[0] ?? null;
  }

  return { name: character.name, byKey, difficulties };
}

function numOrNull(v: number | null | undefined): number | null {
  return typeof v === 'number' ? round1(v) : null;
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

// --- Rapport (report) : Top des joueurs d'un raid ---

export interface ReportPlayer {
  name: string;
  server: string;
  className: string;
  spec: string;
  role: 'tank' | 'heal' | 'dps';
  avgParse: number; // moyenne du meilleur parse par boss (sur les 14)
  best: number;
  bosses: number; // nombre de boss différents faits
}

export interface ReportTop {
  title: string;
  zoneName: string;
  bossCount: number; // nombre de boss du raid (hors agrégat)
  totalPlayers: number; // joueurs présents (avant filtre full clear)
  endRaiders: number; // présents au dernier boss (effectif de fin = base du split)
  players: ReportPlayer[]; // FULL CLEAR uniquement, triés par avgParse décroissant
}

/** Extrait le code de rapport d'une URL WarcraftLogs (ex: .../reports/CODE?...). */
export function extractReportCode(input: string): string | null {
  const m = input.trim().match(/reports\/([A-Za-z0-9]+)/);
  if (m) return m[1];
  // accepte aussi un code brut
  return /^[A-Za-z0-9]{16,}$/.test(input.trim()) ? input.trim() : null;
}

const ROLE_MAP: Record<string, 'tank' | 'heal' | 'dps'> = {
  tanks: 'tank',
  healers: 'heal',
  dps: 'dps',
};

/**
 * Classement des joueurs d'un rapport. On ne garde QUE les joueurs présents sur
 * TOUS les boss (full clear), et on moyenne leur meilleur parse par boss.
 * L'entrée agrégée du raid (même nom que la zone) est exclue du comptage.
 */
export async function getReportTop(code: string, classic = false): Promise<ReportTop> {
  const query = `
    query ReportRankings($code: String!) {
      reportData {
        report(code: $code) {
          title
          zone { name }
          fights(killType: Kills) { encounterID startTime friendlyPlayers }
          rankings
        }
      }
    }`;
  const data = await graphql<{
    reportData?: {
      report?: {
        title: string;
        zone?: { name: string } | null;
        fights?: Array<{ encounterID: number; startTime: number; friendlyPlayers?: number[] }> | null;
        rankings: { data?: unknown[] } | null;
      } | null;
    };
  }>(query, { code }, classic);

  const report = data?.reportData?.report;
  if (!report) throw new Error('Rapport introuvable. Vérifie le lien.');
  const zoneName = report.zone?.name ?? '';

  interface Acc {
    name: string;
    server: string;
    className: string;
    spec: string;
    role: 'tank' | 'heal' | 'dps';
    byBoss: Map<number, number>; // encounterId -> meilleur rankPercent
  }
  const acc = new Map<string, Acc>();
  const allBosses = new Set<number>();
  // Présents au dernier boss (fightID le plus élevé) = effectif de fin de raid.
  let lastFightId = -1;
  let lastFightParticipants = new Set<string>();

  for (const fight of (report.rankings?.data ?? []) as any[]) {
    const encId: number | undefined = fight?.encounter?.id;
    const encName: string = fight?.encounter?.name ?? '';
    // Exclut l'agrégat du raid (porte le nom de la zone) et les entrées sans boss.
    if (encId == null || encName === zoneName) continue;
    allBosses.add(encId);

    const fightId: number = fight?.fightID ?? 0;
    const participants = new Set<string>();

    const roles = fight?.roles ?? {};
    for (const [roleKey, roleName] of Object.entries(ROLE_MAP)) {
      for (const c of roles[roleKey]?.characters ?? []) {
        const serverName: string =
          typeof c.server === 'string' ? c.server : (c.server?.name ?? c.server?.slug ?? '');
        const key = String(c.id ?? `${c.name}-${serverName}`);
        participants.add(key); // présent à ce combat (même sans parse)

        if (typeof c.rankPercent !== 'number') continue;
        const e =
          acc.get(key) ??
          ({
            name: c.name,
            server: serverName,
            className: c.class,
            spec: c.spec,
            role: roleName,
            byBoss: new Map<number, number>(),
          } as Acc);
        const prev = e.byBoss.get(encId);
        if (prev === undefined || c.rankPercent > prev) e.byBoss.set(encId, c.rankPercent);
        acc.set(key, e);
      }
    }

    if (fightId > lastFightId) {
      lastFightId = fightId;
      lastFightParticipants = participants;
    }
  }

  const bossCount = allBosses.size;

  // Présents au dernier boss via `fights.friendlyPlayers` : inclut les logs masqués
  // (absents des rankings). Fallback sur les participants ranked du dernier combat.
  const bossFights = (report.fights ?? []).filter((f) => f.encounterID > 0);
  const lastBossFight = bossFights.reduce<(typeof bossFights)[number] | null>(
    (best, f) => (best === null || f.startTime > best.startTime ? f : best),
    null,
  );
  const endRaiders = lastBossFight?.friendlyPlayers?.length || lastFightParticipants.size;

  const players: ReportPlayer[] = [...acc.values()]
    .filter((e) => e.byBoss.size === bossCount && bossCount > 0) // full clear uniquement
    .map((e) => {
      const parses = [...e.byBoss.values()];
      return {
        name: e.name,
        server: e.server,
        className: e.className,
        spec: e.spec,
        role: e.role,
        avgParse: round1(parses.reduce((s, v) => s + v, 0) / parses.length),
        best: round1(Math.max(...parses)),
        bosses: e.byBoss.size,
      };
    })
    .sort((a, b) => b.avgParse - a.avgParse);

  return { title: report.title, zoneName, bossCount, totalPlayers: acc.size, endRaiders, players };
}
