// Config embarquée (pas de lecture de fichier en serverless).
import type { Config } from './types';

export const config: Config = {
  classic: true,
  region: 'eu',
  defaultRealm: 'Auberdine',
  zoneID: 1054,
  metric: 'averageParse',
  syncRoleColors: true,
  difficulties: [
    { key: 'hm', label: 'HM', id: 4, minBosses: 6 },
    { key: 'nm', label: 'NM', id: 3, minBosses: 1 },
  ],
  gradePriority: ['hm', 'nm'],
  raidAccess: {
    minParse: 50,
    role: 'Valid',
  },
  // Grade financier (or en PO)
  financeGrades: [
    { min: 200000, role: 'Diamant', emoji: '💎' },
    { min: 150000, role: 'Argent', emoji: '🥈' },
    { min: 100000, role: 'Bronze', emoji: '🥉' },
    { min: 50000, role: 'Fer', emoji: '⚙️' },
    { min: 0, role: 'Bois', emoji: '🪵' },
  ],
  // Caddie : mauvais joueur (parse < minParse) mais riche (or >= minGold)
  caddie: {
    minGold: 100000,
    role: 'Caddie',
    emoji: '🛒',
  },
  grades: [
    { min: 100, role: 'Parfait', color: '#E5CC80', emoji: '🟨' },
    { min: 99, role: 'Prodige', color: '#E268A8', emoji: '🩷' },
    { min: 95, role: 'Légendaire', color: '#FF8000', emoji: '🟧' },
    { min: 75, role: 'Épique', color: '#A335EE', emoji: '🟪' },
    { min: 50, role: 'Rare', color: '#0070FF', emoji: '🟦' },
    { min: 25, role: 'Inhabituel', color: '#1EFF00', emoji: '🟩' },
    { min: 0, role: 'Commun', color: '#666666', emoji: '⬜' },
  ],
};
