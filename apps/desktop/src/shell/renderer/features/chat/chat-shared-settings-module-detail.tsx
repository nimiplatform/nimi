import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ModelConfigCapabilityItem,
  ModelConfigProfileController,
  ModelConfigSection,
  ImageParamsState,
  LocalAssetEntry,
} from '@nimiplatform/nimi-kit/features/model-config';
import {
  ProfileConfigSection,
  CompanionSlotSelector,
  FieldRow,
  FieldSelect,
  FieldSlider,
  FieldInput,
  FieldTextarea,
  PreviewBadge,
} from '@nimiplatform/nimi-kit/features/model-config';
import { ModelPickerModal, ModelSelectorTrigger } from '@nimiplatform/nimi-kit/features/model-picker/ui';
import { bindingToPickerSelection, pickerSelectionToBinding } from '@nimiplatform/nimi-kit/features/model-config';
import type { RouteModelPickerSelection } from '@nimiplatform/nimi-kit/features/model-picker';
import type { ImageParamsEditorCopy } from '@nimiplatform/nimi-kit/features/model-config';
import {
  COMPANION_SLOTS,
  IMAGE_SIZE_PRESETS,
  IMAGE_RESPONSE_FORMAT_OPTIONS,
} from '@nimiplatform/nimi-kit/features/model-config';

// ---------------------------------------------------------------------------
// Module detail header with back button
// ---------------------------------------------------------------------------

function DetailHeader(props: { title: string; onBack: () => void; backLabel: string }) {
  return (
    <div className="mb-5 flex items-center gap-2.5">
      <button
        type="button"
        onClick={props.onBack}
        className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-white text-[var(--nimi-text-muted)] transition-all hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)] hover:text-[var(--nimi-action-primary-bg)]"
        aria-label={props.backLabel}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <h2 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{props.title}</h2>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image detail — reorganised layout with full field preservation
// ---------------------------------------------------------------------------

type ImageDetailProps = {
  items: ModelConfigCapabilityItem[];
  imageContext: {
    params: ImageParamsState;
    companionSlots: Record<string, string>;
    assets: LocalAssetEntry[];
    assetsLoading: boolean;
    onParamsChange: (next: ImageParamsState) => void;
    onCompanionSlotsChange: (next: Record<string, string>) => void;
  };
  copy: ImageParamsEditorCopy;
};

function ImageModuleDetail({ items, imageContext, copy }: ImageDetailProps) {
  const { t } = useTranslation();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { params, companionSlots, assets } = imageContext;

  const primaryItem = items.find((i) => i.capabilityId === 'image.generate');
  const editItem = items.find((i) => i.capabilityId === 'image.edit');
  const primaryReady = primaryItem?.status?.tone === 'ready';

  const updateParam = <K extends keyof ImageParamsState>(key: K, value: ImageParamsState[K]) => {
    imageContext.onParamsChange({ ...params, [key]: value });
  };

  const updateSlot = (slot: string, value: string) => {
    imageContext.onCompanionSlotsChange({ ...companionSlots, [slot]: value });
  };

  // Only show companion/params when primary model is local (same logic as original)
  const showEditorSections = primaryItem?.binding?.source === 'local';

  return (
    <div className="space-y-4">
      {/* Model selectors in status cards */}
      {primaryItem ? <CapabilityStatusCard item={{ ...primaryItem, editor: undefined }} /> : null}
      {editItem ? <CapabilityStatusCard item={{ ...editItem, editor: undefined }} /> : null}

      {showEditorSections ? (
        <>
          {/* Companion Models card */}
          <div className={`rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,var(--nimi-surface-panel))] p-4 transition-opacity ${primaryReady ? '' : 'pointer-events-none opacity-50'}`}>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-xs font-semibold text-[var(--nimi-text-secondary)]">{copy.companionModelsLabel}</span>
              {copy.previewBadgeLabel ? <PreviewBadge label={copy.previewBadgeLabel} /> : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {COMPANION_SLOTS.map((slot) => (
                <CompanionSlotSelector
                  key={slot.slot}
                  slot={slot}
                  value={companionSlots[slot.slot] || ''}
                  onChange={(value) => updateSlot(slot.slot, value)}
                  assets={assets as LocalAssetEntry[]}
                  noneLabel={copy.noneLabel}
                />
              ))}
            </div>
          </div>

          {/* Parameters card */}
          <div className={`rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,var(--nimi-surface-panel))] p-4 transition-opacity ${primaryReady ? '' : 'pointer-events-none opacity-50'}`}>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-xs font-semibold text-[var(--nimi-text-secondary)]">{copy.parametersLabel}</span>
              {copy.previewBadgeLabel ? <PreviewBadge label={copy.previewBadgeLabel} /> : null}
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label={copy.sizeLabel}>
                  <FieldSelect
                    value={params.size}
                    onChange={(value) => updateParam('size', value)}
                    options={IMAGE_SIZE_PRESETS.map((item) => ({ value: item, label: item }))}
                  />
                </FieldRow>
                <FieldRow label={copy.responseFormatLabel}>
                  <FieldSelect
                    value={params.responseFormat}
                    onChange={(value) => updateParam('responseFormat', value)}
                    options={IMAGE_RESPONSE_FORMAT_OPTIONS.map((item) => ({ value: item, label: item }))}
                  />
                </FieldRow>
              </div>
              <FieldRow label={copy.stepsLabel}>
                <FieldSlider
                  value={Number(params.steps) || 25}
                  onChange={(value) => updateParam('steps', String(value))}
                  min={1}
                  max={150}
                />
              </FieldRow>
              <FieldRow label={copy.cfgScaleLabel}>
                <FieldSlider
                  value={Number(params.cfgScale) || 7}
                  onChange={(value) => updateParam('cfgScale', String(value))}
                  min={1}
                  max={30}
                />
              </FieldRow>
            </div>
          </div>

          {/* Advanced Parameters — collapsible */}
          <div>
            <button
              type="button"
              onClick={() => setAdvancedOpen(!advancedOpen)}
              className="flex w-full items-center justify-between py-2.5"
            >
              <h3 className="text-xs font-semibold text-[var(--nimi-text-secondary)]">
                {t('Chat.imageAdvancedParams', { defaultValue: 'Advanced Parameters' })}
              </h3>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`shrink-0 text-[var(--nimi-text-muted)] transition-transform duration-200 ${advancedOpen ? 'rotate-180' : ''}`}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {advancedOpen ? (
              <div className="space-y-3 pb-3">
                <div className="grid grid-cols-2 gap-3">
                  <FieldRow label={copy.seedLabel} tooltip={copy.seedHint}>
                    <FieldInput
                      value={params.seed}
                      onChange={(value) => updateParam('seed', value)}
                      placeholder={copy.randomPlaceholder}
                    />
                  </FieldRow>
                  <FieldRow label={copy.timeoutLabel}>
                    <FieldInput
                      value={params.timeoutMs}
                      onChange={(value) => updateParam('timeoutMs', value)}
                    />
                  </FieldRow>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FieldRow label={copy.samplerLabel}>
                    <FieldInput
                      value={params.sampler}
                      onChange={(value) => updateParam('sampler', value)}
                      placeholder={copy.defaultPlaceholder}
                    />
                  </FieldRow>
                  <FieldRow label={copy.schedulerLabel}>
                    <FieldInput
                      value={params.scheduler}
                      onChange={(value) => updateParam('scheduler', value)}
                      placeholder={copy.defaultPlaceholder}
                    />
                  </FieldRow>
                </div>
                <FieldRow label={copy.customOptionsLabel} tooltip={copy.customOptionsHint}>
                  <FieldTextarea
                    value={params.optionsText}
                    onChange={(value) => updateParam('optionsText', value)}
                    placeholder={copy.oneOptionPerLinePlaceholder}
                    rows={3}
                  />
                </FieldRow>
              </div>
            ) : null}
            <div className="h-px bg-[color-mix(in_srgb,var(--nimi-border-subtle)_70%,transparent)]" />
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CapabilityStatusCardBody — renders selector + status text without label row
// ---------------------------------------------------------------------------

function CapabilityStatusCardBody(props: { item: ModelConfigCapabilityItem }) {
  const [modalOpen, setModalOpen] = useState(false);
  const { item } = props;

  if (!item.provider) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] px-3 py-4 text-center text-[11px] text-[var(--nimi-text-muted)]">
        {item.runtimeNotReadyLabel || 'Runtime not ready'}
      </div>
    );
  }

  const selection = bindingToPickerSelection(item.binding);
  const displayLabel = selection.modelLabel || selection.model || null;
  const source = selection.source || null;
  const connectorDetail = source === 'cloud' && selection.connectorId ? selection.connectorId : null;
  const shouldShowEditor = item.editor && (
    item.showEditorWhen !== 'local'
    || item.binding?.source === 'local'
  );

  const statusTitleClass = item.status?.supported
    ? 'text-[var(--nimi-status-success)]'
    : item.status?.tone === 'attention' ? 'text-[var(--nimi-status-danger)]' : 'text-[var(--nimi-text-secondary)]';

  return (
    <div className="space-y-2.5">
      <ModelSelectorTrigger
        source={source}
        modelLabel={displayLabel}
        detail={connectorDetail}
        placeholder={item.placeholder}
        onClick={() => setModalOpen(true)}
        disabled={item.disabled}
      />

      <ModelPickerModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        capability={item.routeCapability}
        capabilityLabel={item.label}
        provider={item.provider}
        initialSelection={selection}
        onSelect={(pickerSelection: RouteModelPickerSelection) => {
          item.onBindingChange(pickerSelectionToBinding(pickerSelection));
        }}
      />

      {item.status?.title || item.status?.detail ? (
        <div className="space-y-0.5">
          {item.status?.title ? (
            <div className={`text-[11px] font-medium ${statusTitleClass}`}>
              {item.status.title}
            </div>
          ) : null}
          {item.status?.detail ? (
            <div className="text-[11px] text-[var(--nimi-text-muted)]">
              {item.status.detail}
            </div>
          ) : null}
        </div>
      ) : null}

      {item.showClearButton && item.binding ? (
        <button
          type="button"
          onClick={() => item.onBindingChange(null)}
          className="text-xs text-[var(--nimi-text-muted)] transition-colors hover:text-[var(--nimi-action-primary-bg)]"
        >
          {item.clearSelectionLabel || 'Clear selection'}
        </button>
      ) : null}

      {shouldShowEditor ? item.editor : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CapabilityStatusCard — wraps capability in a status-tinted card (Cloud API style)
// ---------------------------------------------------------------------------

const STATUS_CARD_STYLE: Record<string, { border: string; bg: string }> = {
  ready: {
    border: 'border-[color-mix(in_srgb,var(--nimi-status-success)_20%,var(--nimi-border-subtle))]',
    bg: 'bg-[var(--nimi-surface-card)]',
  },
  attention: {
    border: 'border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)]',
    bg: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_6%,var(--nimi-surface-card))]',
  },
  neutral: {
    border: 'border-[var(--nimi-border-subtle)]',
    bg: 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,var(--nimi-surface-panel))]',
  },
};

const STATUS_BADGE_STYLE: Record<string, string> = {
  ready: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] text-[var(--nimi-status-success)] ring-1 ring-[color-mix(in_srgb,var(--nimi-status-success)_24%,transparent)]',
  attention: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] text-[var(--nimi-status-warning)] ring-1 ring-[color-mix(in_srgb,var(--nimi-status-warning)_24%,transparent)]',
  neutral: 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[var(--nimi-text-muted)]',
};

function CapabilityStatusCard(props: { item: ModelConfigCapabilityItem }) {
  const { item } = props;
  const tone = item.status?.tone ?? 'neutral';
  const style = STATUS_CARD_STYLE[tone] ?? STATUS_CARD_STYLE.neutral!;
  const badgeClass = STATUS_BADGE_STYLE[tone] ?? STATUS_BADGE_STYLE.neutral!;

  return (
    <div className={`rounded-2xl border p-4 ${style.border} ${style.bg}`}>
      {/* Card header: bold title + status badge right-aligned */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-[var(--nimi-text-primary)]">{item.label}</span>
        {item.status?.badgeLabel ? (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${badgeClass}`}>
            {item.status.badgeLabel}
          </span>
        ) : null}
      </div>
      {/* Card body */}
      <CapabilityStatusCardBody item={item} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// TTS detail — each capability in its own status-tinted card
// ---------------------------------------------------------------------------

function TtsModuleDetail(props: { items: ModelConfigCapabilityItem[] }) {
  return (
    <div className="space-y-3">
      {props.items.map((item) => (
        <CapabilityStatusCard key={item.capabilityId} item={item} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic section detail — renders CapabilityModelCard items + section content
// ---------------------------------------------------------------------------

function GenericSectionDetail(props: { section: ModelConfigSection }) {
  const { section } = props;
  return (
    <div className="space-y-4">
      {section.items?.map((item) => (
        <CapabilityStatusCard key={item.capabilityId} item={item} />
      ))}
      {section.content}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatSettingsModuleDetail — detail view orchestrator
// ---------------------------------------------------------------------------

export type ChatSettingsModuleDetailProps = {
  moduleId: string;
  sections: ModelConfigSection[];
  items: ModelConfigCapabilityItem[];
  profile?: ModelConfigProfileController;
  onBack: () => void;
  imageContext?: {
    params: ImageParamsState;
    companionSlots: Record<string, string>;
    assets: LocalAssetEntry[];
    assetsLoading: boolean;
    onParamsChange: (next: ImageParamsState) => void;
    onCompanionSlotsChange: (next: Record<string, string>) => void;
  } | null;
  imageEditorCopy?: ImageParamsEditorCopy;
  schedulingContent?: ReactNode;
  diagnosticsContent?: ReactNode;
};

const MODULE_TITLE_KEYS: Record<string, string> = {
  profile: 'Profile',
  chat: 'Chat',
  tts: 'TTS',
  image: 'Image',
  video: 'Video',
  scheduling: 'Scheduling',
  diagnostics: 'Diagnostics',
};

export function ChatSettingsModuleDetail({
  moduleId,
  sections,
  items,
  profile,
  onBack,
  imageContext,
  imageEditorCopy,
  schedulingContent,
  diagnosticsContent,
}: ChatSettingsModuleDetailProps) {
  const { t } = useTranslation();

  const backLabel = t('Chat.settingsBack', { defaultValue: 'Back' });
  const sectionTitle = MODULE_TITLE_KEYS[moduleId]
    ?? sections.find((s) => s.id === moduleId)?.title
    ?? moduleId;

  // Profile detail
  if (moduleId === 'profile' && profile) {
    return (
      <div>
        <DetailHeader title={sectionTitle} onBack={onBack} backLabel={backLabel} />
        <ProfileConfigSection controller={profile} />
      </div>
    );
  }

  // Image detail — custom layout
  if (moduleId === 'image' && imageContext && imageEditorCopy) {
    const imageItems = items.filter(
      (i) => i.capabilityId === 'image.generate' || i.capabilityId === 'image.edit',
    );
    return (
      <div>
        <DetailHeader title={sectionTitle} onBack={onBack} backLabel={backLabel} />
        <ImageModuleDetail items={imageItems} imageContext={imageContext} copy={imageEditorCopy} />
      </div>
    );
  }

  // Diagnostics
  if (moduleId === 'diagnostics') {
    return (
      <div>
        <DetailHeader title={sectionTitle} onBack={onBack} backLabel={backLabel} />
        {diagnosticsContent ?? (
          <div className="rounded-2xl border border-dashed border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] px-4 py-5 text-center text-xs text-[var(--nimi-text-muted)]">
            {t('Chat.settingsUnavailableReason', { defaultValue: 'This source does not expose runtime inspect yet.' })}
          </div>
        )}
      </div>
    );
  }

  // Scheduling
  if (moduleId === 'scheduling') {
    return (
      <div>
        <DetailHeader title={sectionTitle} onBack={onBack} backLabel={backLabel} />
        {schedulingContent}
      </div>
    );
  }

  // TTS detail — custom layout
  if (moduleId === 'tts') {
    const ttsSection = sections.find((s) => s.id === 'tts');
    const ttsItems = ttsSection?.items || [];
    return (
      <div>
        <DetailHeader title={sectionTitle} onBack={onBack} backLabel={backLabel} />
        <TtsModuleDetail items={ttsItems} />
      </div>
    );
  }

  // Generic section (chat, video)
  const section = sections.find((s) => s.id === moduleId);
  if (!section) {
    return (
      <div>
        <DetailHeader title={sectionTitle} onBack={onBack} backLabel={backLabel} />
        <div className="text-xs text-[var(--nimi-text-muted)]">{t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' })}</div>
      </div>
    );
  }

  return (
    <div>
      <DetailHeader title={sectionTitle} onBack={onBack} backLabel={backLabel} />
      <GenericSectionDetail section={section} />
    </div>
  );
}
