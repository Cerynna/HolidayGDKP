// Traitement asynchrone d'un job : WCL + rôles, puis édition de la réponse différée.
import { setLink } from './store';
import { runGrade, runRefresh } from './service';
import { postBoard, updateBoard } from './board';
import { runSetup } from './setup';
import { editOriginalResponse } from './discord';
import type { PendingJob } from './types';

export async function processJob(job: PendingJob): Promise<void> {
  // Rafraîchissement silencieux du tableau (ex: après /unlink) — pas de réponse à éditer.
  if (job.kind === 'refreshBoard') {
    await updateBoard(job.guildId).catch(() => {});
    return;
  }

  let content: string;
  try {
    if (job.kind === 'link') {
      await setLink(job.guildId, job.userId, {
        name: job.name!,
        wclMetric: job.wclMetric ?? 'auto',
        gold: job.gold ?? 0,
        claimedAt: Date.now(),
      });
      content = await runGrade(job.guildId, job.userId);
    } else if (job.kind === 'grade') {
      content = await runGrade(job.guildId, job.targetUserId ?? job.userId);
    } else if (job.kind === 'refresh') {
      content = await runRefresh(job.guildId);
    } else if (job.kind === 'board') {
      if (job.channelId) {
        await postBoard(job.guildId, job.channelId);
        content = '✅ Tableau du roster posté (il se mettra à jour automatiquement).';
      } else {
        content = '⚠️ Salon introuvable pour poster le tableau.';
      }
    } else if (job.kind === 'setup') {
      content = await runSetup(job.guildId, job.applicationId);
    } else {
      content = 'Job inconnu.';
    }
  } catch (e) {
    content = `⚠️ Erreur : ${(e as Error).message}`;
  }
  await editOriginalResponse(job.applicationId, job.token, content);
}
