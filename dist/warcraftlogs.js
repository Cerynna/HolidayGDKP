const TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';
const GRAPHQL_URL_RETAIL = 'https://www.warcraftlogs.com/api/v2/client';
const GRAPHQL_URL_CLASSIC = 'https://classic.warcraftlogs.com/api/v2/client';
let cachedToken = null;
let tokenExpiresAt = 0;
/** Récupère (et met en cache) un token OAuth2 via le flow client_credentials. */
async function getToken() {
    const now = Date.now();
    if (cachedToken && now < tokenExpiresAt - 60_000) {
        return cachedToken;
    }
    const id = process.env.WCL_CLIENT_ID;
    const secret = process.env.WCL_CLIENT_SECRET;
    if (!id || !secret) {
        throw new Error('WCL_CLIENT_ID / WCL_CLIENT_SECRET manquants dans .env');
    }
    const basic = Buffer.from(`${id}:${secret}`).toString('base64');
    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Auth WCL échouée (${res.status}): ${text}`);
    }
    const data = (await res.json());
    cachedToken = data.access_token;
    tokenExpiresAt = now + (data.expires_in ?? 3600) * 1000;
    return cachedToken;
}
/** Exécute une requête GraphQL authentifiée. */
async function graphql(query, variables, classic = false) {
    const token = await getToken();
    const url = classic ? GRAPHQL_URL_CLASSIC : GRAPHQL_URL_RETAIL;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Requête WCL échouée (${res.status}): ${text}`);
    }
    const json = (await res.json());
    if (json.errors?.length) {
        throw new Error(`GraphQL: ${json.errors.map((e) => e.message).join(' | ')}`);
    }
    return json.data;
}
// Construit une requête avec un champ zoneRankings aliasé par (difficulté × métrique WCL),
// pour récupérer NM/HM en DPS et/ou HPS en un seul appel.
// Alias : `${difficultyKey}__${metric}` (ex: hm__dps, nm__hps).
function buildRankingsQuery(difficulties, metrics) {
    const fields = [];
    for (const d of difficulties) {
        for (const m of metrics) {
            fields.push(`        ${d.key}__${m}: zoneRankings(zoneID: $zone, difficulty: ${d.id}, metric: ${m})`);
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
/**
 * Transforme un nom de royaume en slug WCL (minuscules, sans accents, tirets).
 * Ex: "Conseil des Ombres" -> "conseil-des-ombres"
 */
export function slugifyServer(server) {
    return server
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '') // enlève les accents
        .toLowerCase()
        .trim()
        .replace(/['\s]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}
// Difficultés par défaut (MoP Classic) si non fournies par la config.
const DEFAULT_DIFFICULTIES = [
    { key: 'hm', label: 'HM', id: 4 },
    { key: 'nm', label: 'NM', id: 3 },
];
/** Transforme un objet zoneRankings WCL en métriques de perf, ou null si aucun kill. */
function parseZoneRankings(zr, metric) {
    if (!zr || zr.error || !Array.isArray(zr.rankings))
        return null;
    const killed = zr.rankings.filter((r) => typeof r.rankPercent === 'number');
    if (killed.length === 0)
        return null;
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
// Rôle demandé -> métrique(s) WCL à interroger.
// 'auto' interroge dps ET hps puis garde la meilleure (détection heal/dps).
function metricsForRole(wclMetric) {
    if (wclMetric === 'hps')
        return ['hps'];
    if (wclMetric === 'dps' || wclMetric === 'tank')
        return ['dps'];
    return ['dps', 'hps']; // auto
}
/**
 * Récupère les perfs d'un perso pour chaque difficulté (NM, HM...),
 * avec détection ou choix de la métrique (DPS/HPS).
 */
export async function getCharacterPerformance({ name, server, region, zoneID, classic = false, difficulties = DEFAULT_DIFFICULTIES, wclMetric = 'auto', }) {
    const metrics = metricsForRole(wclMetric);
    const query = buildRankingsQuery(difficulties, metrics);
    const data = await graphql(query, {
        name,
        server: slugifyServer(server),
        region: region.toLowerCase(),
        zone: zoneID ?? null,
    }, classic);
    const character = data?.characterData?.character;
    if (!character) {
        throw new Error(`Perso introuvable sur Warcraft Logs : "${name}-${server}" (${region.toUpperCase()}). Vérifie le nom, le royaume et la région.`);
    }
    const byKey = {};
    for (const d of difficulties) {
        // Parse chaque métrique interrogée pour cette difficulté.
        const candidates = metrics
            .map((m) => parseZoneRankings(character[`${d.key}__${m}`], m))
            .filter((p) => p !== null);
        // En mode auto : on garde la métrique au meilleur parse moyen (= le vrai rôle).
        candidates.sort((a, b) => b.averageParse - a.averageParse);
        byKey[d.key] = candidates[0] ?? null;
    }
    return { name: character.name, byKey, difficulties };
}
function numOrNull(v) {
    return typeof v === 'number' ? round1(v) : null;
}
function round1(v) {
    return Math.round(v * 10) / 10;
}
//# sourceMappingURL=warcraftlogs.js.map