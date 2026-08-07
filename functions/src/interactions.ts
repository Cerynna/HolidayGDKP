// Routage des interactions entrantes -> réponse immédiate et/ou mise en file.
import {
  getLink,
  setLink,
  removeLink,
  getRealm,
  setRealm,
  claimCharacter,
  ClaimTakenError,
} from './store';
import { enqueue } from './jobs';
import { normalizeRole, parseGold } from './service';
import { InteractionType, InteractionResponseType, EPHEMERAL } from './discord';
import {
  buildRoleSelectResponse,
  buildLinkModalResponse,
  buildReevalModalResponse,
  LINK_BUTTON_ID,
  REEVAL_BUTTON_ID,
  ROLE_SELECT_ID,
  LINK_MODAL_PREFIX,
  REEVAL_MODAL_ID,
} from './panel';
import { fmtGold, buildSummaryEmbed } from './format';
import type { Link, WclMetric } from './types';

const MANAGE_ROLES = 1n << 28n;
const MANAGE_GUILD = 1n << 5n;

interface Interaction {
  type: number;
  application_id: string;
  token: string;
  guild_id?: string;
  channel_id?: string;
  member?: { user: { id: string }; permissions?: string; roles?: string[] };
  data?: any;
}

/** Interaction émise depuis un serveur : `guild_id` et `member` sont garantis. */
type GuildInteraction = Interaction & {
  guild_id: string;
  member: NonNullable<Interaction['member']>;
};

function ephemeral(content: string): unknown {
  return { type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { flags: EPHEMERAL, content } };
}
function ephemeralEmbed(embed: unknown): unknown {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: EPHEMERAL, embeds: [embed] },
  };
}
function deferredEphemeral(): unknown {
  return { type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL } };
}
function getOption(interaction: Interaction, name: string): string | undefined {
  return (interaction.data?.options ?? []).find((o: any) => o.name === name)?.value;
}
function hasPerm(interaction: GuildInteraction, perm: bigint): boolean {
  try {
    return (BigInt(interaction.member.permissions ?? '0') & perm) !== 0n;
  } catch {
    return false;
  }
}

export async function handleInteraction(interaction: Interaction): Promise<unknown> {
  if (!interaction.guild_id || !interaction.member) {
    return ephemeral("ℹ️ Ce bot s'utilise depuis un serveur, pas en message privé.");
  }
  const inGuild = interaction as GuildInteraction;

  switch (inGuild.type) {
    case InteractionType.APPLICATION_COMMAND:
      return handleCommand(inGuild);
    case InteractionType.MESSAGE_COMPONENT:
      return handleComponent(inGuild);
    case InteractionType.MODAL_SUBMIT:
      return handleModal(inGuild);
    default:
      return ephemeral('Interaction non gérée.');
  }
}

/** Réclame le perso puis met le job de liaison en file. Renvoie la réponse. */
async function startLink(
  interaction: GuildInteraction,
  name: string,
  gold: number,
  wclMetric: WclMetric,
): Promise<unknown> {
  const guildId = interaction.guild_id;
  const userId = interaction.member.user.id;
  const realm = await getRealm(guildId);
  try {
    await claimCharacter(guildId, userId, name, realm);
  } catch (e) {
    if (e instanceof ClaimTakenError) {
      return ephemeral(
        `❌ Le perso **${name}-${realm}** est déjà lié par <@${e.byUserId}>. Un perso ne peut pas être réclamé deux fois.`,
      );
    }
    throw e;
  }
  await enqueue({
    kind: 'link',
    applicationId: interaction.application_id,
    token: interaction.token,
    guildId,
    userId,
    name,
    gold,
    wclMetric,
  });
  return deferredEphemeral();
}

/**
 * Fiche du perso lié. Le résumé du dernier calcul suffit : pas d'appel WCL,
 * la commande doit répondre dans les 3 s imposées par Discord.
 */
function buildWhoamiEmbed(link: Link, realm: string): unknown {
  const s = link.summary;
  if (!s) {
    return {
      color: 0x999999,
      title: `🔗 ${link.name}-${realm}`,
      description:
        `Rôle déclaré : **${link.wclMetric ?? 'auto'}** · Or : **${fmtGold(link.gold ?? 0)} PO**\n\n` +
        '⏳ Pas encore analysé — lance `/grade` ou le bouton **🔄 Réévaluer**.',
    };
  }

  return buildSummaryEmbed(s, realm);
}

async function handleCommand(interaction: GuildInteraction): Promise<unknown> {
  const name = interaction.data.name as string;
  const guildId = interaction.guild_id;
  const userId = interaction.member.user.id;

  switch (name) {
    case 'panneau': {
      if (!hasPerm(interaction, MANAGE_ROLES)) return ephemeral('❌ Réservé aux gestionnaires de rôles.');
      await enqueue({
        kind: 'panel',
        applicationId: interaction.application_id,
        token: interaction.token,
        guildId,
        userId,
        channelId: interaction.channel_id,
      });
      return deferredEphemeral();
    }

    case 'whoami': {
      const link = await getLink(guildId, userId);
      if (!link) return ephemeral("ℹ️ Aucun perso lié. Utilise le bouton **📝 Postuler** ou `/link`.");
      return ephemeralEmbed(buildWhoamiEmbed(link, await getRealm(guildId)));
    }

    case 'unlink': {
      const existed = await removeLink(guildId, userId);
      if (existed) {
        // Rafraîchit le tableau en arrière-plan (perso retiré).
        await enqueue({
          kind: 'refreshBoard',
          applicationId: interaction.application_id,
          token: interaction.token,
          guildId,
          userId,
        });
      }
      return ephemeral(existed ? '✅ Lien supprimé (perso libéré).' : "ℹ️ Tu n'avais aucun perso lié.");
    }

    case 'link': {
      const perso = getOption(interaction, 'perso')!;
      const gold = parseGold(getOption(interaction, 'or'));
      const wclMetric = (getOption(interaction, 'role') ?? 'auto') as WclMetric;
      return startLink(interaction, perso, gold, wclMetric);
    }

    case 'grade': {
      const target = getOption(interaction, 'membre');
      const isOther = Boolean(target && target !== userId);
      if (isOther && !hasPerm(interaction, MANAGE_ROLES)) {
        return ephemeral("❌ Tu n'as pas la permission de mettre à jour le grade d'un autre membre.");
      }
      await enqueue({
        kind: 'grade',
        applicationId: interaction.application_id,
        token: interaction.token,
        guildId,
        userId,
        targetUserId: (target as string) ?? userId,
      });
      return deferredEphemeral();
    }

    case 'refresh': {
      if (!hasPerm(interaction, MANAGE_ROLES)) return ephemeral('❌ Réservé aux gestionnaires de rôles.');
      await enqueue({
        kind: 'refresh',
        applicationId: interaction.application_id,
        token: interaction.token,
        guildId,
        userId,
      });
      return deferredEphemeral();
    }

    case 'royaume': {
      if (!hasPerm(interaction, MANAGE_GUILD)) return ephemeral('❌ Réservé aux admins du serveur.');
      const realm = getOption(interaction, 'nom')!;
      await setRealm(guildId, realm);
      return ephemeral(`✅ Royaume par défaut défini : **${realm}** (appliqué à tous les persos).`);
    }

    case 'setup': {
      if (!hasPerm(interaction, MANAGE_GUILD)) return ephemeral('❌ Réservé aux admins du serveur.');
      await enqueue({
        kind: 'setup',
        applicationId: interaction.application_id,
        token: interaction.token,
        guildId,
        userId,
      });
      return deferredEphemeral();
    }

    case 'tableau': {
      if (!hasPerm(interaction, MANAGE_ROLES)) return ephemeral('❌ Réservé aux gestionnaires de rôles.');
      await enqueue({
        kind: 'board',
        applicationId: interaction.application_id,
        token: interaction.token,
        guildId,
        userId,
        channelId: interaction.channel_id,
      });
      return deferredEphemeral();
    }

    default:
      return ephemeral('Commande inconnue.');
  }
}

async function handleComponent(interaction: GuildInteraction): Promise<unknown> {
  const customId = interaction.data.custom_id as string;
  if (customId === LINK_BUTTON_ID) return buildRoleSelectResponse();
  if (customId === ROLE_SELECT_ID) return buildLinkModalResponse(interaction.data.values?.[0] ?? 'auto');

  if (customId === REEVAL_BUTTON_ID) {
    const userId = interaction.member.user.id;
    const link = await getLink(interaction.guild_id, userId);
    if (!link) {
      return ephemeral("ℹ️ Tu n'as pas encore de perso lié. Clique sur **📝 Postuler** d'abord.");
    }
    const cur = link.gold ?? 0;
    const txt = cur >= 1000 ? `${Math.round(cur / 1000)}k` : String(cur);
    return buildReevalModalResponse(txt);
  }
  return ephemeral('Action inconnue.');
}

async function handleModal(interaction: GuildInteraction): Promise<unknown> {
  const customId = interaction.data.custom_id as string;
  const fields: Record<string, string> = {};
  for (const row of interaction.data.components ?? []) {
    for (const comp of row.components ?? []) fields[comp.custom_id] = comp.value;
  }

  // Réévaluation : met à jour l'or et relance l'analyse (perso inchangé).
  if (customId === REEVAL_MODAL_ID) {
    const guildId = interaction.guild_id;
    const userId = interaction.member.user.id;
    const link = await getLink(guildId, userId);
    if (!link) {
      return ephemeral("ℹ️ Tu n'as pas de perso lié. Clique sur **📝 Postuler** d'abord.");
    }
    await setLink(guildId, userId, { ...link, gold: parseGold(fields.gold) });
    await enqueue({
      kind: 'grade',
      applicationId: interaction.application_id,
      token: interaction.token,
      guildId,
      userId,
      targetUserId: userId,
    });
    return deferredEphemeral();
  }

  // Première inscription
  if (customId.startsWith(LINK_MODAL_PREFIX)) {
    const role = normalizeRole(customId.split(':')[1]);
    return startLink(interaction, fields.name, parseGold(fields.gold), role);
  }

  return ephemeral('Formulaire inconnu.');
}
