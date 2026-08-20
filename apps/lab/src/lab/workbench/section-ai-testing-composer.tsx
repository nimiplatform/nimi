import { useState, type ChangeEvent, type ReactNode } from 'react';
import { Button, IconButton, NimiText, TextareaField, Tooltip } from '@nimiplatform/kit/ui';
import { ArrowUp, Paperclip, Play, Plus, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import type { BrowserDataUrlAttachment } from '@nimiplatform/kit/features/chat/headless';
import { useTranslation } from '../../shell/i18n/index.js';
import type { LabCapability } from '../lab-capabilities.js';
import { getCapabilityStudioProfile } from './capability-studio-profiles.js';

function IntentSummaryChip({
  label,
  onOpen,
  configurable,
}: {
  label: string;
  onOpen: () => void;
  configurable: boolean;
}) {
  const { t } = useTranslation();
  if (!configurable) {
    return (
      <span
        className="studio-intent-chip studio-intent-chip--static"
        aria-label={t('Studio.composer.runtimeOwnedIntent')}
      >
        <SlidersHorizontal size={15} aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  return (
    <Button
      type="button"
      className="studio-intent-chip"
      tone="ghost"
      size="sm"
      leadingIcon={<SlidersHorizontal size={15} aria-hidden="true" />}
      onClick={onOpen}
      aria-label={t('Studio.composer.openIntentConfig')}
    >
      {label}
    </Button>
  );
}

export function TextStudioComposer({
  capability,
  prompt,
  context,
  intentLabel,
  running,
  attachments,
  onOpenAttachmentPicker,
  onRemoveAttachment,
  canDispatch,
  canConfigureIntent,
  intentConfigurable = true,
  compact = false,
  parameterPanel,
  parametersActive = false,
  hasAlternativeInput = false,
  onPromptChange,
  onContextChange,
  onOpenIntentConfig,
  onSubmit,
}: {
  capability: LabCapability;
  prompt: string;
  context: string;
  intentLabel: string;
  running: boolean;
  attachments: readonly BrowserDataUrlAttachment[];
  onOpenAttachmentPicker: () => void;
  onRemoveAttachment: (index: number) => void;
  canDispatch: boolean;
  canConfigureIntent: boolean;
  intentConfigurable?: boolean;
  compact?: boolean;
  parameterPanel?: ReactNode;
  parametersActive?: boolean;
  hasAlternativeInput?: boolean;
  onPromptChange: (value: string) => void;
  onContextChange: (value: string) => void;
  onOpenIntentConfig: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const profile = getCapabilityStudioProfile(capability.id);
  const isReadOnlyComposer = profile.inputKind === 'none';
  const requiresPrompt = !isReadOnlyComposer;
  const contextAttached = Boolean(context.trim());
  const supportsContext = requiresPrompt && capability.id !== 'audio.transcribe';
  const [contextOpen, setContextOpen] = useState(false);
  const [parametersOpen, setParametersOpen] = useState(false);
  const promptReady = !requiresPrompt || Boolean(prompt.trim()) || hasAlternativeInput;
  const intentConfigAction = !canDispatch && canConfigureIntent;
  const generateDisabled = running || !promptReady || (!canDispatch && !canConfigureIntent);
  const generateLabel = running
    ? t(profile.primaryRunningLabelKey)
    : intentConfigAction
      ? t('Studio.composer.configureIntent')
      : t(profile.primaryLabelKey);
  const composerBar = (
    <div className="studio-composer__bar">
      <div className="studio-composer__controls">
        {supportsContext ? (
          <Button
            type="button"
            tone="ghost"
            size="sm"
            className={contextAttached ? 'studio-context-chip studio-context-chip--attached' : 'studio-context-chip'}
            leadingIcon={<Plus size={18} aria-hidden="true" />}
            onClick={() => setContextOpen((current) => !current)}
            aria-expanded={contextOpen}
          >
            {contextAttached ? t('Studio.composer.contextAttached') : t('Studio.composer.context')}
          </Button>
        ) : null}
        {parameterPanel ? (
          <Button
            type="button"
            tone="ghost"
            size="sm"
            className={parametersActive ? 'studio-context-chip studio-context-chip--attached' : 'studio-context-chip'}
            leadingIcon={<SlidersHorizontal size={16} aria-hidden="true" />}
            onClick={() => setParametersOpen((current) => !current)}
            aria-expanded={parametersOpen}
          >
            {t('Studio.parameters.title')}
          </Button>
        ) : null}
      </div>
      <div className="studio-composer__actions">
        <IntentSummaryChip
          label={intentLabel}
          onOpen={onOpenIntentConfig}
          configurable={intentConfigurable}
        />
        {profile.supportsAttachments ? (
          <div className="lab-attach-strip lab-attach-strip--icon">
            <Tooltip content={t('Studio.composer.attachContext')} placement="top">
              <Button
                type="button"
                className="h-8 w-8 rounded-full px-0"
                size="sm"
                tone="ghost"
                onClick={onOpenAttachmentPicker}
                disabled={running}
                aria-label={t('Studio.composer.attachContext')}
              >
                <Paperclip size={15} aria-hidden="true" />
              </Button>
            </Tooltip>
            {attachments.map((item, index) => (
              <span key={item.id} className="lab-attach-chip">
                {item.kind === 'image' ? (
                  <img src={item.dataUrl} alt={item.name} />
                ) : (
                  <span className="lab-attach-chip__video" aria-hidden="true">
                    <Play size={13} />
                  </span>
                )}
                <span className="lab-attach-chip__name">{item.name}</span>
                <IconButton
                  aria-label={t('Studio.composer.removeAttachment', { name: item.name })}
                  onClick={() => onRemoveAttachment(index)}
                  icon={<X size={13} aria-hidden="true" />}
                  size="sm"
                  tone="ghost"
                  className="h-6 w-6"
                />
              </span>
            ))}
          </div>
        ) : null}
        <Tooltip content={generateLabel} placement="top">
          <IconButton
            type="button"
            className={intentConfigAction ? 'studio-generate-action studio-generate-action--configure' : 'studio-generate-action'}
            tone="primary"
            size="sm"
            aria-label={generateLabel}
            disabled={generateDisabled}
            onClick={intentConfigAction ? onOpenIntentConfig : onSubmit}
            icon={running ? <RefreshCw size={15} aria-hidden="true" className="studio-spin" /> : <ArrowUp size={16} aria-hidden="true" />}
          />
        </Tooltip>
      </div>
    </div>
  );
  return (
    <div className={compact ? 'studio-composer studio-composer--compact' : 'studio-composer'}>
      <div className={isReadOnlyComposer ? 'studio-input studio-input--readonly' : 'studio-input'}>
        {isReadOnlyComposer ? (
          <NimiText role="body" className="studio-input__note">
            {profile.inputNoteKey ? t(profile.inputNoteKey) : ''}
          </NimiText>
        ) : (
          <TextareaField
            tone="quiet"
            className="rounded-none focus-within:border-transparent focus-within:ring-0"
            textareaClassName="min-h-[calc(2*1.55em)] resize-none px-0 py-0 text-[15px] leading-[1.55]"
            rows={2}
            wrap="soft"
            maxLength={2000}
            aria-label={t('Studio.composer.requestAriaLabel', { capability: t(capability.labelKey) })}
            placeholder={capability.id === 'text.generate' ? t('Studio.composer.textGeneratePlaceholder') : t(profile.inputPlaceholderKey)}
            value={prompt}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onPromptChange(event.currentTarget.value)}
          />
        )}
        {supportsContext ? (
          <div className={contextOpen ? 'studio-context studio-context--open' : 'studio-context'}>
            <TextareaField
              tone="quiet"
              className="rounded-none focus-within:border-transparent focus-within:ring-0"
              textareaClassName="min-h-[56px] resize-none px-0 py-0 text-[15px] leading-[1.55]"
              rows={compact ? 2 : 3}
              wrap="soft"
              maxLength={1600}
              aria-label={t('Studio.composer.context')}
              placeholder={t('Studio.composer.contextPlaceholder')}
              value={context}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onContextChange(event.currentTarget.value)}
            />
          </div>
        ) : null}
        {parameterPanel ? (
          <div className={parametersOpen ? 'studio-parameters-drawer studio-parameters-drawer--open' : 'studio-parameters-drawer'}>
            {parameterPanel}
          </div>
        ) : null}
        {composerBar}
      </div>
    </div>
  );
}

export function TextStudioStartState({
  capability,
  composer,
}: {
  capability: LabCapability;
  composer: ReactNode;
}) {
  const { t } = useTranslation();
  const profile = getCapabilityStudioProfile(capability.id);
  return (
    <section className="studio-start" aria-label={t('Studio.composer.startAriaLabel', { capability: t(capability.labelKey) })}>
      <div className="studio-start__center">
        <h2>{t(profile.inputTitleKey)}</h2>
        <div className="studio-start__composer">{composer}</div>
      </div>
    </section>
  );
}
