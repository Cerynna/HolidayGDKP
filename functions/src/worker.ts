// Traitement asynchrone d'un job : WCL + rôles, puis édition de la réponse différée.
import { setLink } from './store';
import { runGrade, runRefresh } from './service';
import { postBoard, updateBoard } from './board';
import { runSetup } from './setup';
import { editOriginalResponse, type MessagePayload } from './discord';
import type { PendingJob } from './types';

export async function processJob(job: PendingJob): Promise<void> {
  // Rafraîchissement silencieux du tableau (ex: après /unlink) — pas de réponse à éditer.
  if (job.kind === 'refreshBoard') {
    await updateBoard(job.guildId).catch(() => {});
    return;
  }

  let payload: MessagePayload;
  try {
    if (job.kind === 'link') {
      await setLink(job.guildId, job.userId, {
        name: job.name!,
        wclMetric: job.wclMetric ?? 'auto',
        gold: job.gold ?? 0,
        claimedAt: Date.now(),
      });
      payload = await runGrade(job.guildId, job.userId);
    } else if (job.kind === 'grade') {
      payload = await runGrade(job.guildId, job.targetUserId ?? job.userId);
    } else if (job.kind === 'refresh') {
      payload = await runRefresh(job.guildId);
    } else if (job.kind === 'board') {
      if (job.channelId) {
        await postBoard(job.guildId, job.channelId);
        payload = { content: '✅ Tableau du roster posté (il se mettra à jour automatiquement).' };
      } else {
        payload = { content: '⚠️ Salon introuvable pour poster le tableau.' };
      }
    } else if (job.kind === 'setup') {
      payload = { content: await runSetup(job.guildId, job.applicationId) };
    } else {
      payload = { content: 'Job inconnu.' };
    }
  } catch (e) {
    payload = { content: `⚠️ Erreur : ${(e as Error).message}` };
  }
  await editOriginalResponse(job.applicationId, job.token, payload);
}
