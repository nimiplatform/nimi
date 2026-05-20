/**
 * Draft field editor for the lightweight RealmAgent creation surface.
 *
 * Renders the editable D-EXPL-009 minimum field set against a creation draft.
 * All three modes (manual / Character Card import / AI-assisted generation)
 * land on this same editor — import and generation just pre-fill it. Editing
 * here mutates the client-side draft; nothing is written to Realm.
 */

import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  REALM_AGENT_SECONDARY_TRAITS,
  type RealmAgentCreationDraftFields,
  type RealmAgentPrimaryTrait,
  type RealmAgentSecondaryTrait,
  type RealmAgentVisibility,
} from './realm-agent-creation-draft.js';
import { CardPanel, FieldLabel, SectionTitle, TextArea, TextInput } from './create-agent-primitives.js';

const PRIMARY_TRAITS: Array<{ value: Exclude<RealmAgentPrimaryTrait, ''>; labelKey: string; defaultValue: string }> = [
  { value: 'CARING', labelKey: 'World.createAgent.primaryTraits.CARING', defaultValue: 'Caring' },
  { value: 'PLAYFUL', labelKey: 'World.createAgent.primaryTraits.PLAYFUL', defaultValue: 'Playful' },
  { value: 'INTELLECTUAL', labelKey: 'World.createAgent.primaryTraits.INTELLECTUAL', defaultValue: 'Intellectual' },
  { value: 'CONFIDENT', labelKey: 'World.createAgent.primaryTraits.CONFIDENT', defaultValue: 'Confident' },
  { value: 'MYSTERIOUS', labelKey: 'World.createAgent.primaryTraits.MYSTERIOUS', defaultValue: 'Mysterious' },
  { value: 'ROMANTIC', labelKey: 'World.createAgent.primaryTraits.ROMANTIC', defaultValue: 'Romantic' },
];

const VISIBILITY_OPTIONS: Array<{ value: RealmAgentVisibility; labelKey: string; defaultValue: string; descKey: string; descDefault: string }> = [
  {
    value: 'PUBLISHED',
    labelKey: 'World.createAgent.visibility.publishedTitle',
    defaultValue: 'Published',
    descKey: 'World.createAgent.visibility.publishedDesc',
    descDefault: 'Discoverable across the World as a public RealmAgent.',
  },
  {
    value: 'UNLISTED',
    labelKey: 'World.createAgent.visibility.unlistedTitle',
    defaultValue: 'Unlisted',
    descKey: 'World.createAgent.visibility.unlistedDesc',
    descDefault: 'Created but kept out of public discovery for now.',
  },
];

type CreateAgentDraftEditorProps = {
  fields: RealmAgentCreationDraftFields;
  onFieldChange: <K extends keyof RealmAgentCreationDraftFields>(
    key: K,
    value: RealmAgentCreationDraftFields[K],
  ) => void;
  onAvatarSelect: (file: File | null | undefined) => void;
  avatarError: string | null;
};

export function CreateAgentDraftEditor(props: CreateAgentDraftEditorProps) {
  const { t } = useTranslation();
  const { fields, onFieldChange } = props;
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const toggleSecondaryTrait = (trait: RealmAgentSecondaryTrait) => {
    const checked = fields.secondaryTraits.includes(trait);
    if (checked) {
      onFieldChange('secondaryTraits', fields.secondaryTraits.filter((value) => value !== trait));
      return;
    }
    if (fields.secondaryTraits.length >= 3) {
      return;
    }
    onFieldChange('secondaryTraits', [...fields.secondaryTraits, trait]);
  };

  return (
    <div className="space-y-8">
      <section className="space-y-5">
        <SectionTitle
          title={t('World.createAgent.sections.identity', { defaultValue: 'Identity' })}
          icon={(
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          )}
        />
        <CardPanel>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(event) => {
              props.onAvatarSelect(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <div className="flex flex-col gap-8 md:flex-row md:items-center">
            <div className="relative flex-shrink-0 self-center">
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                className="relative block h-28 w-28 overflow-hidden rounded-3xl border border-white/10 bg-black/20 p-1 text-left transition-transform duration-500 hover:scale-105 hover:border-emerald-300/35 focus:outline-none focus:ring-2 focus:ring-emerald-300/35"
                aria-label={fields.avatarPreviewUrl
                  ? t('World.createAgent.changeAvatar', { defaultValue: 'Change avatar' })
                  : t('World.createAgent.uploadAvatar', { defaultValue: 'Upload avatar' })}
              >
                <div className="relative h-full w-full overflow-hidden rounded-2xl bg-white/5 flex items-center justify-center text-emerald-300/40">
                  {fields.avatarPreviewUrl ? (
                    <img src={fields.avatarPreviewUrl} alt={t('World.createAgent.avatarPreview', { defaultValue: 'Agent avatar preview' })} className="h-full w-full object-cover" />
                  ) : (
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14.5 3H9.5L7 6H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3l-2.5-3Z" />
                      <circle cx="12" cy="13" r="3.5" />
                    </svg>
                  )}
                </div>
              </button>
            </div>
            <div className="flex-1 space-y-5">
              {props.avatarError ? <p className="text-xs text-red-300">{props.avatarError}</p> : null}
              <div className="space-y-2">
                <FieldLabel required>{t('World.createAgent.handle', { defaultValue: 'Handle' })}</FieldLabel>
                <div className="relative">
                  <TextInput
                    value={fields.handle}
                    onChange={(event) => onFieldChange('handle', event.target.value)}
                    placeholder={t('World.createAgent.handlePlaceholder', { defaultValue: 'agent_unique_id' })}
                    className="pl-9 !bg-black/20 !border-white/5 focus:!border-emerald-400/40"
                  />
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-medium text-emerald-400/40">~</span>
                </div>
              </div>
              <div className="space-y-2">
                <FieldLabel>{t('World.createAgent.displayName', { defaultValue: 'Display Name' })}</FieldLabel>
                <TextInput
                  value={fields.displayName}
                  onChange={(event) => onFieldChange('displayName', event.target.value)}
                  placeholder={t('World.createAgent.displayNamePlaceholder', { defaultValue: 'Public identity name' })}
                  className="!bg-black/20 !border-white/5 focus:!border-emerald-400/40"
                />
              </div>
            </div>
          </div>
        </CardPanel>
      </section>

      <section className="space-y-5">
        <SectionTitle
          title={t('World.createAgent.sections.character', { defaultValue: 'Character' })}
          icon={(
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          )}
        />
        <CardPanel className="grid gap-4">
          <div>
            <FieldLabel required>{t('World.createAgent.concept', { defaultValue: 'Concept' })}</FieldLabel>
            <TextArea
              rows={3}
              value={fields.concept}
              onChange={(event) => onFieldChange('concept', event.target.value)}
              placeholder={t('World.createAgent.conceptPlaceholder', { defaultValue: 'The core essence' })}
            />
          </div>
          <div>
            <FieldLabel>{t('World.createAgent.description', { defaultValue: 'Description' })}</FieldLabel>
            <TextArea
              rows={3}
              value={fields.description}
              onChange={(event) => onFieldChange('description', event.target.value)}
              placeholder={t('World.createAgent.descriptionPlaceholder', { defaultValue: 'Public-facing' })}
            />
          </div>
          <div>
            <FieldLabel>{t('World.createAgent.scenario', { defaultValue: 'Scenario' })}</FieldLabel>
            <TextArea
              rows={3}
              value={fields.scenario}
              onChange={(event) => onFieldChange('scenario', event.target.value)}
              placeholder={t('World.createAgent.scenarioPlaceholder', { defaultValue: 'The world context' })}
            />
          </div>
          <div>
            <FieldLabel>{t('World.createAgent.greeting', { defaultValue: 'Greeting' })}</FieldLabel>
            <TextInput
              value={fields.greeting}
              onChange={(event) => onFieldChange('greeting', event.target.value)}
              placeholder={t('World.createAgent.greetingPlaceholder', { defaultValue: 'How they introduce themselves' })}
            />
          </div>
        </CardPanel>
      </section>

      <section className="space-y-5">
        <SectionTitle
          title={t('World.createAgent.sections.personality', { defaultValue: 'Personality DNA' })}
          icon={(
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v6" /><path d="M12 16v6" />
              <path d="M4.93 4.93l4.24 4.24" /><path d="M14.83 14.83l4.24 4.24" />
              <path d="M2 12h6" /><path d="M16 12h6" />
              <path d="M4.93 19.07l4.24-4.24" /><path d="M14.83 9.17l4.24-4.24" />
            </svg>
          )}
        />
        <CardPanel className="space-y-5">
          <div>
            <FieldLabel>{t('World.createAgent.primaryTrait', { defaultValue: 'Primary Trait' })}</FieldLabel>
            <div className="grid grid-cols-2 gap-3">
              {PRIMARY_TRAITS.map((trait) => {
                const active = fields.primaryTrait === trait.value;
                return (
                  <button
                    key={trait.value}
                    type="button"
                    onClick={() => onFieldChange('primaryTrait', active ? '' : trait.value)}
                    className={`rounded-2xl border px-4 py-3 text-sm font-medium transition-all ${
                      active
                        ? 'border-emerald-300 bg-emerald-300 text-[#06110F] shadow-[0_0_15px_rgba(0,255,170,0.45)]'
                        : 'border-white/8 bg-white/[0.04] text-[#B7D8CC] hover:border-emerald-300/35 hover:text-white'
                    }`}
                  >
                    {t(trait.labelKey, { defaultValue: trait.defaultValue })}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <FieldLabel>
              {t('World.createAgent.secondaryTraitsLabel', { defaultValue: 'Secondary Traits' })}
              <span className="ml-1 normal-case tracking-normal text-[#8DB4A8]/60">({fields.secondaryTraits.length}/3)</span>
            </FieldLabel>
            <div className="flex flex-wrap gap-2.5">
              {REALM_AGENT_SECONDARY_TRAITS.map((trait) => {
                const checked = fields.secondaryTraits.includes(trait);
                const disabled = !checked && fields.secondaryTraits.length >= 3;
                return (
                  <button
                    key={trait}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleSecondaryTrait(trait)}
                    className={`rounded-full border px-3.5 py-2 text-xs font-medium transition-all ${
                      checked
                        ? 'border-emerald-300 bg-emerald-400/10 text-emerald-300 shadow-[0_0_12px_rgba(0,255,170,0.18)]'
                        : 'border-white/10 bg-white/[0.04] text-[#A5C4B9] hover:border-emerald-300/30 hover:text-white'
                    } disabled:cursor-not-allowed disabled:opacity-30`}
                  >
                    {t(`World.createAgent.secondaryTraits.${trait}`, { defaultValue: trait })}
                  </button>
                );
              })}
            </div>
          </div>
        </CardPanel>
      </section>

      <section className="space-y-5">
        <SectionTitle
          title={t('World.createAgent.sections.wakeStrategy', { defaultValue: 'Wake Strategy' })}
          icon={(
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          {(['PASSIVE', 'PROACTIVE'] as const).map((strategy) => {
            const active = fields.wakeStrategy === strategy;
            return (
              <button
                key={strategy}
                type="button"
                onClick={() => onFieldChange('wakeStrategy', strategy)}
                className={`rounded-[20px] border px-4 py-5 text-left transition-all ${
                  active
                    ? 'border-emerald-300 bg-emerald-300/12 text-emerald-200 shadow-[0_0_20px_rgba(0,255,170,0.18)]'
                    : 'border-white/8 bg-white/[0.04] text-[#A5C4B9] hover:border-emerald-300/28 hover:text-white'
                }`}
              >
                <p className="text-sm font-semibold">
                  {strategy === 'PASSIVE'
                    ? t('World.createAgent.wakeStrategyPassiveTitle', { defaultValue: 'Passive' })
                    : t('World.createAgent.wakeStrategyProactiveTitle', { defaultValue: 'Proactive' })}
                </p>
                <p className="mt-1 text-xs leading-5 text-current/70">
                  {strategy === 'PASSIVE'
                    ? t('World.createAgent.wakeStrategyPassiveDescription', { defaultValue: 'Waits for a direct trigger before acting.' })
                    : t('World.createAgent.wakeStrategyProactiveDescription', { defaultValue: 'Can initiate reactions when the world shifts.' })}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-5">
        <SectionTitle
          title={t('World.createAgent.sections.visibility', { defaultValue: 'Visibility' })}
          icon={(
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          {VISIBILITY_OPTIONS.map((option) => {
            const active = fields.visibility === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onFieldChange('visibility', option.value)}
                className={`rounded-[20px] border px-4 py-5 text-left transition-all ${
                  active
                    ? 'border-emerald-300 bg-emerald-300/12 text-emerald-200 shadow-[0_0_20px_rgba(0,255,170,0.18)]'
                    : 'border-white/8 bg-white/[0.04] text-[#A5C4B9] hover:border-emerald-300/28 hover:text-white'
                }`}
              >
                <p className="text-sm font-semibold">{t(option.labelKey, { defaultValue: option.defaultValue })}</p>
                <p className="mt-1 text-xs leading-5 text-current/70">{t(option.descKey, { defaultValue: option.descDefault })}</p>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
