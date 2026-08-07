// Helpers de présentation partagés (tableau, messages de grade, /whoami).
import type { LinkSummary } from './types';

const ROLE_EMOJI: Record<LinkSummary['role'], string> = {
  tank: '🛡️',
  heal: '💚',
  dps: '⚔️',
};

export function roleEmoji(role: LinkSummary['role']): string {
  return ROLE_EMOJI[role] ?? ROLE_EMOJI.dps;
}

export function statusBadge(status: LinkSummary['status']): string {
  switch (status) {
    case 'valid':
      return '✅';
    case 'caddie':
      return '🛒';
    case 'refused':
      return '⛔';
    default:
      return '⚪';
  }
}

export const STATUS_TEXT: Record<LinkSummary['status'], string> = {
  valid: '✅ **Validé** pour le raid.',
  caddie: '🛒 **Caddie** (sac à PO) — parse faible mais budget OK.',
  refused: '⛔ **Non éligible** — parse < seuil et budget insuffisant.',
  nograde: '⚪ Aucun grade attribuable.',
};

export function fmtGold(gold: number): string {
  if (gold >= 1_000_000) return `${(gold / 1_000_000).toFixed(1)}m`;
  return gold >= 1000 ? `${Math.round(gold / 1000)}k` : `${gold}`;
}

/** Horodatage relatif rendu par le client Discord (« il y a 2 heures »). */
export function relativeTime(ms: number): string {
  return `<t:${Math.floor(ms / 1000)}:R>`;
}
