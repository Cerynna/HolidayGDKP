// Dépôt d'un job asynchrone dans Firestore (déclenche le worker).
import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
import type { PendingJob } from './types';

export const JOBS_COLLECTION = 'pendingInteractions';

export async function enqueue(job: PendingJob): Promise<void> {
  if (!getApps().length) initializeApp();
  await getFirestore()
    .collection(JOBS_COLLECTION)
    .add({ ...job, createdAt: Date.now() });
}
