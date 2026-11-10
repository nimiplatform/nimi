import { useId, useState, type ChangeEvent, type ReactNode } from 'react';
import { Button, IconButton, InlineAlert, NimiText, TextareaField } from '@nimiplatform/kit/ui';
import { ArrowUp, Paperclip, Play, Plus, RefreshCw, ScanSearch, SlidersHorizontal, X } from 'lucide-react';
import type { BrowserDataUrlAttachment } from '@nimiplatform/kit/features/chat/headless';
import { useAIStudioHost } from './host-context.js';
import type { StudioCapabilityRegistration } from './module-registration.js';
import { hasStudioCapabilityRunInput, usesVerbatimStudioPrompt } from './section-ai-testing-input.js';
import { VisionLocateImageInput } from './section-ai-testing-vision-input.js';

function IntentSummaryChip({
  label,
  onOpen,
  configurable,
}: {
  label: string;
  onOpen?: () => void;
  configurable: boolean;
}) {
  const { translate: t } = useAIStudioHost();
  if (!configurable || !onOpen) {
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
      title={label}
    >
      {label}
    </Button>
  );
}

export function TextStudioComposer({
  registration,
  prompt,
  context,
  intentLabel,
  running,
  attachments,
  attachmentPickerEnabled = true,
  attachmentWarning,
  onOpenAttachmentPicker,
  onRemoveAttachment,
  canDispatch,
  canConfigureIntent,
  intentConfigurable = true,
  compact = false,
  parameterPanel,
  parametersActive = false,
  hasAlternativeInput = false,
  promptEnabled = true,
  inputIssue,
  onPromptChange,
  onContextChange,
  onOpenIntentConfig,
  onSubmit,
}: {
  registration: StudioCapabilityRegistration;
  prompt: string;
  context: string;
  intentLabel: string;
  running: boolean;
  attachments: readonly BrowserDataUrlAttachment[];
  attachmentPickerEnabled?: boolean;
  attachmentWarning?: string;
  onOpenAttachmentPicker: () => void;
  onRemoveAttachment: (index: number) => void;
  canDispatch: boolean;
  canConfigureIntent: boolean;
  intentConfigurable?: boolean;
  compact?: boolean;
  parameterPanel?: ReactNode;
  parametersActive?: boolean;
  hasAlternativeInput?: boolean;
  promptEnabled?: boolean;
  inputIssue?: string;
  onPromptChange: (value: string) => void;
  onContextChange: (value: string) => void;
  onOpenIntentConfig?: () => void;
  onSubmit: () => void;
}) {
  const { translate: t } = useAIStudioHost();
  const capability = registration.descriptor;
  const profile = registration.profile;
  const isVisionLocate = capability.id === 'vision.locate';
  const queryInputId = useId();
  const inputIssueId = useId();
  const isReadOnlyComposer = profile.inputKind === 'none';
  const requiresPrompt = !isReadOnlyComposer;
  const contextAttached = Boolean(context.trim());
  const supportsContext = requiresPrompt && !usesVerbatimStudioPrompt(capability.id) && !profile.rawPrompt;
  const [contextOpen, setContextOpen] = useState(false);
  const [parametersOpen, setParametersOpen] = useState(false);
  const promptReady = !inputIssue && hasStudioCapabilityRunInput({ requiresPrompt, prompt: promptEnabled ? prompt : '', hasAlternativeInput })
    && ((capability.id !== 'music.transcribe' && capability.id !== 'audio.voice.convert' && capability.id !== 'audio.separate') || hasAlternativeInput)
    && (!profile.requiresParameterInput || hasAlternativeInput)
    && (!isVisionLocate || (attachments.length === 1 && attachments[0]?.kind === 'image'));
  const intentConfigAction = Boolean(onOpenIntentConfig) && !canDispatch && canConfigureIntent;
  const generateDisabled = isVisionLocate
    ? running || (!intentConfigAction && (!promptReady || !canDispatch))
    : running || !promptReady || Boolean(attachmentWarning) || (!canDispatch && !intentConfigAction);
  const generateLabel = running
    ? t(profile.primaryRunningLabelKey)
    : intentConfigAction
      ? t('Studio.composer.configureIntent')
      : t(profile.primaryLabelKey);
  const visibleInputIssue = running ? undefined : inputIssue ?? (!promptReady ? t('Studio.composer.inputRequired') : undefined);
  const hasPromptField = !isReadOnlyComposer && promptEnabled;
  const hasAttachmentControls = profile.supportsAttachments && !isVisionLocate;
  const canRunFromPrompt = hasPromptField && !intentConfigAction && !generateDisabled;
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
        {parameterPanel && !isVisionLocate && profile.primaryParameters !== 'all' ? (
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
        {hasAttachmentControls && attachmentPickerEnabled ? (
          <Button
            type="button"
            tone="ghost"
            size="sm"
            className="studio-context-chip"
            leadingIcon={<Paperclip size={15} aria-hidden="true" />}
            onClick={onOpenAttachmentPicker}
            disabled={running}
            aria-label={t('Studio.composer.attachContext')}
          >
            {t('Studio.composer.attachContext')}
          </Button>
        ) : null}
      </div>
      <div className="studio-composer__actions">
        {canRunFromPrompt ? <kbd className="studio-composer__shortcut">{t('Studio.composer.runShortcut')}</kbd> : null}
        <Button
          type="button"
          tone="primary"
          size="sm"
          disabled={generateDisabled}
          aria-label={generateLabel}
          aria-describedby={visibleInputIssue ? inputIssueId : undefined}
          aria-keyshortcuts={canRunFromPrompt ? 'Control+Enter Meta+Enter' : undefined}
          onClick={intentConfigAction ? onOpenIntentConfig : onSubmit}
          leadingIcon={running
            ? <RefreshCw size={16} aria-hidden="true" className="studio-spin" />
            : isVisionLocate ? <ScanSearch size={16} aria-hidden="true" /> : <ArrowUp size={16} aria-hidden="true" />}
        >
          {generateLabel}
        </Button>
      </div>
    </div>
  );
  return (
    <div className={`studio-composer${compact ? ' studio-composer--compact' : ''}${isVisionLocate ? ' studio-composer--vision' : ''}`}>
      {attachmentWarning ? <InlineAlert tone="warning">{attachmentWarning}</InlineAlert> : null}
      {isVisionLocate ? <VisionLocateImageInput
        image={attachments[0]?.kind === 'image' ? attachments[0] : undefined}
        disabled={running}
        onChoose={onOpenAttachmentPicker}
        onRemove={() => onRemoveAttachment(0)}
      /> : null}
      <div className={isReadOnlyComposer ? 'studio-input studio-input--readonly' : 'studio-input'}>
        <div className="studio-composer__heading">
          <h3>{t('Studio.composer.inputTitle')}</h3>
          <IntentSummaryChip label={intentLabel} onOpen={onOpenIntentConfig} configurable={intentConfigurable} />
        </div>
        {isReadOnlyComposer ? (
          <NimiText role="body" className="studio-input__note">
            {profile.inputNoteKey ? t(profile.inputNoteKey) : ''}
          </NimiText>
        ) : hasPromptField ? (
          <div className="studio-composer__field">
            <label htmlFor={queryInputId}>
              {t(isVisionLocate ? 'VisionLocate.queryLabel' : profile.inputKind === 'url' ? 'Studio.composer.sourceUrl' : 'StudioShell.promptLabel')}
            </label>
            <TextareaField
              id={queryInputId}
              tone="quiet"
              className="rounded-none focus-within:border-transparent focus-within:ring-0"
              textareaClassName="resize-none px-0 py-0 text-[14px] font-normal leading-relaxed"
              rows={compact ? 2 : 3}
              wrap="soft"
              maxLength={2000}
              aria-label={isVisionLocate ? t('VisionLocate.queryLabel') : t('Studio.composer.requestAriaLabel', { capability: t(capability.labelKey) })}
              placeholder={capability.id === 'text.generate' ? t('Studio.composer.textGeneratePlaceholder') : t(profile.inputPlaceholderKey)}
              value={prompt}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onPromptChange(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                if (canRunFromPrompt && !event.repeat) onSubmit();
              }}
            />
          </div>
        ) : null}
        {hasAttachmentControls && attachments.length > 0 ? (
          <div className="studio-attachment-strip">
            {attachments.map((item, index) => (
              <span key={item.id} className="studio-attachment-chip">
                {item.kind === 'image' ? <img src={item.dataUrl} alt="" /> : (
                  <span className="studio-attachment-chip__video" aria-hidden="true"><Play size={13} /></span>
                )}
                <span className="studio-attachment-chip__name" title={item.name}>{item.name}</span>
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
        {parameterPanel && isVisionLocate ? (
          <div className="studio-locate-parameters">{parameterPanel}</div>
        ) : parameterPanel ? (
          <div className={[
            'studio-parameters-drawer',
            profile.primaryParameters ? 'studio-parameters-drawer--with-primary' : '',
            parametersOpen ? 'studio-parameters-drawer--open' : '',
          ].filter(Boolean).join(' ')}>
            {parameterPanel}
          </div>
        ) : null}
        {visibleInputIssue ? <p id={inputIssueId} className="studio-parameters__note" role="status">{visibleInputIssue}</p> : null}
        {composerBar}
      </div>
    </div>
  );
}

export function TextStudioStartState({
  registration,
  composer,
}: {
  registration: StudioCapabilityRegistration;
  composer: ReactNode;
}) {
  const { translate: t } = useAIStudioHost();
  const capability = registration.descriptor;
  return (
    <section className="studio-start" tabIndex={-1} aria-label={t('Studio.composer.startAriaLabel', { capability: t(capability.labelKey) })}>
      {composer}
    </section>
  );
}
