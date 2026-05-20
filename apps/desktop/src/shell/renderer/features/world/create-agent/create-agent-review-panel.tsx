/**
 * Review panel for the lightweight RealmAgent creation surface (D-EXPL-010 /
 * D-EXPL-011).
 *
 * This is the Nimi-side review gate: before the single explicit Realm write it
 * shows the user exactly which draft fields will become Realm truth, which
 * D-EXPL-009 fields are kept in the draft but not written by the current
 * `creatorControllerCreateAgent` contract, and any import / generation
 * warnings. Warnings are surfaced here, never silently written.
 */

import { useTranslation } from 'react-i18next';
import type { RealmAgentCreationDraft } from './realm-agent-creation-draft.js';
import {
  REALM_UNWRITTEN_DRAFT_FIELDS,
  REALM_WRITTEN_DRAFT_FIELDS,
} from './realm-agent-draft-submit.js';
import { CardPanel } from './create-agent-primitives.js';

function ReviewRow(props: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 py-2.5 last:border-b-0">
      <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-emerald-300/70">{props.label}</span>
      <span className={`max-w-[60%] text-right text-sm ${props.muted ? 'text-[#7FA092] italic' : 'text-[#E8FFF6]'}`}>
        {props.value}
      </span>
    </div>
  );
}

type CreateAgentReviewPanelProps = {
  draft: RealmAgentCreationDraft;
  worldName: string;
};

export function CreateAgentReviewPanel(props: CreateAgentReviewPanelProps) {
  const { t } = useTranslation();
  const { draft } = props;
  const f = draft.fields;
  const notSet = t('World.createAgent.review.notSet', { defaultValue: 'Not set' });

  const writtenLabels: Record<(typeof REALM_WRITTEN_DRAFT_FIELDS)[number], { label: string; value: string }> = {
    handle: { label: t('World.createAgent.handle', { defaultValue: 'Handle' }), value: f.handle.trim() || notSet },
    displayName: { label: t('World.createAgent.displayName', { defaultValue: 'Display Name' }), value: f.displayName.trim() || notSet },
    concept: { label: t('World.createAgent.concept', { defaultValue: 'Concept' }), value: f.concept.trim() || notSet },
    description: { label: t('World.createAgent.description', { defaultValue: 'Description' }), value: f.description.trim() || notSet },
    avatar: {
      label: t('World.createAgent.avatar', { defaultValue: 'Avatar' }),
      value: f.avatarPreviewUrl
        ? t('World.createAgent.review.avatarSelected', { defaultValue: 'Image selected' })
        : notSet,
    },
    primaryTrait: {
      label: t('World.createAgent.primaryTrait', { defaultValue: 'Primary Trait' }),
      value: f.primaryTrait || notSet,
    },
    secondaryTraits: {
      label: t('World.createAgent.secondaryTraitsLabel', { defaultValue: 'Secondary Traits' }),
      value: f.secondaryTraits.length ? f.secondaryTraits.join(', ') : notSet,
    },
  };

  const unwrittenLabels: Record<(typeof REALM_UNWRITTEN_DRAFT_FIELDS)[number], { label: string; value: string }> = {
    scenario: { label: t('World.createAgent.scenario', { defaultValue: 'Scenario' }), value: f.scenario.trim() || notSet },
    greeting: { label: t('World.createAgent.greeting', { defaultValue: 'Greeting' }), value: f.greeting.trim() || notSet },
    wakeStrategy: { label: t('World.createAgent.sections.wakeStrategy', { defaultValue: 'Wake Strategy' }), value: f.wakeStrategy || notSet },
    visibility: { label: t('World.createAgent.sections.visibility', { defaultValue: 'Visibility' }), value: f.visibility },
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3">
        <p className="text-sm font-medium text-emerald-200">
          {t('World.createAgent.review.gateTitle', { defaultValue: 'Review before creating' })}
        </p>
        <p className="mt-1 text-xs leading-5 text-[#A0C7BA]">
          {t('World.createAgent.review.gateDescription', {
            worldName: props.worldName,
            defaultValue: 'Nothing has been written to {{worldName}} yet. The agent is created only when you confirm below.',
          })}
        </p>
      </div>

      {draft.sourceLabel ? (
        <p className="text-xs text-[#8DB4A8]">
          {t('World.createAgent.review.source', {
            source: draft.sourceLabel,
            defaultValue: 'Draft source: {{source}}',
          })}
        </p>
      ) : null}

      <CardPanel>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300/80">
          {t('World.createAgent.review.willWrite', { defaultValue: 'Becomes Realm truth' })}
        </p>
        {REALM_WRITTEN_DRAFT_FIELDS.map((key) => (
          <ReviewRow key={key} label={writtenLabels[key].label} value={writtenLabels[key].value} />
        ))}
      </CardPanel>

      <CardPanel>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8DB4A8]">
          {t('World.createAgent.review.draftOnly', { defaultValue: 'Kept in draft (not written by current creation contract)' })}
        </p>
        {REALM_UNWRITTEN_DRAFT_FIELDS.map((key) => (
          <ReviewRow key={key} label={unwrittenLabels[key].label} value={unwrittenLabels[key].value} muted />
        ))}
      </CardPanel>

      {draft.warnings.length > 0 ? (
        <div className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3">
          <p className="text-sm font-medium text-amber-200">
            {t('World.createAgent.review.warningsTitle', {
              count: draft.warnings.length,
              defaultValue: '{{count}} warning(s)',
            })}
          </p>
          <ul className="mt-2 space-y-1.5">
            {draft.warnings.map((warning, index) => (
              <li key={`${warning.field}-${index}`} className="text-xs leading-5 text-amber-100/85">
                • {warning.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
