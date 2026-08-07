// Initialisation de Firebase Admin (Firestore) pour le stockage serveur.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { ServiceAccount } from 'firebase-admin/app';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let db: Firestore | null = null;

/**
 * Retourne l'instance Firestore (initialisée une seule fois).
 *
 * Credentials, par ordre de priorité :
 *  1. FIREBASE_SERVICE_ACCOUNT_PATH -> chemin vers le JSON de compte de service
 *  2. GOOGLE_APPLICATION_CREDENTIALS -> credentials par défaut de Google
 *  3. ./serviceAccount.json à la racine du projet
 */
export function getDb(): Firestore {
  if (db) return db;

  if (!getApps().length) {
    // Une variable d'env vide (FIREBASE_SERVICE_ACCOUNT_PATH=) doit être ignorée.
    const explicitPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim() || '';
    const defaultPath = join(ROOT, 'serviceAccount.json');
    const saPath = explicitPath || defaultPath;

    if (existsSync(saPath)) {
      const sa = JSON.parse(readFileSync(saPath, 'utf8')) as ServiceAccount;
      initializeApp({ credential: cert(sa) });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
      initializeApp({ credential: applicationDefault() });
    } else {
      throw new Error(
        'Credentials Firebase manquants. Fournis un serviceAccount.json à la racine, ' +
          'ou définis FIREBASE_SERVICE_ACCOUNT_PATH / GOOGLE_APPLICATION_CREDENTIALS dans .env.',
      );
    }
  }

  db = getFirestore();
  return db;
}
