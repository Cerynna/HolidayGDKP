// Types partagés (version Cloud Functions, sans discord.js).

export type WclMetric = 'auto' | 'dps' | 'hps' | 'tank';

export interface Difficulty {
  key: string;
  label: string;
  id: number;
  minBosses?: number;
}

export interface Grade {
  min: number;
  role: string;
  color?: string;
  emoji?: string;
}

export type GradesConfig = Grade[] | Record<string, Grade[]>;

export interface RaidAccess {
  minParse: number;
  role: string;
}

/** Palier de grade financier (or en PO). */
export interface FinanceGrade {
  min: number; // seuil d'or (PO)
  role: string;
  emoji?: string;
}

export interface CaddieRule {
  minGold: number; // or minimum pour être caddie malgré de faibles logs
  role: string;
  emoji?: string;
}

export interface Config {
  classic?: boolean;
  region: string;
  defaultRealm: string; // royaume par défaut (global)
  zoneID: number | null;
  metric: string;
  syncRoleColors?: boolean;
  difficulties: Difficulty[];
  gradePriority?: string[];
  grades: GradesConfig;
  raidAccess?: RaidAccess;
  financeGrades: FinanceGrade[];
  caddie: CaddieRule;
}

/** Résumé calculé, stocké dans le lien pour le tableau admin (sans re-requêter WCL). */
export interface LinkSummary {
  char: string;
  logUrl: string; // lien vers la page WarcraftLogs du perso
  role: 'tank' | 'heal' | 'dps'; // rôle de jeu (détecté ou choisi)
  parseEmoji: string;
  parseRole: string;
  parseScore: number;
  parseDiff: string;
  financeEmoji: string;
  financeRole: string;
  gold: number;
  status: 'valid' | 'caddie' | 'refused' | 'nograde';
  updatedAt: number;
}

export interface Link {
  name: string;
  wclMetric?: WclMetric;
  gold?: number; // or déclaré (PO)
  claimedAt?: number;
  summary?: LinkSummary;
}

/** Config d'une guilde, modifiable par un admin (Firestore guilds/{guildId}). */
export interface GuildConfig {
  realm?: string;
  boardChannelId?: string;
  boardMessageIds?: string[]; // pagination : un message par page
  categoryId?: string;
  panelChannelId?: string;
  panelMessageId?: string;
  rosterChannelId?: string;
  annonceChannelId?: string;
  reportsChannelId?: string;
  eventsChannelId?: string;
  raidVoiceId?: string;
  debriefVoiceId?: string;
  orgaChannelId?: string;
  organisationRoleId?: string;
}

export interface DifficultyPerf {
  metric: string;
  averageParse: number;
  bestOverall: number;
  bossesRanked: number;
  bossesTotal: number;
  bestPerformanceAverage: number | null;
  medianPerformanceAverage: number | null;
  totalKills: number | null;
}

export interface CharacterPerformance {
  name: string;
  byKey: Record<string, DifficultyPerf | null>;
  difficulties: Difficulty[];
}

export interface ResolvedGrade {
  grade: Grade;
  score: number;
  difficultyKey: string;
  difficultyLabel: string;
  perf: DifficultyPerf;
}

/** Job asynchrone déposé dans Firestore et traité par le worker. */
export interface PendingJob {
  kind:
    | 'link'
    | 'grade'
    | 'refresh'
    | 'board'
    | 'refreshBoard'
    | 'setup'
    | 'panel'
    | 'report'
    | 'unlink';
  applicationId: string;
  token: string; // token d'interaction (valide 15 min)
  guildId: string;
  userId: string;
  // paramètres selon le job
  name?: string;
  gold?: number;
  wclMetric?: WclMetric;
  targetUserId?: string; // pour /grade sur un autre membre
  channelId?: string; // salon d'origine, pour /tableau et /panneau (et édition de message)
  reportUrl?: string; // pour /rapport
  pot?: number; // montant total du pot (PO), pour /rapport
  parts?: number; // nombre de parts (split) — override optionnel
  excludeName?: string; // perso à exclure du Top (pour ce rapport)
  messageId?: string; // message à éditer (recalcul/exclusion sur un message existant)
  createdAt?: number;
}

/** Rapport de raid déjà traité (Firestore guilds/{g}/reports/{code}). */
export interface GuildReport {
  processedAt?: number;
  pot?: number;
  parts?: number; // nombre de parts pour le split (mémorisé pour recalcul)
  excluded?: string[]; // noms de perso exclus du Top (minuscules), pour CE rapport
}
