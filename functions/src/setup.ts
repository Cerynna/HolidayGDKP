// Création automatique des salons GDKP (vérification + roster) et publication.
import { getGlobalConfig, updateGlobal } from './store';
import {
  createCategory,
  createTextChannel,
  channelExists,
  createMessage,
  deleteMessage,
  type PermissionOverwrite,
} from './discord';
import { buildPanelMessage } from './panel';
import { postBoard } from './board';

const VIEW = 1024;
const SEND = 2048;
const EMBED = 16384;

/** Salon en lecture seule : membres voient mais n'écrivent pas ; le bot écrit. */
function readOnlyOverwrites(guildId: string, botUserId: string): PermissionOverwrite[] {
  return [
    { id: guildId, type: 0, deny: String(SEND) }, // @everyone : pas d'écriture
    { id: botUserId, type: 1, allow: String(VIEW | SEND | EMBED) }, // le bot : tout
  ];
}

async function ensureChannel(
  current: string | undefined,
  create: () => Promise<string>,
): Promise<string> {
  if (current && (await channelExists(current))) return current;
  return create();
}

/**
 * Crée (ou réutilise) la catégorie + salons vérification & roster, y publie
 * le panneau et le tableau. Renvoie un message récap.
 */
export async function runSetup(guildId: string, botUserId: string): Promise<string> {
  const g = await getGlobalConfig();
  const ow = readOnlyOverwrites(guildId, botUserId);

  const categoryId = await ensureChannel(g.categoryId, () => createCategory(guildId, 'GDKP'));

  const panelChannelId = await ensureChannel(g.panelChannelId, () =>
    createTextChannel(guildId, '✅・vérification', {
      parentId: categoryId,
      topic: 'Lie ton perso pour être vérifié pour le raid GDKP',
      overwrites: ow,
    }),
  );

  const rosterChannelId = await ensureChannel(g.rosterChannelId, () =>
    createTextChannel(guildId, '🏆・roster', {
      parentId: categoryId,
      topic: 'Roster GDKP — mis à jour automatiquement',
      overwrites: ow,
    }),
  );

  // Publie le panneau (remplace l'ancien s'il existe → idempotent).
  if (g.panelMessageId) await deleteMessage(panelChannelId, g.panelMessageId).catch(() => {});
  const panelMessageId = await createMessage(panelChannelId, buildPanelMessage());

  await updateGlobal({ categoryId, panelChannelId, rosterChannelId, panelMessageId });

  // Publie / rafraîchit le tableau.
  await postBoard(rosterChannelId);

  return (
    '✅ **Configuration GDKP prête !**\n' +
    `• Vérification : <#${panelChannelId}>\n` +
    `• Roster : <#${rosterChannelId}>\n` +
    'Les deux salons sont en lecture seule (seul le bot y écrit). Le tableau se met à jour tout seul.'
  );
}
