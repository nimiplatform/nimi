import { useState, type ChangeEvent, type ReactNode } from 'react';
import { Button, IconButton, TextareaField, Tooltip } from '@nimiplatform/kit/ui';
import { ArrowUp, Maximize2, Paperclip, Play, Plus, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import type { BrowserDataUrlAttachment } from '@nimiplatform/kit/features/chat/headless';
import type { TesterCapability } from '../tester-capabilities.js';
import { getCapabilityStudioProfile } from './capability-studio-profiles.js';

function ModelSummaryChip({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <Button
      type="button"
      className="studio-model-chip"
      tone="ghost"
      size="sm"
      leadingIcon={<SlidersHorizontal size={15} aria-hidden="true" />}
      onClick={onOpen}
      aria-label="Open AI model configuration"
    >
      {label}
    </Button>
  );
}

export function TextStudioComposer({
  capability,
  prompt,
  context,
  modelLabel,
  running,
  attachments,
  onOpenAttachmentPicker,
  onRemoveAttachment,
  canDispatch,
  canConfigureTarget,
  compact = false,
  onPromptChange,
  onContextChange,
  onOpenModelConfig,
  onSubmit,
}: {
  capability: TesterCapability;
  prompt: string;
  context: string;
  modelLabel: string;
  running: boolean;
  attachments: readonly BrowserDataUrlAttachment[];
  onOpenAttachmentPicker: () => void;
  onRemoveAttachment: (index: number) => void;
  canDispatch: boolean;
  canConfigureTarget: boolean;
  compact?: boolean;
  onPromptChange: (value: string) => void;
  onContextChange: (value: string) => void;
  onOpenModelConfig: () => void;
  onSubmit: () => void;
}) {
  const profile = getCapabilityStudioProfile(capability.id);
  const isReadOnlyComposer = profile.inputKind === 'none';
  const requiresPrompt = !isReadOnlyComposer;
  const composerInputValue = isReadOnlyComposer ? (profile.inputNote ?? '') : prompt;
  const contextAttached = Boolean(context.trim());
  const [contextOpen, setContextOpen] = useState(false);
  const promptReady = !requiresPrompt || Boolean(prompt.trim());
  const targetConfigAction = !canDispatch && canConfigureTarget;
  const generateDisabled = running || !promptReady || (!canDispatch && !canConfigureTarget);
  const generateLabel = running
    ? profile.primaryRunningLabel
    : targetConfigAction
      ? 'Configure model target'
      : profile.primaryLabel;
  const composerBar = (
    <div className="studio-composer__bar">
      <div className="studio-composer__controls">
        {requiresPrompt ? (
          <Button
            type="button"
            tone="ghost"
            size="sm"
            className={contextAttached ? 'studio-context-chip studio-context-chip--attached' : 'studio-context-chip'}
            leadingIcon={<Plus size={18} aria-hidden="true" />}
            onClick={() => setContextOpen((current) => !current)}
            aria-expanded={contextOpen}
          >
            {contextAttached ? 'Context attached' : 'Context'}
          </Button>
        ) : null}
      </div>
      <div className="studio-composer__actions">
        <ModelSummaryChip
          label={modelLabel}
          onOpen={onOpenModelConfig}
        />
        {profile.supportsAttachments ? (
          <div className="tester-attach-strip tester-attach-strip--icon">
            <Tooltip content="Attach context" placement="top">
              <Button
                type="button"
                className="h-8 w-8 rounded-full px-0"
                size="sm"
                tone="ghost"
                onClick={onOpenAttachmentPicker}
                disabled={running}
                aria-label="Attach context"
              >
                <Paperclip size={15} aria-hidden="true" />
              </Button>
            </Tooltip>
            {attachments.map((item, index) => (
              <span key={item.id} className="tester-attach-chip">
                {item.kind === 'image' ? (
                  <img src={item.dataUrl} alt={item.name} />
                ) : (
                  <span className="tester-attach-chip__video" aria-hidden="true">
                    <Play size={13} />
                  </span>
                )}
                <span className="tester-attach-chip__name">{item.name}</span>
                <IconButton
                  aria-label={`Remove ${item.name}`}
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
            className={targetConfigAction ? 'studio-generate-action studio-generate-action--configure' : 'studio-generate-action'}
            tone="primary"
            size="sm"
            aria-label={generateLabel}
            disabled={generateDisabled}
            onClick={targetConfigAction ? onOpenModelConfig : onSubmit}
            icon={running ? <RefreshCw size={15} aria-hidden="true" className="studio-spin" /> : <ArrowUp size={16} aria-hidden="true" />}
          />
        </Tooltip>
      </div>
    </div>
  );
  return (
    <div className={compact ? 'studio-composer studio-composer--compact' : 'studio-composer'}>
      <div className={isReadOnlyComposer ? 'studio-input studio-input--readonly' : 'studio-input'}>
        <TextareaField
          className="studio-input__box"
          textareaClassName="studio-input__textarea"
          rows={2}
          wrap="soft"
          maxLength={isReadOnlyComposer ? undefined : 2000}
          aria-label={`${capability.label} request`}
          aria-readonly={isReadOnlyComposer ? true : undefined}
          placeholder={isReadOnlyComposer ? '' : capability.id === 'text.generate' ? 'Ask Nimi to draft, rewrite, summarize, or structure something...' : profile.inputPlaceholder}
          readOnly={isReadOnlyComposer}
          value={composerInputValue}
          onChange={isReadOnlyComposer ? undefined : (event: ChangeEvent<HTMLTextAreaElement>) => onPromptChange(event.currentTarget.value)}
        />
        {requiresPrompt ? (
          <>
            <span className="studio-input__count">{prompt.length} / 2000</span>
            <Maximize2 size={13} aria-hidden="true" className="studio-input__expand" />
            <div className={contextOpen ? 'studio-context studio-context--open' : 'studio-context'}>
              <TextareaField
                className="studio-context__box"
                textareaClassName="studio-context__draft"
                rows={compact ? 2 : 3}
                wrap="soft"
                maxLength={1600}
                aria-label="Context"
                placeholder="Optional context, audience, source notes, or constraints"
                value={context}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onContextChange(event.currentTarget.value)}
              />
            </div>
          </>
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
  capability: TesterCapability;
  composer: ReactNode;
}) {
  const profile = getCapabilityStudioProfile(capability.id);
  return (
    <section className="studio-start" aria-label={`${capability.label} start`}>
      <div className="studio-start__center">
        <h2>{profile.inputTitle}</h2>
        <div className="studio-start__composer">{composer}</div>
      </div>
    </section>
  );
}
