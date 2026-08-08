// Création automatique des rôles et salons GDKP (vérification + roster) et publication.
import { getGuildConfig, updateGuildConfig } from './store';
import {
  createChannel,
  ChannelType,
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
const ADMINISTRATOR = 8;

/** Salon en lecture seule : membres voient mais n'écrivent pas ; le bot écrit. */
function readOnlyOverwrites(guildId: string, botUserId: string): PermissionOverwrite[] {
  return [
    { id: guildId, type: 0, deny: String(SEND) }, // @everyone : pas d'écriture
    { id: botUserId, type: 1, allow: String(VIEW | SEND | EMBED) }, // le bot : tout
  ];
}

/** Annonces : tout le monde voit, seuls les organisateurs écrivent. */
function announceOverwrites(guildId: string, botUserId: string, orgaRoleId: string): PermissionOverwrite[] {
  return [
    { id: guildId, type: 0, deny: String(SEND) }, // @everyone : lecture seule
    { id: orgaRoleId, type: 0, allow: String(VIEW | SEND | EMBED) }, // orga : écrit
    { id: botUserId, type: 1, allow: String(VIEW | SEND | EMBED) },
  ];
}

/** Salon privé Organisation : seuls les organisateurs (et le bot) le voient. */
function orgaOnlyOverwrites(guildId: string, botUserId: string, orgaRoleId: string): PermissionOverwrite[] {
  return [
    { id: guildId, type: 0, deny: String(VIEW) }, // @everyone : invisible
    { id: orgaRoleId, type: 0, allow: String(VIEW | SEND | EMBED) },
    { id: botUserId, type: 1, allow: String(VIEW | SEND | EMBED) },
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
    await createRole(guildId, role.name, { color: role.color });
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

/** Crée (ou réutilise) le rôle Organisation (admin). Renvoie son id. */
async function ensureOrganisationRole(guildId: string): Promise<string> {
  const existing = (await getGuildRoles(guildId)).find(
    (r) => r.name.toLowerCase() === 'organisation',
  );
  if (existing) return existing.id;
  const role = await createRole(guildId, 'Organisation', {
    permissions: String(ADMINISTRATOR),
    hoist: true,
  });
  return role.id;
}

/**
 * Crée (ou réutilise) tous les salons + rôles GDKP (sans catégorie), publie le
 * panneau et le tableau. Renvoie un message récap.
 */
export async function runSetup(guildId: string, botUserId: string): Promise<string> {
  const g = await getGuildConfig(guildId);
  const readOnly = readOnlyOverwrites(guildId, botUserId);

  const createdRoles = await ensureRoles(guildId);
  const orgaRoleId = await ensureOrganisationRole(guildId);

  // Salons texte (sans catégorie)
  const panelChannelId = await ensureChannel(g.panelChannelId, () =>
    createChannel(guildId, {
      name: '✅・vérification',
      type: ChannelType.TEXT,
      topic: 'Lie ton perso pour être vérifié pour le raid GDKP',
      overwrites: readOnly,
    }),
  );
  const rosterChannelId = await ensureChannel(g.rosterChannelId, () =>
    createChannel(guildId, {
      name: '🏆・roster',
      type: ChannelType.TEXT,
      topic: 'Roster GDKP — mis à jour automatiquement',
      overwrites: readOnly,
    }),
  );
  const annonceChannelId = await ensureChannel(g.annonceChannelId, () =>
    createChannel(guildId, {
      name: '📢・annonces',
      type: ChannelType.TEXT,
      topic: 'Annonces — seuls les organisateurs écrivent',
      overwrites: announceOverwrites(guildId, botUserId, orgaRoleId),
    }),
  );
  const orgaChannelId = await ensureChannel(g.orgaChannelId, () =>
    createChannel(guildId, {
      name: '🔒・organisation',
      type: ChannelType.TEXT,
      topic: 'Salon privé des organisateurs',
      overwrites: orgaOnlyOverwrites(guildId, botUserId, orgaRoleId),
    }),
  );

  // Salons vocaux
  const raidVoiceId = await ensureChannel(g.raidVoiceId, () =>
    createChannel(guildId, { name: '🔥 Raid', type: ChannelType.VOICE }),
  );
  const debriefVoiceId = await ensureChannel(g.debriefVoiceId, () =>
    createChannel(guildId, { name: '📈 Debrief', type: ChannelType.VOICE }),
  );

  // Forum (nécessite un serveur Communauté) — échec non bloquant.
  let eventsChannelId = g.eventsChannelId;
  let forumNote = '';
  if (!(eventsChannelId && (await channelExists(eventsChannelId)))) {
    try {
      eventsChannelId = await createChannel(guildId, {
        name: '📅・les-events',
        type: ChannelType.FORUM,
      });
    } catch {
      eventsChannelId = undefined;
      forumNote =
        '\n⚠️ Le salon forum **📅 les events** n’a pas pu être créé : active d’abord le mode ' +
        '**Communauté** sur le serveur (Paramètres → Activer la communauté), puis relance `/setup`.';
    }
  }

  await updateGuildConfig(guildId, {
    panelChannelId,
    rosterChannelId,
    annonceChannelId,
    orgaChannelId,
    raidVoiceId,
    debriefVoiceId,
    eventsChannelId,
    organisationRoleId: orgaRoleId,
  });

  await refreshPanel(guildId);
  await postBoard(guildId, rosterChannelId);

  const lines = [
    '✅ **Configuration GDKP prête !**',
    `• Vérification : <#${panelChannelId}>`,
    `• Roster : <#${rosterChannelId}>`,
    `• Annonces : <#${annonceChannelId}>`,
    `• Organisation (privé) : <#${orgaChannelId}>`,
    eventsChannelId ? `• Events : <#${eventsChannelId}>` : null,
    `• Vocaux : 🔥 Raid · 📈 Debrief`,
    `• Rôle **Organisation** ${createdRoles.length ? '' : ''}créé/vérifié`,
    createdRoles.length ? `• Rôles de grade créés (${createdRoles.length})` : '• Rôles de grade : déjà présents',
  ].filter(Boolean);

  return (
    lines.join('\n') +
    forumNote +
    '\n\n⚠️ Vérifie que le rôle du bot est **au-dessus** des rôles créés (Paramètres → Rôles).'
  );
}
