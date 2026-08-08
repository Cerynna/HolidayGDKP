// Points d'entrée Cloud Functions : endpoint d'interactions + worker Firestore.
import { initializeApp, getApps } from 'firebase-admin/app';
import { onRequest } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';

// Initialise firebase-admin une fois, au chargement du module (avant tout handler).
if (!getApps().length) initializeApp();
import { verifyRequest } from './verify';
import { handleInteraction } from './interactions';
import { processJob } from './worker';
import { enqueue, JOBS_COLLECTION } from './jobs';
import type { PendingJob } from './types';

const DISCORD_PUBLIC_KEY = defineSecret('DISCORD_PUBLIC_KEY');
const DISCORD_TOKEN = defineSecret('DISCORD_TOKEN');
const WCL_CLIENT_ID = defineSecret('WCL_CLIENT_ID');
const WCL_CLIENT_SECRET = defineSecret('WCL_CLIENT_SECRET');

const REGION = 'europe-west1';

// Endpoint appelé par Discord à chaque interaction.
export const interactions = onRequest(
  { region: REGION, secrets: [DISCORD_PUBLIC_KEY] },
  async (req, res) => {
    const signature = req.get('X-Signature-Ed25519') ?? undefined;
    const timestamp = req.get('X-Signature-Timestamp') ?? undefined;
    const raw = (req as unknown as { rawBody: Buffer }).rawBody;

    if (!verifyRequest(raw, signature, timestamp, process.env.DISCORD_PUBLIC_KEY)) {
      res.status(401).send('invalid request signature');
      return;
    }

    const body = JSON.parse(raw.toString('utf8'));

    // --- Webhook Events (auto-setup à l'arrivée sur un serveur) ---
    // PING des webhook events (type 0) : accuse réception.
    if (body.type === 0) {
      res.status(204).end();
      return;
    }
    // Événement (type 1 avec `event`) : APPLICATION_AUTHORIZED = bot ajouté à une guilde.
    if (body.type === 1 && body.event) {
      const ev = body.event;
      if (ev.type === 'APPLICATION_AUTHORIZED' && ev.data?.guild?.id) {
        await enqueue({
          kind: 'setup',
          applicationId: body.application_id,
          token: 'auto',
          guildId: ev.data.guild.id,
          userId: ev.data.user?.id ?? '',
        }).catch(() => {});
      }
      res.status(204).end();
      return;
    }

    // --- Interactions ---
    if (body.type === 1) {
      res.json({ type: 1 }); // PONG
      return;
    }

    try {
      const response = await handleInteraction(body);
      res.json(response);
    } catch (err) {
      console.error('handleInteraction error', err);
      res.json({ type: 4, data: { flags: 1 << 6, content: `⚠️ Erreur : ${(err as Error).message}` } });
    }
  },
);

// Worker déclenché à la création d'un job dans Firestore.
export const worker = onDocumentCreated(
  {
    document: `${JOBS_COLLECTION}/{id}`,
    region: REGION,
    secrets: [DISCORD_TOKEN, WCL_CLIENT_ID, WCL_CLIENT_SECRET],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const job = snap.data() as PendingJob;
    try {
      await processJob(job);
    } finally {
      await snap.ref.delete();
    }
  },
);
