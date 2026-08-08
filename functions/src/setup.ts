// Création automatique des rôles et salons GDKP (vérification + roster) et publication.
import { getGuildConfig, updateGuildConfig } from './store';
import {
  createChannel,
  ChannelType,
  channelExists,
  setChannelOverwrites,
  createMessage,
  createRole,
  setRoleHoist,
  editMessage,
  getGuildRoles,
  type PermissionOverwrite,
} from './discord';
import { requiredRoles } from './grades';
import { config as cfg } from './config';
import { buildPanelMessage } from './panel';
import { postBoard } from './board';

// Permissions Discord (BigInt : certains bits dépassent 2^31).
const VIEW = 1n << 10n; // Voir le salon
const SEND = 1n << 11n; // Envoyer des messages
const EMBED = 1n << 14n; // Intégrer des liens
const CONNECT = 1n << 20n; // Se connecter (vocal)
const SPEAK = 1n << 21n; // Parler
const USE_VAD = 1n << 25n; // Détection de voix (refusé = push-to-talk forcé)
const USE_SOUNDBOARD = 1n << 42n; // Soundboard
const USE_EXTERNAL_SOUNDS = 1n << 45n; // Sons externes
const ADMINISTRATOR = 1n << 3n; // 8

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

/** Réservé aux raideurs éligibles (Valid + Caddie) : events + vocaux. */
function eligibleOverwrites(
  guildId: string,
  botUserId: string,
  roleIds: Array<string | undefined>,
): PermissionOverwrite[] {
  const ow: PermissionOverwrite[] = [
    { id: guildId, type: 0, deny: String(VIEW | CONNECT) }, // @everyone : invisible + pas de connexion
    { id: botUserId, type: 1, allow: String(VIEW | SEND | EMBED | CONNECT) },
  ];
  for (const id of roleIds) {
    if (id) ow.push({ id, type: 0, allow: String(VIEW | SEND | CONNECT) });
  }
  return ow;
}

/** Vocal du raid : réservé Valid/Caddie, push-to-talk forcé + soundboard interdit ;
 * les organisateurs sont exemptés (voix libre + soundboard). */
function raidVoiceOverwrites(
  guildId: string,
  botUserId: string,
  orgaRoleId: string,
  roleIds: Array<string | undefined>,
): PermissionOverwrite[] {
  const denyEligible = String(USE_VAD | USE_SOUNDBOARD | USE_EXTERNAL_SOUNDS);
  const ow: PermissionOverwrite[] = [
    { id: guildId, type: 0, deny: String(VIEW | CONNECT) },
    { id: botUserId, type: 1, allow: String(VIEW | CONNECT) },
    { id: orgaRoleId, type: 0, allow: String(VIEW | CONNECT | SPEAK | USE_VAD | USE_SOUNDBOARD) },
  ];
  for (const id of roleIds) {
    if (id) ow.push({ id, type: 0, allow: String(VIEW | CONNECT | SPEAK), deny: denyEligible });
  }
  return ow;
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
  const byName = new Map((await getGuildRoles(guildId)).map((r) => [r.name.toLowerCase(), r]));
  const created: string[] = [];
  for (const role of requiredRoles(cfg)) {
    // Seuls les grades de parse ont une couleur -> ce sont eux qu'on hoiste.
    const isParseGrade = Boolean(role.color);
    const existing = byName.get(role.name.toLowerCase());
    if (existing) {
      // Seuls les grades de parse sont hoistés ; les autres (finance, Valid, Caddie)
      // sont explicitement dé-hoistés pour un regroupement propre par parse.
      await setRoleHoist(guildId, existing.id, isParseGrade).catch(() => {});
      continue;
    }
    await createRole(guildId, role.name, { color: role.color, hoist: isParseGrade });
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

  // IDs des rôles d'éligibilité (pour le forum des events).
  const roleId = new Map((await getGuildRoles(guildId)).map((r) => [r.name.toLowerCase(), r.id]));
  const validRoleId = cfg.raidAccess ? roleId.get(cfg.raidAccess.role.toLowerCase()) : undefined;
  const caddieRoleId = roleId.get(cfg.caddie.role.toLowerCase());
  const eligibleOw = eligibleOverwrites(guildId, botUserId, [validRoleId, caddieRoleId]);
  const raidOw = raidVoiceOverwrites(guildId, botUserId, orgaRoleId, [validRoleId, caddieRoleId]);

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
      topic: 'Roster GDKP — réservé aux organisateurs',
      overwrites: orgaOnlyOverwrites(guildId, botUserId, orgaRoleId),
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
  const reportsChannelId = await ensureChannel(g.reportsChannelId, () =>
    createChannel(guildId, {
      name: '💰・rapports-de-raid',
      type: ChannelType.TEXT,
      topic: 'Répartition du pot GDKP — les organisateurs lancent /rapport ici',
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

  // Salons vocaux (réservés Valid + Caddie)
  const raidVoiceId = await ensureChannel(g.raidVoiceId, () =>
    createChannel(guildId, { name: '🔥 Raid', type: ChannelType.VOICE, overwrites: raidOw }),
  );
  const debriefVoiceId = await ensureChannel(g.debriefVoiceId, () =>
    createChannel(guildId, { name: '📈 Debrief', type: ChannelType.VOICE, overwrites: eligibleOw }),
  );

  // Forum (nécessite un serveur Communauté) — échec non bloquant.
  let eventsChannelId = g.eventsChannelId;
  let forumNote = '';
  if (!(eventsChannelId && (await channelExists(eventsChannelId)))) {
    try {
      eventsChannelId = await createChannel(guildId, {
        name: '📅・les-events',
        type: ChannelType.FORUM,
        overwrites: eligibleOw,
      });
    } catch {
      eventsChannelId = undefined;
      forumNote =
        '\n⚠️ Le salon forum **📅 les events** n’a pas pu être créé : active d’abord le mode ' +
        '**Communauté** sur le serveur (Paramètres → Activer la communauté), puis relance `/setup`.';
    }
  }

  // Réapplique les permissions (corrige aussi les salons déjà existants).
  await setChannelOverwrites(rosterChannelId, orgaOnlyOverwrites(guildId, botUserId, orgaRoleId)).catch(() => {});
  await setChannelOverwrites(annonceChannelId, announceOverwrites(guildId, botUserId, orgaRoleId)).catch(() => {});
  await setChannelOverwrites(reportsChannelId, announceOverwrites(guildId, botUserId, orgaRoleId)).catch(() => {});
  await setChannelOverwrites(orgaChannelId, orgaOnlyOverwrites(guildId, botUserId, orgaRoleId)).catch(() => {});
  await setChannelOverwrites(raidVoiceId, raidOw).catch(() => {});
  await setChannelOverwrites(debriefVoiceId, eligibleOw).catch(() => {});
  if (eventsChannelId) await setChannelOverwrites(eventsChannelId, eligibleOw).catch(() => {});

  await updateGuildConfig(guildId, {
    panelChannelId,
    rosterChannelId,
    annonceChannelId,
    reportsChannelId,
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
    `• Rapports de raid : <#${reportsChannelId}>`,
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
