// Tableau admin paginé (embeds) : membre -> perso (lien logs) -> parse -> finance -> statut.
// Trié par parse décroissant puis or décroissant.
import { allLinks, getGuildConfig, setBoard } from './store';
import { createMessage, editMessage, deleteMessage } from './discord';
import { roleEmoji, statusBadge, fmtGold } from './format';
import type { LinkSummary } from './types';

const MAX_DESC = 3900; // marge sous la limite embed (4096)
const COLOR = 0xe5cc80;

interface Row {
  userId: string;
  summary: LinkSummary;
}

async function fetchRows(guildId: string): Promise<{ rows: Row[]; total: number; notGraded: number }> {
  const links = await allLinks(guildId);
  const rows = links.filter((l) => l.summary).map((l) => ({ userId: l.userId, summary: l.summary! }));
  // Tri : parse décroissant, puis or décroissant
  rows.sort((a, b) => b.summary.parseScore - a.summary.parseScore || b.summary.gold - a.summary.gold);
  return { rows, total: links.length, notGraded: links.length - rows.length };
}

function lineFor(r: Row): string {
  const s = r.summary;
  return (
    `${statusBadge(s.status)} <@${r.userId}> — [**${s.char}**](${s.logUrl}) ${roleEmoji(s.role)} · ` +
    `${s.parseEmoji} ${s.parseScore}% · ${s.financeEmoji} ${fmtGold(s.gold)}`
  );
}

/** Rend le tableau en une ou plusieurs pages (embeds). Pur, testable. */
export function renderBoardPages(rows: Row[], total: number, notGraded: number): unknown[] {
  const lines = rows.map(lineFor);
  const chunks: string[] = [];
  let cur = '';
  for (const line of lines) {
    if ((cur + '\n' + line).length > MAX_DESC) {
      chunks.push(cur);
      cur = '';
    }
    cur += (cur ? '\n' : '') + line;
  }
  if (cur || chunks.length === 0) chunks.push(cur || '_Aucun inscrit._');

  const suffix = notGraded > 0 ? ` · ${notGraded} en attente` : '';
  return chunks.map((desc, i) => ({
    color: COLOR,
    title: i === 0 ? `📋 Roster GDKP — ${total} inscrit(s)` : '📋 Roster GDKP (suite)',
    description: desc,
    footer: {
      text:
        `✅ Valid · 🛒 Caddie · ⛔ Refusé · trié par parse puis or${suffix}` +
        (chunks.length > 1 ? ` — page ${i + 1}/${chunks.length}` : ''),
    },
  }));
}

async function buildPages(guildId: string): Promise<unknown[]> {
  const { rows, total, notGraded } = await fetchRows(guildId);
  return renderBoardPages(rows, total, notGraded);
}

/** Met à jour le tableau existant (édite/crée/supprime selon le nombre de pages). */
export async function updateBoard(guildId: string): Promise<void> {
  const g = await getGuildConfig(guildId);
  const channel = g.rosterChannelId || g.boardChannelId;
  if (!channel) return;
  const existing = g.boardMessageIds ?? [];
  if (existing.length === 0) return;

  const pages = await buildPages(guildId);
  const ids: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    if (i < existing.length) {
      const ok = await editMessage(channel, existing[i], { content: '', embeds: [pages[i]] });
      ids.push(ok ? existing[i] : await createMessage(channel, { embeds: [pages[i]] }));
    } else {
      ids.push(await createMessage(channel, { embeds: [pages[i]] }));
    }
  }
  for (let i = pages.length; i < existing.length; i++) {
    await deleteMessage(channel, existing[i]).catch(() => {});
  }
  await setBoard(guildId, channel, ids);
}

/** (Re)poste le tableau dans un salon : supprime l'ancien, crée les nouvelles pages. */
export async function postBoard(guildId: string, channelId: string): Promise<void> {
  const g = await getGuildConfig(guildId);
  const oldChannel = g.rosterChannelId || g.boardChannelId;
  for (const id of g.boardMessageIds ?? []) {
    if (oldChannel) await deleteMessage(oldChannel, id).catch(() => {});
  }
  const pages = await buildPages(guildId);
  const ids: string[] = [];
  for (const page of pages) ids.push(await createMessage(channelId, { embeds: [page] }));
  await setBoard(guildId, channelId, ids);
}
