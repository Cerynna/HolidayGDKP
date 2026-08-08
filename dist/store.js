// Persistance des liens membre Discord -> perso WoW, sur Firestore.
// L'interface (getLink/setLink/removeLink/allLinks) est inchangée : le reste
// du bot ne sait pas quel backend est utilisé.
import { getDb } from './firebase.js';
const COLLECTION = process.env.FIREBASE_COLLECTION || 'discordWowLinks';
function col() {
    return getDb().collection(COLLECTION);
}
export async function getLink(userId) {
    const snap = await col().doc(userId).get();
    return snap.exists ? snap.data() : null;
}
export async function setLink(userId, link) {
    await col().doc(userId).set(link);
}
export async function removeLink(userId) {
    const ref = col().doc(userId);
    const snap = await ref.get();
    const existed = snap.exists;
    if (existed)
        await ref.delete();
    return existed;
}
export async function allLinks() {
    const snap = await col().get();
    return snap.docs.map((d) => ({ userId: d.id, ...d.data() }));
}
//# sourceMappingURL=store.js.map