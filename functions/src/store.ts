// Persistance Firestore scopée par guilde : liens, réclamations de perso, config.
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
import { slugifyServer } from './warcraftlogs';
import { config as cfg } from './config';
import type { Link, GuildConfig } from './types';

const GUILDS = 'guilds';
const LINKS = 'links';
const CLAIMS = 'claims';

function db(): Firestore {
  if (!getApps().length) initializeApp();
  return getFirestore();
}

function guildDoc(guildId: string) {
  return db().collection(GUILDS).doc(guildId);
}

function linksCol(guildId: string) {
  return guildDoc(guildId).collection(LINKS);
}

function claimsCol(guildId: string) {
  return guildDoc(guildId).collection(CLAIMS);
}

/** Clé unique d'un perso au sein d'une guilde (royaume + nom slugifiés). */
function charKey(realm: string, name: string): string {
  return `${slugifyServer(realm)}:${slugifyServer(name)}`;
}

// --- Config de guilde ---
const configCache = new Map<string, GuildConfig>();

export async function getGuildConfig(guildId: string): Promise<GuildConfig> {
  const cached = configCache.get(guildId);
  if (cached) return cached;
  const snap = await guildDoc(guildId).get();
  const conf = snap.exists ? (snap.data() as GuildConfig) : {};
  configCache.set(guildId, conf);
  return conf;
}

export async function updateGuildConfig(guildId: string, patch: Partial<GuildConfig>): Promise<void> {
  await guildDoc(guildId).set(patch, { merge: true });
  configCache.delete(guildId);
}

export async function getRealm(guildId: string): Promise<string> {
  const g = await getGuildConfig(guildId);
  return g.realm || cfg.defaultRealm;
}

export async function setRealm(guildId: string, realm: string): Promise<void> {
  await updateGuildConfig(guildId, { realm });
}

export async function setBoard(
  guildId: string,
  channelId: string,
  messageIds: string[],
): Promise<void> {
  await updateGuildConfig(guildId, { boardChannelId: channelId, boardMessageIds: messageIds });
}

// --- Liens ---
export async function getLink(guildId: string, userId: string): Promise<Link | null> {
  const snap = await linksCol(guildId).doc(userId).get();
  return snap.exists ? (snap.data() as Link) : null;
}

export async function setLink(guildId: string, userId: string, link: Link): Promise<void> {
  await linksCol(guildId).doc(userId).set(link, { merge: true });
}

export async function allLinks(guildId: string): Promise<Array<{ userId: string } & Link>> {
  const snap = await linksCol(guildId).get();
  return snap.docs.map((d) => ({ userId: d.id, ...(d.data() as Link) }));
}

export async function removeLink(guildId: string, userId: string): Promise<boolean> {
  const linkRef = linksCol(guildId).doc(userId);
  const snap = await linkRef.get();
  if (!snap.exists) return false;
  const link = snap.data() as Link;
  const realm = await getRealm(guildId);
  const batch = db().batch();
  batch.delete(linkRef);
  const claimRef = claimsCol(guildId).doc(charKey(realm, link.name));
  const claimSnap = await claimRef.get();
  if (claimSnap.exists && (claimSnap.data() as { userId: string }).userId === userId) {
    batch.delete(claimRef);
  }
  await batch.commit();
  return true;
}

export class ClaimTakenError extends Error {
  constructor(public byUserId: string) {
    super('Perso déjà réclamé');
  }
}

/**
 * Réclame un perso pour un membre (anti-reclaim). Libère l'ancien perso du membre.
 * @throws ClaimTakenError si un AUTRE membre de la guilde a déjà ce perso.
 */
export async function claimCharacter(
  guildId: string,
  userId: string,
  name: string,
  realm: string,
): Promise<void> {
  const claims = claimsCol(guildId);
  const newRef = claims.doc(charKey(realm, name));
  const linkRef = linksCol(guildId).doc(userId);

  await db().runTransaction(async (t) => {
    const existing = await t.get(newRef);
    if (existing.exists) {
      const owner = (existing.data() as { userId: string }).userId;
      if (owner !== userId) throw new ClaimTakenError(owner);
    }
    // Libère l'ancien perso du membre s'il change
    const linkSnap = await t.get(linkRef);
    const oldName = linkSnap.exists ? (linkSnap.data() as Link).name : null;
    if (oldName && slugifyServer(oldName) !== slugifyServer(name)) {
      const oldRef = claims.doc(charKey(realm, oldName));
      const oldSnap = await t.get(oldRef);
      if (oldSnap.exists && (oldSnap.data() as { userId: string }).userId === userId) {
        t.delete(oldRef);
      }
    }
    t.set(newRef, { userId, name, realm });
  });
}
