// Construction du panneau GDKP + composants (JSON brut, sans discord.js).
import { config as cfg } from './config';
import { InteractionResponseType, ComponentType, EPHEMERAL } from './discord';
import type { Grade } from './types';

export const LINK_BUTTON_ID = 'wow_link_button';
export const REEVAL_BUTTON_ID = 'wow_reeval_button';
export const ROLE_SELECT_ID = 'wow_role_select';
export const LINK_MODAL_PREFIX = 'wow_link_modal';
export const REEVAL_MODAL_ID = 'wow_reeval_modal';
// Rapport : custom_id encodent `prefix:code:pot(:channel:message)`
export const RPT_RECALC_PREFIX = 'rpt_recalc';
export const RPT_EXCLUDE_PREFIX = 'rpt_excl';
export const RPT_EXCLUDE_MODAL_PREFIX = 'rpt_exclm';

function allGrades(): Grade[] {
  return Array.isArray(cfg.grades) ? cfg.grades : Object.values(cfg.grades).flat();
}

const RULES_DESCRIPTION = [
  'Bienvenue chez Holidays GDKP ! Afin d’assurer des raids rapides, propres et agréables pour tous, merci de prendre connaissance de nos règles :',
  '',
  '### ⚙️ Conditions & fonctionnement',
  '- **Exigence :** Logs **BLEUS (50+) minimum**, personnage optimisé & consommables prêts.',
  '- **Addon obligatoire :** **Gargul** (à jour via CurseForge) pour la gestion des enchères et des loots.',
  '- **Prime à la performance :** l’organisation ne prend **aucune commission** ! Les **10 % de frais orga** sont **100 % redistribués** le lendemain du raid en bonus cash au **Top 10 performance** (DPS / Heal / Tank).',
  '- **Règle anti-parse monkey :** le respect des strats passe avant les chiffres. Le Raid Leader / Staff se réserve le droit de **disqualifier de la prime** tout joueur qui ignore les mécaniques ou met le groupe en danger pour monter ses logs.',
  '',
  '### 💰 Enchères & Pot (GDKP)',
  '- **Normal (NM) :** enchères dès **10 000 po (10k)** — **Héroïque (HM) :** dès **30 000 po (30k)**',
  '- **Off-Spec :** moitié prix — **Transmo :** dès **1 000 po (1k)** — Surenchères de **1k en 1k**.',
  '- **Distribution :** **90 %** du pot final réparti équitablement en fin de raid entre les membres éligibles ; les **10 %** restants repartent en prime de performance — soit **100 % du pot redistribué**.',
  '',
  '⛔ Tout comportement toxique, AFK délibéré ou tentative d’escroquerie entraînera une **exclusion immédiate sans part du pot**.',
].join('\n');

/** Message du panneau : règlement + candidature (embeds) + boutons Postuler / Réévaluer. */
export function buildPanelMessage(): { embeds: unknown[]; components: unknown[] } {
  const seen = new Set<string>();
  const legend = allGrades()
    .filter((g) => (seen.has(g.role) ? false : (seen.add(g.role), true)))
    .sort((a, b) => b.min - a.min)
    .map((g) => `${g.emoji ?? '•'}${g.min}`)
    .join(' · ');

  const minParse = cfg.raidAccess?.minParse ?? 50;
  const accessRole = cfg.raidAccess?.role ?? 'Valid';
  const caddieK = Math.round(cfg.caddie.minGold / 1000);

  const rulesEmbed = {
    color: 0xe5cc80,
    title: '🏰 HOLIDAYS GDKP — Règlement & fonctionnement des raids',
    description: RULES_DESCRIPTION,
  };

  const verifEmbed = {
    color: 0x0070ff,
    title: '🤖 Candidature & vérification automatisée',
    description: [
      'Pour valider votre participation, **liez votre personnage**. Le bot analyse automatiquement vos **WarcraftLogs** et votre **budget en or** pour vous attribuer un **statut de raid** et la **couleur de votre pseudo** :',
      '',
      '**📊 Statuts d’accès au raid**',
      `- ✅ **${accessRole}** — parse moyen **≥ ${minParse} %** (place de raid garantie / prioritaire)`,
      `- 🛒 **Caddie / Buyer** — parse < ${minParse} % mais **budget ≥ ${caddieK}k po**`,
      '- ⛔ **Refusé** — parse trop faible et budget insuffisant',
      '',
      `**🎨 Grades de parse (couleur de pseudo)**`,
      `${legend}`,
      '-# Votre couleur Discord s’adapte automatiquement à votre parse moyen.',
      '',
      '**📩 Pour postuler ou mettre à jour votre statut :**',
      '- **📝 Postuler** — première inscription : rôle (Tank / Heal / DPS), nom du perso et budget en or.',
      '- **🔄 Réévaluer** — logs progressés ou budget augmenté ? Relance l’analyse et met à jour ton statut/grade.',
    ].join('\n'),
    footer: { text: 'Siege of Orgrimmar · MoP Classic · Holidays GDKP' },
  };

  const components = [
    {
      type: ComponentType.ACTION_ROW,
      components: [
        {
          type: ComponentType.BUTTON,
          style: 3, // Success (vert)
          label: '📝 Postuler',
          custom_id: LINK_BUTTON_ID,
        },
        {
          type: ComponentType.BUTTON,
          style: 1, // Primary (bleu)
          label: '🔄 Réévaluer',
          custom_id: REEVAL_BUTTON_ID,
        },
      ],
    },
  ];

  return { embeds: [rulesEmbed, verifEmbed], components };
}

/** Réponse : menu déroulant de choix du rôle (éphémère). */
export function buildRoleSelectResponse(): unknown {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      flags: EPHEMERAL,
      content: 'Quel est ton **rôle de jeu** ?',
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.STRING_SELECT,
              custom_id: ROLE_SELECT_ID,
              placeholder: 'Choisis ton rôle de jeu',
              options: [
                { label: 'Auto (détection)', value: 'auto', emoji: { name: '🔍' }, description: 'Le bot détecte DPS ou Heal' },
                { label: 'DPS', value: 'dps', emoji: { name: '⚔️' } },
                { label: 'Heal', value: 'hps', emoji: { name: '💚' } },
                { label: 'Tank', value: 'tank', emoji: { name: '🛡️' } },
              ],
            },
          ],
        },
      ],
    },
  };
}

/** Réponse : formulaire (modal) nom + royaume, le rôle est encodé dans le custom_id. */
export function buildLinkModalResponse(role: string): unknown {
  return {
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: `${LINK_MODAL_PREFIX}:${role}`,
      title: 'Lier mon perso WoW',
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.TEXT_INPUT,
              custom_id: 'name',
              label: 'Nom du personnage',
              style: 1,
              required: true,
              placeholder: 'ex : Thrall',
            },
          ],
        },
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.TEXT_INPUT,
              custom_id: 'gold',
              label: 'Or disponible (ex : 150k)',
              style: 1,
              required: false,
              placeholder: 'ex : 150k',
            },
          ],
        },
      ],
    },
  };
}

/** Réponse : modal de réévaluation (met à jour l'or, garde le perso). */
export function buildReevalModalResponse(currentGoldText: string): unknown {
  return {
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: REEVAL_MODAL_ID,
      title: 'Réévaluer — mets à jour ton or',
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.TEXT_INPUT,
              custom_id: 'gold',
              label: 'Or disponible (ex : 150k)',
              style: 1,
              required: true,
              value: currentGoldText,
              placeholder: 'ex : 150k',
            },
          ],
        },
      ],
    },
  };
}

// --- Composants du /rapport ---

/** Boutons sous un Top 10 : Recalculer + Exclure (code et pot encodés). */
export function buildReportButtons(code: string, pot: number, withExclude = true): unknown[] {
  const buttons: unknown[] = [
    {
      type: ComponentType.BUTTON,
      style: 2, // secondary
      label: '🔄 Recalculer',
      custom_id: `${RPT_RECALC_PREFIX}:${code}:${pot}`,
    },
  ];
  if (withExclude) {
    buttons.push({
      type: ComponentType.BUTTON,
      style: 4, // danger (rouge)
      label: '🚫 Exclure un joueur',
      custom_id: `${RPT_EXCLUDE_PREFIX}:${code}:${pot}`,
    });
  }
  return [{ type: ComponentType.ACTION_ROW, components: buttons }];
}

/** Modal de saisie du perso à exclure (contexte encodé dans le custom_id). */
export function buildExcludeModalResponse(
  code: string,
  pot: number,
  channelId: string,
  messageId: string,
): unknown {
  return {
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: `${RPT_EXCLUDE_MODAL_PREFIX}:${code}:${pot}:${channelId}:${messageId}`,
      title: 'Exclure un joueur du Top',
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.TEXT_INPUT,
              custom_id: 'name',
              label: 'Nom du perso à exclure',
              style: 1,
              required: true,
              placeholder: 'ex : Bizoutein',
            },
          ],
        },
      ],
    },
  };
}
