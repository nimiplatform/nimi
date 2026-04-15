/**
 * Profile editor — two-page architecture.
 *
 * Page 1: Clean dashboard — left sticky identity form + right flat capability cards.
 * Page 2: Dedicated capability config — breadcrumb, sidebar nav, sectioned cards.
 */

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AIProfile, AIProfileCapabilityIntent } from '@nimiplatform/sdk/mod';
import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import {
  type RouteModelPickerDataProvider,
  type RouteModelPickerSelection,
} from '@nimiplatform/nimi-kit/features/model-picker';
import {
  ModelPickerModal,
  ModelSelectorTrigger,
} from '@nimiplatform/nimi-kit/features/model-picker/ui';
import { validateAIProfile } from '@nimiplatform/sdk/mod';
import {
  COMPANION_SLOTS,
  IMAGE_SIZE_PRESETS,
  IMAGE_RESPONSE_FORMAT_OPTIONS,
  DEFAULT_IMAGE_PARAMS,
  type ImageParamsState,
  VIDEO_RATIO_OPTIONS,
  VIDEO_MODE_OPTIONS,
  DEFAULT_VIDEO_PARAMS,
  type VideoParamsState,
  CompanionSlotSelector,
  FieldRow,
  FieldInput,
  FieldSelect,
  FieldTextarea,
  FieldToggle,
} from '@nimiplatform/nimi-kit/features/model-config';
import { getDesktopRouteModelPickerProvider } from './desktop-route-model-picker-provider';
import { useLocalAssets } from '../chat/capability-settings-shared';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type CapabilitySectionDef = {
  key: string;
  label: string;
  subtitle: string;
  sdkCapability: string;
  group: 'basic' | 'image' | 'video' | 'voice';
  iconColor: string;
  iconBg: string;
  icon: React.ReactNode;
  /** Whether this capability has an advanced config page (Page 2). */
  hasConfigPage: boolean;
};

const CAP_ICONS = {
  chat: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  tts: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  ),
  voiceClone: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  ),
  voiceDesign: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" x2="4" y1="21" y2="14" /><line x1="4" x2="4" y1="10" y2="3" />
      <line x1="12" x2="12" y1="21" y2="12" /><line x1="12" x2="12" y1="8" y2="3" />
      <line x1="20" x2="20" y1="21" y2="16" /><line x1="20" x2="20" y1="12" y2="3" />
      <line x1="2" x2="6" y1="14" y2="14" /><line x1="10" x2="14" y1="8" y2="8" /><line x1="18" x2="22" y1="16" y2="16" />
    </svg>
  ),
  imageGenerate: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  ),
  imageEdit: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" />
    </svg>
  ),
  video: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="15" x="2" y="4" rx="2" />
      <polygon points="10 9 15 12 10 15 10 9" />
    </svg>
  ),
};

const CAPABILITY_SECTIONS: CapabilitySectionDef[] = [
  { key: 'chat', label: 'Chat', subtitle: 'LLM for text generation', sdkCapability: 'text.generate', group: 'basic', iconColor: 'text-slate-600', iconBg: 'bg-slate-100', icon: CAP_ICONS.chat, hasConfigPage: false },
  { key: 'tts', label: 'TTS', subtitle: 'Text-to-Speech synthesis', sdkCapability: 'audio.synthesize', group: 'voice', iconColor: 'text-orange-600', iconBg: 'bg-orange-50', icon: CAP_ICONS.tts, hasConfigPage: false },
  { key: 'voice_clone', label: 'Voice clone workflow', subtitle: 'Custom voice generation', sdkCapability: 'voice_workflow.tts_v2v', group: 'voice', iconColor: 'text-pink-600', iconBg: 'bg-pink-50', icon: CAP_ICONS.voiceClone, hasConfigPage: false },
  { key: 'voice_design', label: 'Voice design workflow', subtitle: 'Advanced audio parameters', sdkCapability: 'voice_workflow.tts_t2v', group: 'voice', iconColor: 'text-rose-600', iconBg: 'bg-rose-50', icon: CAP_ICONS.voiceDesign, hasConfigPage: false },
  { key: 'image.generate', label: 'Image generation', subtitle: 'Text-to-Image models', sdkCapability: 'image.generate', group: 'image', iconColor: 'text-blue-600', iconBg: 'bg-blue-50', icon: CAP_ICONS.imageGenerate, hasConfigPage: true },
  { key: 'image.edit', label: 'Image editing', subtitle: 'Ready to configure', sdkCapability: 'image.edit', group: 'image', iconColor: 'text-emerald-600', iconBg: 'bg-emerald-50', icon: CAP_ICONS.imageEdit, hasConfigPage: false },
  { key: 'video', label: 'Video', subtitle: 'Video generation & editing', sdkCapability: 'video.generate', group: 'video', iconColor: 'text-purple-600', iconBg: 'bg-purple-50', icon: CAP_ICONS.video, hasConfigPage: true },
];

// SVG icons used in cards
const GEAR_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const UNLINK_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" />
    <path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" />
    <line x1="8" x2="8" y1="2" y2="5" />
    <line x1="2" x2="5" y1="8" y2="8" />
    <line x1="16" x2="16" y1="19" y2="22" />
    <line x1="19" x2="22" y1="16" y2="16" />
  </svg>
);

const BACK_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m15 18-6-6 6-6" />
  </svg>
);

// ---------------------------------------------------------------------------
// Field primitives (editor-specific)
// ---------------------------------------------------------------------------

const FIELD_BASE = 'w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-white px-3 text-[13px] text-[var(--nimi-text-primary)] outline-none transition-colors hover:border-[var(--nimi-border-strong)] focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-mint-100';

function EditorFieldLabel(props: { label: string }) {
  return <span className="text-xs font-medium text-[var(--nimi-text-muted)]">{props.label}</span>;
}

// ---------------------------------------------------------------------------
// CapabilityCard — Page 1 flat card (bound / unbound states)
// ---------------------------------------------------------------------------

function CapabilityCard(props: {
  section: CapabilitySectionDef;
  binding: RuntimeRouteBinding | null | undefined;
  onSelectModel: () => void;
  onConfigure: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const { section, binding } = props;
  const hasBinding = Boolean(binding);
  const displayLabel = binding?.modelLabel || binding?.model || binding?.localModelId || null;
  const [confirmClear, setConfirmClear] = useState(false);

  if (hasBinding) {
    // ── Bound card: accent bar, model badge, Configure + Clear ──
    return (
      <>
        <div className="group relative flex items-center justify-between overflow-hidden rounded-xl border border-mint-200 bg-mint-50/20 p-3 pl-4 transition-all hover:border-mint-400 hover:shadow-sm">
          {/* Left accent line */}
          <div className="absolute bottom-0 left-0 top-0 w-1 bg-mint-500" />

          <div className="flex min-w-0 items-center gap-3">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${section.iconBg} ${section.iconColor}`}>
              {section.icon}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800">{section.label}</p>
              {displayLabel ? (
                <span className="mt-0.5 inline-block rounded border border-mint-100 bg-mint-50 px-1.5 py-0.5 text-[11px] font-medium text-mint-700">
                  {displayLabel}
                </span>
              ) : null}
            </div>
          </div>

          <div className="relative z-10 flex shrink-0 items-center gap-1.5">
            {/* Configure button */}
            <button
              type="button"
              onClick={props.onConfigure}
              className="flex items-center gap-1.5 rounded-lg border border-mint-200 bg-white px-3.5 py-2 text-xs font-semibold text-mint-700 shadow-sm transition-colors hover:bg-mint-50"
            >
              {GEAR_ICON}
              {t('runtimeConfig.profiles.configure', { defaultValue: 'Configure' })}
            </button>
            {/* Clear binding button — opens confirm modal */}
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
              title={t('runtimeConfig.profiles.clearBinding', { defaultValue: 'Clear Binding' })}
            >
              {UNLINK_ICON}
            </button>
          </div>
        </div>

        {/* Clear binding confirmation modal */}
        {confirmClear ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/30" onClick={() => setConfirmClear(false)} />
            <div className="relative z-10 mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
              <h3 className="text-sm font-semibold text-gray-900">
                {t('runtimeConfig.profiles.clearBindingConfirm', {
                  defaultValue: 'Are you sure you want to clear the model binding for {{capability}}? This will reset all related parameters.',
                  capability: section.label,
                })}
              </h3>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
                >
                  {t('runtimeConfig.profiles.cancel', { defaultValue: 'Cancel' })}
                </button>
                <button
                  type="button"
                  onClick={() => { setConfirmClear(false); props.onClear(); }}
                  className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                >
                  {t('runtimeConfig.profiles.confirmClear', { defaultValue: 'Clear' })}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  // ── Unbound card: plain, Select model trigger ──
  return (
    <button
      type="button"
      onClick={props.onSelectModel}
      className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition-all hover:border-slate-300 hover:shadow-sm"
    >
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${section.iconBg} ${section.iconColor} opacity-60`}>
        {section.icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-slate-800">{section.label}</p>
        <p className="text-[11px] text-slate-400">{section.subtitle}</p>
      </div>
      <span className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] font-medium text-slate-500 transition-colors group-hover:border-mint-300 group-hover:text-mint-600">
        {t('runtimeConfig.profiles.selectModel', { defaultValue: 'Select model...' })}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tags editor
// ---------------------------------------------------------------------------

function TagsEditor(props: { tags: string[]; onChange: (tags: string[]) => void }) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');

  const addTag = () => {
    const trimmed = input.trim();
    if (trimmed && !props.tags.includes(trimmed)) {
      props.onChange([...props.tags, trimmed]);
    }
    setInput('');
  };

  return (
    <div className="space-y-1.5">
      <EditorFieldLabel label={t('runtimeConfig.profiles.fieldTags', { defaultValue: 'Tags' })} />
      <div className="flex flex-wrap gap-1.5">
        {props.tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-[var(--nimi-surface-card)] px-2.5 py-0.5 text-[11px] text-[var(--nimi-text-secondary)]">
            {tag}
            <button
              type="button"
              className="text-[var(--nimi-text-muted)] hover:text-[var(--nimi-status-danger)]"
              onClick={() => props.onChange(props.tags.filter((t) => t !== tag))}
            >
              x
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className={`${FIELD_BASE} h-8`}
          placeholder={t('runtimeConfig.profiles.addTagPlaceholder', { defaultValue: 'Add tag...' })}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
        />
        <button
          type="button"
          className="shrink-0 rounded-xl border border-[var(--nimi-border-subtle)] bg-white px-3 h-8 text-xs text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-surface-card)] transition-colors"
          onClick={addTag}
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CapabilityConfigPage — Page 2 (dedicated config for image/video)
// ---------------------------------------------------------------------------

function CapabilityConfigPage(props: {
  capKey: string;
  capLabel: string;
  profileTitle: string;
  binding: RuntimeRouteBinding | null | undefined;
  onBindingChange: (binding: RuntimeRouteBinding | null) => void;
  sdkCapability: string;
  // Image-specific
  imageParams?: ImageParamsState;
  onImageParamsChange?: (params: ImageParamsState) => void;
  companionSlots?: Record<string, string>;
  onCompanionSlotChange?: (slot: string, value: string) => void;
  // Video-specific
  videoParams?: VideoParamsState;
  onVideoParamsChange?: (params: VideoParamsState) => void;
  // Actions
  onBack: () => void;
  onSave: () => void;
  onClearBinding: () => void;
}) {
  const { t } = useTranslation();
  const isImage = props.capKey === 'image.generate';

  // Model picker
  const providerRef = useRef<RouteModelPickerDataProvider | null>(null);
  if (!providerRef.current) {
    providerRef.current = getDesktopRouteModelPickerProvider(props.sdkCapability);
  }
  const provider = providerRef.current;
  const [modalOpen, setModalOpen] = useState(false);

  const initialSelection = useMemo((): Partial<RouteModelPickerSelection> | undefined => {
    if (!props.binding) return undefined;
    return {
      source: props.binding.source || undefined,
      connectorId: props.binding.connectorId || undefined,
      model: props.binding.model || props.binding.localModelId || undefined,
      modelLabel: props.binding.modelLabel,
    };
  }, [props.binding]);

  const handleSelect = (selection: RouteModelPickerSelection) => {
    props.onBindingChange({
      source: selection.source as 'local' | 'cloud',
      connectorId: selection.connectorId || '',
      model: selection.model || '',
      modelLabel: selection.modelLabel || '',
      localModelId: selection.source === 'local' ? (selection.model || '') : '',
    });
    setModalOpen(false);
  };

  const assetsQuery = useLocalAssets();
  const assets = assetsQuery.data || [];

  return (
    <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)]">
      {/* ── Header: back + save ── */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <button
          type="button"
          onClick={props.onBack}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          {BACK_ICON}
          <span>{props.capLabel}</span>
        </button>
        <button
          type="button"
          onClick={props.onSave}
          className="rounded-xl bg-[var(--nimi-action-primary-bg)] px-5 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
        >
          {t('runtimeConfig.profiles.saveProfile', { defaultValue: 'Save Profile' })}
        </button>
      </div>

      {/* ── Content: centered single column ── */}
      <div className="mx-auto max-w-2xl space-y-6 p-6">
          {/* Base Model */}
          <section id="section-base-model" className="scroll-mt-6 rounded-xl border border-gray-200 bg-white p-6">
            <h3 className="mb-4 text-sm font-semibold text-gray-900">
              {t('runtimeConfig.profiles.baseModel', { defaultValue: 'Base Model' })}
            </h3>
            {provider ? (
              <>
                <ModelSelectorTrigger
                  source={props.binding?.source || null}
                  modelLabel={props.binding?.modelLabel || props.binding?.model || null}
                  detail={props.binding?.source === 'cloud' && props.binding?.connectorId ? props.binding.connectorId : null}
                  placeholder={t('runtimeConfig.profiles.selectModel', { defaultValue: 'Select a model' })}
                  onClick={() => setModalOpen(true)}
                />
                <ModelPickerModal
                  open={modalOpen}
                  onClose={() => setModalOpen(false)}
                  capability={props.sdkCapability}
                  capabilityLabel={props.capLabel}
                  provider={provider}
                  initialSelection={initialSelection}
                  onSelect={handleSelect}
                />
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/40 px-4 py-4 text-center text-xs text-gray-400">
                Runtime not available
              </div>
            )}
          </section>

          {/* Companion Models — image only */}
          {isImage && props.companionSlots && props.onCompanionSlotChange ? (
            <section id="section-companion-models" className="scroll-mt-6 rounded-xl border border-gray-200 bg-white p-6">
              <h3 className="mb-4 text-sm font-semibold text-gray-900">
                {t('Chat.imageCompanionModels', { defaultValue: 'Companion Models' })}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {COMPANION_SLOTS.map((slot) => (
                  <CompanionSlotSelector
                    key={slot.slot}
                    slot={slot}
                    value={props.companionSlots![slot.slot] || ''}
                    onChange={(value) => props.onCompanionSlotChange!(slot.slot, value)}
                    assets={assets}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {/* Parameters */}
          <section id="section-parameters" className="scroll-mt-6 rounded-xl border border-gray-200 bg-white p-6">
            <h3 className="mb-4 text-sm font-semibold text-gray-900">
              {t('runtimeConfig.profiles.parameters', { defaultValue: 'Parameters' })}
            </h3>
            {isImage && props.imageParams && props.onImageParamsChange ? (
              <ImageConfigParams params={props.imageParams} onChange={props.onImageParamsChange} />
            ) : null}
            {!isImage && props.videoParams && props.onVideoParamsChange ? (
              <VideoConfigParams params={props.videoParams} onChange={props.onVideoParamsChange} />
            ) : null}
          </section>

          {/* API & Advanced */}
          <section id="section-api-advanced" className="scroll-mt-6 rounded-xl border border-gray-200 bg-white p-6">
            <h3 className="mb-4 text-sm font-semibold text-gray-900">
              {t('runtimeConfig.profiles.apiAdvanced', { defaultValue: 'API & Advanced' })}
            </h3>
            {isImage && props.imageParams && props.onImageParamsChange ? (
              <ImageAdvancedParams params={props.imageParams} onChange={props.onImageParamsChange} />
            ) : null}
            {!isImage && props.videoParams && props.onVideoParamsChange ? (
              <VideoAdvancedParams params={props.videoParams} onChange={props.onVideoParamsChange} />
            ) : null}
          </section>

          {/* Danger Zone */}
          <section id="section-danger-zone" className="scroll-mt-6 rounded-xl border border-red-200 bg-red-50/50 p-6">
            <h3 className="mb-2 text-sm font-semibold text-red-700">
              {t('runtimeConfig.profiles.dangerZone', { defaultValue: 'Danger Zone' })}
            </h3>
            <p className="mb-3 text-xs text-red-500">
              {t('runtimeConfig.profiles.dangerZoneHint', { defaultValue: 'Remove model binding. This will reset all parameters for this capability.' })}
            </p>
            <button
              type="button"
              onClick={props.onClearBinding}
              className="rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
            >
              {t('runtimeConfig.profiles.clearCapabilityBinding', { defaultValue: 'Clear Capability Binding' })}
            </button>
          </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image params — split into Parameters and API & Advanced sections
// ---------------------------------------------------------------------------

function ImageConfigParams(props: { params: ImageParamsState; onChange: (p: ImageParamsState) => void }) {
  const { t } = useTranslation();
  const update = <K extends keyof ImageParamsState>(key: K, value: ImageParamsState[K]) => {
    props.onChange({ ...props.params, [key]: value });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={t('Chat.imageParamSize', { defaultValue: 'Size' })}>
          <FieldSelect
            value={props.params.size}
            onChange={(v) => update('size', v)}
            options={IMAGE_SIZE_PRESETS.map((s) => ({ value: s, label: s }))}
          />
        </FieldRow>
        <FieldRow label={t('Chat.imageParamResponseFormat', { defaultValue: 'Response format' })}>
          <FieldSelect
            value={props.params.responseFormat}
            onChange={(v) => update('responseFormat', v)}
            options={IMAGE_RESPONSE_FORMAT_OPTIONS.map((s) => ({ value: s, label: s }))}
          />
        </FieldRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={t('Chat.imageParamSteps', { defaultValue: 'Steps' })}>
          <FieldInput value={props.params.steps} onChange={(v) => update('steps', v)} />
        </FieldRow>
        <FieldRow label={t('Chat.imageParamCfgScale', { defaultValue: 'CFG Scale' })}>
          <FieldInput value={props.params.cfgScale} onChange={(v) => update('cfgScale', v)} placeholder={t('Chat.placeholderDefault', { defaultValue: 'Default' })} />
        </FieldRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={t('Chat.imageParamSampler', { defaultValue: 'Sampler' })}>
          <FieldInput value={props.params.sampler} onChange={(v) => update('sampler', v)} placeholder={t('Chat.placeholderDefault', { defaultValue: 'Default' })} />
        </FieldRow>
        <FieldRow label={t('Chat.imageParamScheduler', { defaultValue: 'Scheduler' })}>
          <FieldInput value={props.params.scheduler} onChange={(v) => update('scheduler', v)} placeholder={t('Chat.placeholderDefault', { defaultValue: 'Default' })} />
        </FieldRow>
      </div>
      <FieldRow label={t('Chat.imageParamCustomOptions', { defaultValue: 'Custom options' })} tooltip={t('Chat.imageParamCustomOptionsHint', { defaultValue: 'One option per line. Example: diffusion_model' })}>
        <FieldTextarea value={props.params.optionsText} onChange={(v) => update('optionsText', v)} placeholder={t('Chat.placeholderOnePerLine', { defaultValue: 'One option per line' })} rows={3} />
      </FieldRow>
    </div>
  );
}

function ImageAdvancedParams(props: { params: ImageParamsState; onChange: (p: ImageParamsState) => void }) {
  const { t } = useTranslation();
  const update = <K extends keyof ImageParamsState>(key: K, value: ImageParamsState[K]) => {
    props.onChange({ ...props.params, [key]: value });
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <FieldRow label={t('Chat.imageParamSeed', { defaultValue: 'Seed' })} tooltip={t('Chat.imageParamSeedHint', { defaultValue: 'Optional seed for reproducibility' })}>
        <FieldInput value={props.params.seed} onChange={(v) => update('seed', v)} placeholder={t('Chat.placeholderRandom', { defaultValue: 'Random' })} />
      </FieldRow>
      <FieldRow label={t('Chat.imageParamTimeout', { defaultValue: 'Timeout (ms)' })}>
        <FieldInput value={props.params.timeoutMs} onChange={(v) => update('timeoutMs', v)} />
      </FieldRow>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Video params — split into Parameters and API & Advanced sections
// ---------------------------------------------------------------------------

function VideoConfigParams(props: { params: VideoParamsState; onChange: (p: VideoParamsState) => void }) {
  const { t } = useTranslation();
  const update = <K extends keyof VideoParamsState>(key: K, value: VideoParamsState[K]) => {
    props.onChange({ ...props.params, [key]: value });
  };

  return (
    <div className="space-y-3">
      <FieldRow label={t('Chat.videoParamMode', { defaultValue: 'Mode' })}>
        <FieldSelect
          value={props.params.mode}
          onChange={(v) => update('mode', v)}
          options={VIDEO_MODE_OPTIONS.map((m) => ({ value: m.value, label: m.label }))}
        />
      </FieldRow>
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={t('Chat.videoParamRatio', { defaultValue: 'Aspect ratio' })}>
          <FieldSelect
            value={props.params.ratio}
            onChange={(v) => update('ratio', v)}
            options={VIDEO_RATIO_OPTIONS.map((r) => ({ value: r, label: r }))}
          />
        </FieldRow>
        <FieldRow label={t('Chat.videoParamDuration', { defaultValue: 'Duration (sec)' })}>
          <FieldInput value={props.params.durationSec} onChange={(v) => update('durationSec', v)} />
        </FieldRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label={t('Chat.videoParamResolution', { defaultValue: 'Resolution' })}>
          <FieldInput value={props.params.resolution} onChange={(v) => update('resolution', v)} placeholder={t('Chat.placeholderDefault', { defaultValue: 'Default' })} />
        </FieldRow>
        <FieldRow label={t('Chat.videoParamFps', { defaultValue: 'FPS' })}>
          <FieldInput value={props.params.fps} onChange={(v) => update('fps', v)} placeholder={t('Chat.placeholderDefault', { defaultValue: 'Default' })} />
        </FieldRow>
      </div>
      <FieldToggle
        label={t('Chat.videoParamCameraFixed', { defaultValue: 'Fixed camera' })}
        checked={props.params.cameraFixed}
        onChange={(v) => update('cameraFixed', v)}
      />
      <FieldToggle
        label={t('Chat.videoParamGenerateAudio', { defaultValue: 'Generate audio' })}
        checked={props.params.generateAudio}
        onChange={(v) => update('generateAudio', v)}
      />
    </div>
  );
}

function VideoAdvancedParams(props: { params: VideoParamsState; onChange: (p: VideoParamsState) => void }) {
  const { t } = useTranslation();
  const update = <K extends keyof VideoParamsState>(key: K, value: VideoParamsState[K]) => {
    props.onChange({ ...props.params, [key]: value });
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <FieldRow label={t('Chat.videoParamSeed', { defaultValue: 'Seed' })}>
        <FieldInput value={props.params.seed} onChange={(v) => update('seed', v)} placeholder={t('Chat.placeholderRandom', { defaultValue: 'Random' })} />
      </FieldRow>
      <FieldRow label={t('Chat.videoParamTimeout', { defaultValue: 'Timeout (ms)' })}>
        <FieldInput value={props.params.timeoutMs} onChange={(v) => update('timeoutMs', v)} />
      </FieldRow>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------

export type ProfileEditorProps = {
  initial: AIProfile;
  onSave: (profile: AIProfile) => void;
  onCancel: () => void;
};

export function ProfileEditor(props: ProfileEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<AIProfile>(() => structuredClone(props.initial));
  const [errors, setErrors] = useState<string[]>([]);
  const [configView, setConfigView] = useState<{ capKey: string; label: string } | null>(null);

  // Model picker state for Page 1 (simple capabilities without config pages)
  const [pickerCap, setPickerCap] = useState<CapabilitySectionDef | null>(null);
  const pickerProviderRef = useRef<RouteModelPickerDataProvider | null>(null);

  const openPicker = (section: CapabilitySectionDef) => {
    pickerProviderRef.current = getDesktopRouteModelPickerProvider(section.sdkCapability);
    setPickerCap(section);
  };

  // Image params state
  const [imageParams, setImageParams] = useState<ImageParamsState>(() => {
    const stored = props.initial.capabilities['image.generate']?.params as Record<string, unknown> | undefined;
    if (!stored) return DEFAULT_IMAGE_PARAMS;
    return {
      size: typeof stored.size === 'string' ? stored.size : DEFAULT_IMAGE_PARAMS.size,
      responseFormat: typeof stored.responseFormat === 'string' ? stored.responseFormat : DEFAULT_IMAGE_PARAMS.responseFormat,
      seed: typeof stored.seed === 'string' ? stored.seed : DEFAULT_IMAGE_PARAMS.seed,
      timeoutMs: typeof stored.timeoutMs === 'string' ? stored.timeoutMs : DEFAULT_IMAGE_PARAMS.timeoutMs,
      steps: typeof stored.steps === 'string' ? stored.steps : DEFAULT_IMAGE_PARAMS.steps,
      cfgScale: typeof stored.cfgScale === 'string' ? stored.cfgScale : DEFAULT_IMAGE_PARAMS.cfgScale,
      sampler: typeof stored.sampler === 'string' ? stored.sampler : DEFAULT_IMAGE_PARAMS.sampler,
      scheduler: typeof stored.scheduler === 'string' ? stored.scheduler : DEFAULT_IMAGE_PARAMS.scheduler,
      optionsText: typeof stored.optionsText === 'string' ? stored.optionsText : DEFAULT_IMAGE_PARAMS.optionsText,
    };
  });

  // Video params state
  const [videoParams, setVideoParams] = useState<VideoParamsState>(() => {
    const stored = props.initial.capabilities['video.generate']?.params as Record<string, unknown> | undefined;
    if (!stored) return DEFAULT_VIDEO_PARAMS;
    return {
      mode: typeof stored.mode === 'string' ? stored.mode : DEFAULT_VIDEO_PARAMS.mode,
      ratio: typeof stored.ratio === 'string' ? stored.ratio : DEFAULT_VIDEO_PARAMS.ratio,
      durationSec: typeof stored.durationSec === 'string' ? stored.durationSec : DEFAULT_VIDEO_PARAMS.durationSec,
      resolution: typeof stored.resolution === 'string' ? stored.resolution : DEFAULT_VIDEO_PARAMS.resolution,
      fps: typeof stored.fps === 'string' ? stored.fps : DEFAULT_VIDEO_PARAMS.fps,
      seed: typeof stored.seed === 'string' ? stored.seed : DEFAULT_VIDEO_PARAMS.seed,
      timeoutMs: typeof stored.timeoutMs === 'string' ? stored.timeoutMs : DEFAULT_VIDEO_PARAMS.timeoutMs,
      negativePrompt: typeof stored.negativePrompt === 'string' ? stored.negativePrompt : DEFAULT_VIDEO_PARAMS.negativePrompt,
      cameraFixed: typeof stored.cameraFixed === 'boolean' ? stored.cameraFixed : DEFAULT_VIDEO_PARAMS.cameraFixed,
      generateAudio: typeof stored.generateAudio === 'boolean' ? stored.generateAudio : DEFAULT_VIDEO_PARAMS.generateAudio,
    };
  });

  // Companion slots state
  const [companionSlots, setCompanionSlots] = useState<Record<string, string>>(() => {
    const stored = props.initial.capabilities['image.generate']?.params as Record<string, unknown> | undefined;
    return (stored?.companionSlots && typeof stored.companionSlots === 'object')
      ? stored.companionSlots as Record<string, string>
      : {};
  });

  // State update functions (unchanged logic)
  const updateField = <K extends keyof AIProfile>(key: K, value: AIProfile[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const updateCapabilityBinding = (capKey: string, binding: RuntimeRouteBinding | null) => {
    setDraft((prev) => {
      const intent: AIProfileCapabilityIntent = prev.capabilities[capKey] || {};
      return { ...prev, capabilities: { ...prev.capabilities, [capKey]: { ...intent, binding } } };
    });
  };

  const updateCapabilityParams = (capKey: string, params: Record<string, unknown>) => {
    setDraft((prev) => {
      const intent: AIProfileCapabilityIntent = prev.capabilities[capKey] || {};
      return { ...prev, capabilities: { ...prev.capabilities, [capKey]: { ...intent, params } } };
    });
  };

  const handleImageParamsChange = (next: ImageParamsState) => {
    setImageParams(next);
    updateCapabilityParams('image.generate', { ...next, companionSlots });
  };

  const handleCompanionSlotChange = (slot: string, value: string) => {
    const next = { ...companionSlots, [slot]: value };
    setCompanionSlots(next);
    updateCapabilityParams('image.generate', { ...imageParams, companionSlots: next });
  };

  const handleVideoParamsChange = (next: VideoParamsState) => {
    setVideoParams(next);
    updateCapabilityParams('video.generate', next as unknown as Record<string, unknown>);
  };

  const handleSave = () => {
    const result = validateAIProfile(draft);
    if (!result.valid) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    props.onSave(draft);
  };

  const handleClearBinding = (capKey: string) => {
    updateCapabilityBinding(capKey, null);
    if (capKey === 'image.generate') {
      setImageParams(DEFAULT_IMAGE_PARAMS);
      setCompanionSlots({});
    }
    if (capKey === 'video.generate') {
      setVideoParams(DEFAULT_VIDEO_PARAMS);
    }
    setConfigView(null);
  };

  // ── Page 2: Capability Config ──
  if (configView) {
    return (
      <CapabilityConfigPage
        capKey={configView.capKey}
        capLabel={configView.label}
        profileTitle={draft.title}
        binding={draft.capabilities[configView.capKey]?.binding}
        onBindingChange={(b) => updateCapabilityBinding(configView.capKey, b)}
        sdkCapability={configView.capKey}
        imageParams={configView.capKey === 'image.generate' ? imageParams : undefined}
        onImageParamsChange={configView.capKey === 'image.generate' ? handleImageParamsChange : undefined}
        companionSlots={configView.capKey === 'image.generate' ? companionSlots : undefined}
        onCompanionSlotChange={configView.capKey === 'image.generate' ? handleCompanionSlotChange : undefined}
        videoParams={configView.capKey === 'video.generate' ? videoParams : undefined}
        onVideoParamsChange={configView.capKey === 'video.generate' ? handleVideoParamsChange : undefined}
        onBack={() => setConfigView(null)}
        onSave={handleSave}
        onClearBinding={() => handleClearBinding(configView.capKey)}
      />
    );
  }

  // ── Page 1: Edit Profile Dashboard ──
  return (
    <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)]">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-[var(--nimi-border-subtle)] px-6 py-4">
        <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {props.initial.title ? t('runtimeConfig.profiles.editProfile', { defaultValue: 'Edit Profile' }) : t('runtimeConfig.profiles.createProfile', { defaultValue: 'Create Profile' })}
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-xl border border-[var(--nimi-border-subtle)] bg-white px-4 py-2 text-xs text-[var(--nimi-text-secondary)] transition-colors hover:bg-[var(--nimi-surface-card)]"
            onClick={props.onCancel}
          >
            {t('runtimeConfig.profiles.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            className="rounded-xl bg-[var(--nimi-action-primary-bg)] px-5 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
            onClick={handleSave}
          >
            {t('runtimeConfig.profiles.saveProfile', { defaultValue: 'Save Profile' })}
          </button>
        </div>
      </div>

      {errors.length > 0 ? (
        <div className="mx-6 mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {errors.map((err, i) => <div key={i}>{err}</div>)}
        </div>
      ) : null}

      {/* Two-column grid body */}
      <div className="grid grid-cols-12 gap-8 p-6">
        {/* Left column: Profile Identity (sticky) */}
        <div className="col-span-5 self-start sticky top-0 space-y-5">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.profiles.profileIdentity', { defaultValue: 'Profile Identity' })}
            </h4>
            <p className="text-[12px] text-slate-400">
              {t('runtimeConfig.profiles.profileIdentityHint', { defaultValue: 'Set the basic information and persona for this AI profile.' })}
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <EditorFieldLabel label={t('runtimeConfig.profiles.fieldTitle', { defaultValue: 'Title' })} />
              <input
                className={`${FIELD_BASE} h-10`}
                placeholder={t('runtimeConfig.profiles.titlePlaceholder', { defaultValue: 'e.g. Code Assistant, Creative Writer...' })}
                value={draft.title}
                onChange={(e) => updateField('title', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <EditorFieldLabel label={t('runtimeConfig.profiles.fieldDescription', { defaultValue: 'Description' })} />
              <textarea
                className={`${FIELD_BASE} min-h-[96px] py-2.5 resize-y`}
                placeholder={t('runtimeConfig.profiles.descriptionPlaceholder', { defaultValue: "Describe this profile's purpose and system instructions..." })}
                value={draft.description}
                onChange={(e) => updateField('description', e.target.value)}
              />
            </div>
            <TagsEditor tags={draft.tags} onChange={(tags) => updateField('tags', tags)} />
          </div>
        </div>

        {/* Right column: Capabilities & Models (flat cards) */}
        <div className="col-span-7 space-y-5">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.profiles.capabilitiesAndModels', { defaultValue: 'Capabilities & Models' })}
            </h4>
            <p className="text-[12px] text-slate-400">
              {t('runtimeConfig.profiles.capabilitiesHint', { defaultValue: 'Configure the specific models this profile will use for different tasks.' })}
            </p>
          </div>

          <div className="space-y-2.5">
            {CAPABILITY_SECTIONS.map((section) => {
              const binding = draft.capabilities[section.sdkCapability]?.binding;
              const hasBinding = Boolean(binding);
              return (
                <CapabilityCard
                  key={section.key}
                  section={section}
                  binding={binding}
                  onSelectModel={() => openPicker(section)}
                  onConfigure={() => {
                    if (hasBinding && section.hasConfigPage) {
                      setConfigView({ capKey: section.sdkCapability, label: section.label });
                    } else {
                      openPicker(section);
                    }
                  }}
                  onClear={() => handleClearBinding(section.sdkCapability)}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Global model picker modal for Page 1 */}
      {pickerCap && pickerProviderRef.current ? (
        <ModelPickerModal
          open={Boolean(pickerCap)}
          onClose={() => setPickerCap(null)}
          capability={pickerCap.sdkCapability}
          capabilityLabel={pickerCap.label}
          provider={pickerProviderRef.current}
          initialSelection={
            draft.capabilities[pickerCap.sdkCapability]?.binding
              ? {
                  source: draft.capabilities[pickerCap.sdkCapability]!.binding!.source || undefined,
                  connectorId: draft.capabilities[pickerCap.sdkCapability]!.binding!.connectorId || undefined,
                  model: draft.capabilities[pickerCap.sdkCapability]!.binding!.model || draft.capabilities[pickerCap.sdkCapability]!.binding!.localModelId || undefined,
                  modelLabel: draft.capabilities[pickerCap.sdkCapability]!.binding!.modelLabel,
                }
              : undefined
          }
          onSelect={(selection: RouteModelPickerSelection) => {
            updateCapabilityBinding(pickerCap.sdkCapability, {
              source: selection.source as 'local' | 'cloud',
              connectorId: selection.connectorId || '',
              model: selection.model || '',
              modelLabel: selection.modelLabel || '',
              localModelId: selection.source === 'local' ? (selection.model || '') : '',
            });
            setPickerCap(null);
          }}
        />
      ) : null}
    </div>
  );
}
