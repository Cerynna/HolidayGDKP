// Appels REST à l'API Discord (sans discord.js) + constantes d'interactions.
const API = 'https://discord.com/api/v10';

// Types d'interactions entrantes
export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  MODAL_SUBMIT: 5,
} as const;

// Types de réponses
export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4, // message immédiat
  DEFERRED_CHANNEL_MESSAGE: 5, // "⏳ en cours", suivi d'un followup
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  MODAL: 9,
} as const;

export const EPHEMERAL = 1 << 6; // flag message éphémère (64)

// Composants
export const ComponentType = {
  ACTION_ROW: 1,
  BUTTON: 2,
  STRING_SELECT: 3,
  TEXT_INPUT: 4,
} as const;

export interface DiscordRole {
  id: string;
  name: string;
  color: number;
  position: number;
}

function authHeaders(): Record<string, string> {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error('DISCORD_TOKEN manquant');
  return { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' };
}

async function rest(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: authHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => '');
    throw new Error(`Discord ${method} ${path} → ${res.status} ${text}`);
  }
  return res;
}

export async function getGuildRoles(guildId: string): Promise<DiscordRole[]> {
  const res = await rest('GET', `/guilds/${guildId}/roles`);
  return (await res.json()) as DiscordRole[];
}

export interface MemberInfo {
  roles: string[];
  nick: string | null;
  username: string;
  globalName: string | null;
}

/** Infos d'un membre (rôles + pseudo). Renvoie null si absent du serveur. */
export async function getMember(guildId: string, userId: string): Promise<MemberInfo | null> {
  const res = await fetch(`${API}/guilds/${guildId}/members/${userId}`, { headers: authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Discord GET member → ${res.status}`);
  const m = (await res.json()) as {
    roles: string[];
    nick?: string | null;
    user: { username: string; global_name?: string | null };
  };
  return {
    roles: m.roles,
    nick: m.nick ?? null,
    username: m.user.username,
    globalName: m.user.global_name ?? null,
  };
}

/** Modifie le pseudo d'un membre. Non bloquant (owner / rôle plus haut = ignoré). */
export async function setNickname(guildId: string, userId: string, nick: string): Promise<void> {
  const r = await fetch(`${API}/guilds/${guildId}/members/${userId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ nick }),
  });
  if (!r.ok && r.status !== 403) {
    // 403 = impossible (owner/hiérarchie) : on ignore
    const t = await r.text().catch(() => '');
    throw new Error(`Discord set nick → ${r.status} ${t}`);
  }
}

export async function addMemberRole(guildId: string, userId: string, roleId: string): Promise<void> {
  await rest('PUT', `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
}

export async function removeMemberRole(
  guildId: string,
  userId: string,
  roleId: string,
): Promise<void> {
  await rest('DELETE', `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
}

export async function setRoleColor(guildId: string, roleId: string, hex: string): Promise<void> {
  const color = parseInt(hex.replace('#', ''), 16);
  await rest('PATCH', `/guilds/${guildId}/roles/${roleId}`, { color });
}

/** Édite la réponse différée (followup) — token valide 15 min. */
export async function editOriginalResponse(
  applicationId: string,
  token: string,
  content: string,
): Promise<void> {
  await rest('PATCH', `/webhooks/${applicationId}/${token}/messages/@original`, { content });
}

export interface MessagePayload {
  content?: string;
  embeds?: unknown[];
  components?: unknown[];
}

/** Poste un message dans un salon, renvoie son id. */
export async function createMessage(channelId: string, payload: MessagePayload): Promise<string> {
  const res = await rest('POST', `/channels/${channelId}/messages`, {
    ...payload,
    allowed_mentions: { parse: [] }, // n'envoie pas de ping
  });
  const msg = (await res.json()) as { id: string };
  return msg.id;
}

/** Édite un message existant. Renvoie false si le message n'existe plus. */
export async function editMessage(
  channelId: string,
  messageId: string,
  payload: MessagePayload,
): Promise<boolean> {
  const r = await fetch(`${API}/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
  });
  if (r.status === 404) return false;
  if (!r.ok) throw new Error(`Discord PATCH message → ${r.status}`);
  return true;
}

export interface PermissionOverwrite {
  id: string;
  type: 0 | 1; // 0 = rôle, 1 = membre
  allow?: string;
  deny?: string;
}

/** Crée un salon texte, renvoie son id. */
export async function createTextChannel(
  guildId: string,
  name: string,
  opts: { parentId?: string; topic?: string; overwrites?: PermissionOverwrite[] } = {},
): Promise<string> {
  const res = await rest('POST', `/guilds/${guildId}/channels`, {
    name,
    type: 0,
    parent_id: opts.parentId,
    topic: opts.topic,
    permission_overwrites: opts.overwrites,
  });
  const ch = (await res.json()) as { id: string };
  return ch.id;
}

/** Crée une catégorie, renvoie son id. */
export async function createCategory(guildId: string, name: string): Promise<string> {
  const res = await rest('POST', `/guilds/${guildId}/channels`, { name, type: 4 });
  const ch = (await res.json()) as { id: string };
  return ch.id;
}

/** Vérifie si un salon existe encore. */
export async function channelExists(channelId: string): Promise<boolean> {
  const r = await fetch(`${API}/channels/${channelId}`, { headers: authHeaders() });
  return r.ok;
}

/** Supprime un message (ignore 404). */
export async function deleteMessage(channelId: string, messageId: string): Promise<void> {
  const r = await fetch(`${API}/channels/${channelId}/messages/${messageId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!r.ok && r.status !== 404) throw new Error(`Discord DELETE message → ${r.status}`);
}
