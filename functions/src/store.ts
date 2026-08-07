// Persistance Firestore : liens, réclamations de perso, config globale.
import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
import { slugifyServer } from './warcraftlogs';
import { config as cfg } from './config';
import type { Link, GlobalConfig } from './types';

const LINKS = 'discordWowLinks';
const CLAIMS = 'characterClaims';
const GLOBAL_DOC = 'config/global';

function db() {
  if (!getApps().length) initializeApp();
  return getFirestore();
}

/** Clé unique d'un perso (royaume global + nom slugifié). */
function charKey(realm: string, name: string): string {
  return `${slugifyServer(realm)}:${slugifyServer(name)}`;
}

// --- Config globale ---
let globalCache: GlobalConfig | null = null;

export async function getGlobalConfig(): Promise<GlobalConfig> {
  if (globalCache) return globalCache;
  const snap = await db().doc(GLOBAL_DOC).get();
  globalCache = snap.exists ? (snap.data() as GlobalConfig) : {};
  return globalCache;
}

export async function getRealm(): Promise<string> {
  const g = await getGlobalConfig();
  return g.realm || cfg.defaultRealm;
}

export async function setRealm(realm: string): Promise<void> {
  await db().doc(GLOBAL_DOC).set({ realm }, { merge: true });
  globalCache = null;
}

export async function setBoard(channelId: string, messageIds: string[]): Promise<void> {
  await db()
    .doc(GLOBAL_DOC)
    .set({ boardChannelId: channelId, boardMessageIds: messageIds }, { merge: true });
  globalCache = null;
}

export async function updateGlobal(patch: Partial<GlobalConfig>): Promise<void> {
  await db().doc(GLOBAL_DOC).set(patch, { merge: true });
  globalCache = null;
}

// --- Liens ---
export async function getLink(userId: string): Promise<Link | null> {
  const snap = await db().collection(LINKS).doc(userId).get();
  return snap.exists ? (snap.data() as Link) : null;
}

export async function setLink(userId: string, link: Link): Promise<void> {
  await db().collection(LINKS).doc(userId).set(link, { merge: true });
}

export async function allLinks(): Promise<Array<{ userId: string } & Link>> {
  const snap = await db().collection(LINKS).get();
  return snap.docs.map((d) => ({ userId: d.id, ...(d.data() as Link) }));
}

export async function removeLink(userId: string): Promise<boolean> {
  const database = db();
  const linkRef = database.collection(LINKS).doc(userId);
  const snap = await linkRef.get();
  if (!snap.exists) return false;
  const link = snap.data() as Link;
  const realm = await getRealm();
  const batch = database.batch();
  batch.delete(linkRef);
  const claimRef = database.collection(CLAIMS).doc(charKey(realm, link.name));
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
 * @throws ClaimTakenError si un AUTRE membre a déjà ce perso.
 */
export async function claimCharacter(userId: string, name: string, realm: string): Promise<void> {
  const database = db();
  const newRef = database.collection(CLAIMS).doc(charKey(realm, name));
  const linkRef = database.collection(LINKS).doc(userId);

  await database.runTransaction(async (t) => {
    const existing = await t.get(newRef);
    if (existing.exists) {
      const owner = (existing.data() as { userId: string }).userId;
      if (owner !== userId) throw new ClaimTakenError(owner);
    }
    // Libère l'ancien perso du membre s'il change
    const linkSnap = await t.get(linkRef);
    const oldName = linkSnap.exists ? (linkSnap.data() as Link).name : null;
    if (oldName && slugifyServer(oldName) !== slugifyServer(name)) {
      const oldRef = database.collection(CLAIMS).doc(charKey(realm, oldName));
      const oldSnap = await t.get(oldRef);
      if (oldSnap.exists && (oldSnap.data() as { userId: string }).userId === userId) {
        t.delete(oldRef);
      }
    }
    t.set(newRef, { userId, name, realm });
  });
}
