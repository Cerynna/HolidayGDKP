// Création automatique des rôles et salons GDKP (vérification + roster) et publication.
import { getGuildConfig, updateGuildConfig } from './store';
import {
  createCategory,
  createTextChannel,
  channelExists,
  createMessage,
  createRole,
  editMessage,
  getGuildRoles,
  type PermissionOverwrite,
} from './discord';
import { requiredRoles } from './grades';
import { config as cfg } from './config';
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
 * Crée les rôles de grade / finance / statut absents du serveur, en respectant la
 * casse et la couleur de la config. Les rôles existants ne sont jamais touchés :
 * un serveur qui a déjà ses propres rôles garde les siens.
 */
async function ensureRoles(guildId: string): Promise<string[]> {
  const existing = new Set((await getGuildRoles(guildId)).map((r) => r.name.toLowerCase()));
  const created: string[] = [];
  for (const role of requiredRoles(cfg)) {
    if (existing.has(role.name.toLowerCase())) continue;
    await createRole(guildId, role.name, role.color);
    created.push(role.name);
  }
  return created;
}

/**
 * Republie le panneau à sa place enregistrée : édite le message en place quand il
 * existe encore, le recrée sinon. `fallbackChannelId` ne sert qu'au premier appel,
 * avant qu'un salon de vérification ne soit connu.
 */
export async function refreshPanel(guildId: string, fallbackChannelId?: string): Promise<string> {
  const g = await getGuildConfig(guildId);
  const channelId = g.panelChannelId ?? fallbackChannelId;
  if (!channelId) return '⚠️ Aucun salon de vérification connu. Lance `/setup` d’abord.';

  const message = buildPanelMessage();
  if (g.panelMessageId && g.panelChannelId === channelId) {
    if (await editMessage(channelId, g.panelMessageId, message)) {
      return `✅ Panneau mis à jour dans <#${channelId}>.`;
    }
  }

  const panelMessageId = await createMessage(channelId, message);
  await updateGuildConfig(guildId, { panelChannelId: channelId, panelMessageId });
  return `✅ Panneau publié dans <#${channelId}>.`;
}

/**
 * Crée (ou réutilise) la catégorie + salons vérification & roster, y publie
 * le panneau et le tableau. Renvoie un message récap.
 */
export async function runSetup(guildId: string, botUserId: string): Promise<string> {
  const g = await getGuildConfig(guildId);
  const ow = readOnlyOverwrites(guildId, botUserId);

  const createdRoles = await ensureRoles(guildId);

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

  await updateGuildConfig(guildId, { categoryId, panelChannelId, rosterChannelId });

  // Publie / rafraîchit le panneau et le tableau.
  await refreshPanel(guildId);
  await postBoard(guildId, rosterChannelId);

  return (
    '✅ **Configuration GDKP prête !**\n' +
    `• Vérification : <#${panelChannelId}>\n` +
    `• Roster : <#${rosterChannelId}>\n` +
    (createdRoles.length > 0
      ? `• Rôles créés (${createdRoles.length}) : ${createdRoles.join(', ')}\n`
      : '• Rôles : tous déjà présents\n') +
    'Les deux salons sont en lecture seule (seul le bot y écrit). Le tableau se met à jour tout seul.' +
    (createdRoles.length > 0
      ? '\n\n⚠️ Vérifie que le rôle du bot est **au-dessus** des rôles créés ' +
        '(Paramètres du serveur → Rôles), sinon il ne pourra ni les attribuer ni les colorer.'
      : '')
  );
}
