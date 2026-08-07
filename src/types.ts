// Types partagés du bot.
import type {
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';

export type WclMetric = 'auto' | 'dps' | 'hps' | 'tank';

export interface Difficulty {
  key: string; // ex: 'hm', 'nm'
  label: string; // ex: 'HM', 'NM'
  id: number; // id de difficulté WCL (3 = Normal, 4 = Heroic)
  minBosses?: number; // boss minimum pour être classé sur cette difficulté
}

export interface Grade {
  min: number; // seuil de parse (%)
  role: string; // nom exact du rôle Discord
  color?: string; // couleur hexa (#RRGGBB)
  emoji?: string; // pastille affichée dans les messages
}

/** Table unique (tous difficultés) ou table par clé de difficulté. */
export type GradesConfig = Grade[] | Record<string, Grade[]>;

export interface RaidAccess {
  minParse: number; // parse moyen minimum pour être éligible au raid
  role: string; // rôle Discord attribué aux joueurs éligibles
}

export interface Config {
  classic?: boolean;
  region: string;
  zoneID: number | null;
  metric: string; // champ de perf utilisé pour le grade (ex: 'averageParse')
  syncRoleColors?: boolean;
  difficulties: Difficulty[];
  gradePriority?: string[];
  grades: GradesConfig;
  raidAccess?: RaidAccess;
}

export interface Link {
  name: string;
  server: string;
  region: string;
  wclMetric?: WclMetric;
}

export type LinkStore = Record<string, Link>;

/** Perfs d'un perso pour une difficulté donnée. */
export interface DifficultyPerf {
  metric: string; // métrique WCL réellement utilisée ('dps' | 'hps')
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

/** Contrat d'une commande slash. */
export interface Command {
  data: {
    name: string;
    toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
  };
  execute(interaction: ChatInputCommandInteraction): Promise<unknown>;
}
