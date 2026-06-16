import { useState, type ChangeEvent, type ReactNode } from 'react';
import { Button, IconButton, SelectField, TextareaField } from '@nimiplatform/kit/ui';
import { ArrowUp, Maximize2, Paperclip, Play, Plus, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import type { BrowserDataUrlAttachment } from '@nimiplatform/kit/features/chat/headless';
import type { TesterCapability } from '../tester-capabilities.js';
import { DEFAULT_LENGTH_VALUE, DEFAULT_TONE_VALUE, getCapabilityStudioProfile, LENGTH_OPTIONS, TONE_OPTIONS } from './capability-studio-profiles.js';

function studioControlHeadingLabel(title: string): ReactNode {
  return <span className="studio-control__menu-heading">{title}</span>;
}

function studioControlValueLabel(value: string): ReactNode {
  return <span className="studio-control__menu-value">{value}</span>;
}

function ModelSummaryChip({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button type="button" className="studio-model-chip" onClick={onOpen} aria-label="Open AI model configuration">
      <SlidersHorizontal size={15} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

export function TextStudioComposer({
  capability,
  prompt,
  context,
  modelLabel,
  tone,
  length,
  toneSelected,
  lengthSelected,
  running,
  attachments,
  onOpenAttachmentPicker,
  onRemoveAttachment,
  canDispatch,
  compact = false,
  onPromptChange,
  onContextChange,
  onOpenModelConfig,
  onToneChange,
  onLengthChange,
  onSubmit,
}: {
  capability: TesterCapability;
  prompt: string;
  context: string;
  modelLabel: string;
  tone: string;
  length: string;
  toneSelected: boolean;
  lengthSelected: boolean;
  running: boolean;
  attachments: readonly BrowserDataUrlAttachment[];
  onOpenAttachmentPicker: () => void;
  onRemoveAttachment: (index: number) => void;
  canDispatch: boolean;
  compact?: boolean;
  onPromptChange: (value: string) => void;
  onContextChange: (value: string) => void;
  onOpenModelConfig: () => void;
  onToneChange: (value: string) => void;
  onLengthChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const profile = getCapabilityStudioProfile(capability.id);
  const requiresPrompt = profile.inputKind !== 'none';
  const contextAttached = Boolean(context.trim());
  const [contextOpen, setContextOpen] = useState(false);
  const composerBar = (
    <div className="studio-composer__bar">
      <div className="studio-composer__controls">
        {profile.controls.includes('tone') ? (
          <div className={toneSelected ? 'studio-control studio-control--tone studio-control--selected' : 'studio-control studio-control--tone'}>
            <SelectField
              options={[
                { value: '__tone_heading', label: studioControlHeadingLabel('Tone'), disabled: true },
                ...TONE_OPTIONS.map((option) => ({
                  value: option.value,
                  label: studioControlValueLabel(option.label),
                })),
              ]}
              value={tone}
              onValueChange={onToneChange}
              aria-label="Tone"
              tone="quiet"
              selectClassName="studio-control__trigger"
              contentClassName="studio-control__menu"
            />
          </div>
        ) : null}
        {profile.controls.includes('length') ? (
          <div className={lengthSelected ? 'studio-control studio-control--length studio-control--selected' : 'studio-control studio-control--length'}>
            <SelectField
              options={[
                { value: '__length_heading', label: studioControlHeadingLabel('Length'), disabled: true },
                ...LENGTH_OPTIONS.map((option) => ({
                  value: option.value,
                  label: studioControlValueLabel(option.label),
                })),
              ]}
              value={length}
              onValueChange={onLengthChange}
              aria-label="Length"
              tone="quiet"
              selectClassName="studio-control__trigger"
              contentClassName="studio-control__menu"
            />
          </div>
        ) : null}
        <button
          type="button"
          className={contextAttached ? 'studio-context-chip studio-context-chip--attached' : 'studio-context-chip'}
          onClick={() => setContextOpen((current) => !current)}
          aria-expanded={contextOpen}
        >
          <Plus size={18} aria-hidden="true" />
          {contextAttached ? 'Context attached' : 'Context'}
        </button>
      </div>
      <div className="studio-composer__actions">
        <ModelSummaryChip
          label={modelLabel}
          onOpen={onOpenModelConfig}
        />
        {profile.supportsAttachments ? (
          <div className="tester-attach-strip tester-attach-strip--icon">
            <Button
              type="button"
              className="h-9 w-9 rounded-full px-0"
              size="sm"
              tone="secondary"
              onClick={onOpenAttachmentPicker}
              disabled={running}
              aria-label="Attach context"
              title="Attach context"
            >
              <Paperclip size={15} aria-hidden="true" />
            </Button>
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
        <button
          type="button"
          className="studio-generate-action"
          aria-label={running ? profile.primaryRunningLabel : profile.primaryLabel}
          title={running ? profile.primaryRunningLabel : profile.primaryLabel}
          disabled={running || !canDispatch || (requiresPrompt && !prompt.trim())}
          onClick={onSubmit}
        >
          {running ? <RefreshCw size={17} aria-hidden="true" className="studio-spin" /> : <ArrowUp size={19} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
  return (
    <div className={compact ? 'studio-composer studio-composer--compact' : 'studio-composer'}>
      {requiresPrompt ? (
        <div className="studio-input">
          <TextareaField
            className="studio-input__box"
            textareaClassName="studio-input__textarea"
            rows={compact ? 3 : 5}
            wrap="soft"
            maxLength={2000}
            aria-label={`${capability.label} request`}
            placeholder={capability.id === 'text.generate' ? 'Ask Nimi to draft, rewrite, summarize, or structure something...' : profile.inputPlaceholder}
            value={prompt}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onPromptChange(event.currentTarget.value)}
          />
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
          {composerBar}
        </div>
      ) : (
        <p className="studio-note">{profile.inputNote}</p>
      )}
      {requiresPrompt ? null : composerBar}
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
