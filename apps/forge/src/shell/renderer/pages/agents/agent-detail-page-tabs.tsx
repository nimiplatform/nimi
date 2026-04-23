import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { RuntimeChatPanel } from '@nimiplatform/nimi-kit/features/chat/ui';
import {
  useRuntimeChatSession,
  type RuntimeChatSessionMessage,
} from '@nimiplatform/nimi-kit/features/chat/runtime';
import type { JsonObject } from '@renderer/bridge';
import {
  DNA_PRIMARY_TYPES,
  DNA_SECONDARY_TRAITS,
} from '@world-engine/services/agent-dna-traits.js';
import type {
  AgentDetail,
  CreatorKeyItem,
} from '@renderer/hooks/use-agent-queries.js';
import { formatDate } from '@renderer/components/format-utils.js';
import { LabeledTextField, LabeledTextareaField } from '@renderer/components/form-fields.js';
import { ForgeSegmentControl, type SegmentOption } from '@renderer/components/segment-control.js';
import { ForgeStatusBadge } from '@renderer/components/status-indicators.js';
import { ForgeEntityAvatar } from '@renderer/components/card-list.js';
import { ForgeListCard } from '@renderer/components/card-list.js';
import { ForgeLoadingSpinner, ForgeEmptyState, ForgeErrorBanner } from '@renderer/components/page-layout.js';
import { ForgeConfirmDialog, useConfirmDialog } from '@renderer/components/confirm-modals.js';

function toJsonObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

/* ------------------------------------------------------------------ */
/*  DnaCategorySelector (uses ForgeSegmentControl)                     */
/* ------------------------------------------------------------------ */

function DnaCategorySelector({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const segmentOptions: SegmentOption[] = options.map((opt) => ({
    value: opt,
    label: opt.charAt(0).toUpperCase() + opt.slice(1),
  }));

  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-xs text-[var(--nimi-text-muted)]">{label}</span>
      <ForgeSegmentControl options={segmentOptions} value={value} onChange={onChange} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DnaSlider (custom — kit has no slider)                             */
/* ------------------------------------------------------------------ */

function DnaSlider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-xs text-[var(--nimi-text-muted)]">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-panel)_60%,transparent)] accent-[var(--nimi-action-primary-bg)]"
      />
      <span className="w-8 text-right text-xs tabular-nums text-[var(--nimi-text-muted)]">{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ProfileTab                                                         */
/* ------------------------------------------------------------------ */

export function ProfileTab({
  agent,
  onSave,
  onOpenAvatarReview,
  onOpenGreetingReview,
  saving,
}: {
  agent: AgentDetail;
  onSave: (updates: JsonObject) => Promise<void>;
  onOpenAvatarReview: () => void;
  onOpenGreetingReview: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState(agent.displayName);
  const [concept, setConcept] = useState(agent.concept);
  const [description, setDescription] = useState(agent.description || '');
  const [scenario, setScenario] = useState(agent.scenario || '');
  const [wakeStrategy, setWakeStrategy] = useState(agent.wakeStrategy);

  const dirty =
    displayName !== agent.displayName ||
    concept !== agent.concept ||
    description !== (agent.description || '') ||
    scenario !== (agent.scenario || '') ||
    wakeStrategy !== agent.wakeStrategy;

  const wakeOptions: SegmentOption[] = [
    { value: 'PASSIVE', label: t('agentDetail.passive', 'PASSIVE') },
    { value: 'PROACTIVE', label: t('agentDetail.proactive', 'PROACTIVE') },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--nimi-text-muted)]">
        <span>
          {t('agentDetail.statusLabel', 'Status:')}{' '}
          <ForgeStatusBadge domain="agent" status={agent.status} />
        </span>
        <span>
          {t('agentDetail.stateLabel', 'State:')}{' '}
          <ForgeStatusBadge domain="generic" status={agent.state} tone="neutral" />
        </span>
        <span>
          {t('agentDetail.ownershipLabel', 'Ownership:')}{' '}
          <ForgeStatusBadge
            domain="ownership"
            status={agent.ownershipType}
            label={agent.ownershipType === 'WORLD_OWNED' ? t('agentDetail.ownerWorld', 'World') : t('agentDetail.ownerMaster', 'Master')}
          />
        </span>
        {agent.worldId ? (
          <span className="text-[var(--nimi-text-muted)]">
            {t('agentDetail.worldLabel', 'World:')}{' '}
            <strong className="text-[var(--nimi-text-secondary)]">{agent.worldId}</strong>
          </span>
        ) : null}
        <span>{t('agentDetail.createdLabel', 'Created:')} {formatDate(agent.createdAt)}</span>
        <span>{t('agentDetail.updatedLabel', 'Updated:')} {formatDate(agent.updatedAt)}</span>
      </div>

      <div className="space-y-4">
        <Surface tone="card" material="glass-thin" padding="md" className="space-y-3">
          <div className="flex items-center gap-3">
            <ForgeEntityAvatar
              src={agent.avatarUrl}
              name={agent.displayName || agent.handle}
              size="md"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                {t('agentDetail.avatar', 'Avatar')}
              </p>
              <p className="text-xs leading-5 text-[var(--nimi-text-muted)]">
                Review and bind avatar candidates from the canonical agent asset ops surface.
              </p>
            </div>
            <Button tone="secondary" size="sm" onClick={onOpenAvatarReview}>
              Open Avatar Review
            </Button>
          </div>
        </Surface>

        <LabeledTextField
          label={t('agentDetail.displayName', 'Display Name')}
          value={displayName}
          onChange={setDisplayName}
        />
        <LabeledTextareaField
          label={t('agentDetail.concept', 'Concept')}
          value={concept}
          onChange={setConcept}
          rows={2}
        />
        <LabeledTextareaField
          label={t('agentDetail.description', 'Description')}
          value={description}
          onChange={setDescription}
          rows={3}
          placeholder={t('agentDetail.descriptionPlaceholder', 'Detailed description of the agent...')}
        />
        <LabeledTextareaField
          label={t('agentDetail.scenario', 'Scenario')}
          value={scenario}
          onChange={setScenario}
          rows={3}
          placeholder={t('agentDetail.scenarioPlaceholder', 'The scenario or setting for this agent...')}
        />
        <Surface tone="card" material="glass-thin" padding="md" className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                {t('agentDetail.greeting', 'Greeting')}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--nimi-text-secondary)]">
                {agent.greeting?.trim() || t('agentDetail.greetingPlaceholder', 'The first message the agent sends...')}
              </p>
              <p className="mt-2 text-xs leading-5 text-[var(--nimi-text-muted)]">
                Greeting edits now route through candidate review, confirmation, and bind in agent asset ops.
              </p>
            </div>
            <Button tone="secondary" size="sm" onClick={onOpenGreetingReview}>
              Open Greeting Review
            </Button>
          </div>
        </Surface>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
            {t('agentDetail.wakeStrategy', 'Wake Strategy')}
          </label>
          <ForgeSegmentControl options={wakeOptions} value={wakeStrategy} onChange={(v) => setWakeStrategy(v as typeof wakeStrategy)} />
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button
          tone="primary"
          onClick={() => {
            void onSave({
              displayName,
              concept,
              description: description || undefined,
              scenario: scenario || undefined,
              wakeStrategy,
            });
          }}
          disabled={saving || !dirty}
        >
          {saving ? t('agentDetail.saving', 'Saving...') : t('agentDetail.saveProfile', 'Save Profile')}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DnaTab                                                             */
/* ------------------------------------------------------------------ */

export function DnaTab({
  agentId: _agentId,
  dna,
  soulPrime,
  soulPrimeLoading,
  onSaveDna,
  onSaveSoulPrime,
  savingDna,
  savingSoulPrime,
}: {
  agentId: string;
  dna: JsonObject | null;
  soulPrime: JsonObject | null;
  soulPrimeLoading: boolean;
  onSaveDna: (dna: JsonObject) => Promise<void>;
  onSaveSoulPrime: (soulPrime: JsonObject) => Promise<void>;
  savingDna: boolean;
  savingSoulPrime: boolean;
}) {
  const { t } = useTranslation();
  const currentPrimary = String(dna?.primaryType || '');
  const currentSecondary = Array.isArray(dna?.secondaryTraits)
    ? (dna.secondaryTraits as string[])
    : [];
  const commRecord = toJsonObject(dna?.communication);
  const currentFormality = String(commRecord.formality || 'casual');
  const currentResponseLength = String(commRecord.responseLength || 'medium');
  const currentSentiment = String(commRecord.sentiment || 'neutral');
  const voiceRecord = toJsonObject(dna?.voice);
  const currentSpeed = Number(voiceRecord.speed) || 50;
  const currentPitch = Number(voiceRecord.pitch) || 50;
  const rulesRecord = toJsonObject(dna?.rules);
  const currentRulesText = String(rulesRecord.text || '');

  const [primaryType, setPrimaryType] = useState(currentPrimary);
  const [secondaryTraits, setSecondaryTraits] = useState<string[]>(currentSecondary);
  const [formality, setFormality] = useState(currentFormality);
  const [responseLength, setResponseLength] = useState(currentResponseLength);
  const [sentiment, setSentiment] = useState(currentSentiment);
  const [voiceSpeed, setVoiceSpeed] = useState(currentSpeed);
  const [voicePitch, setVoicePitch] = useState(currentPitch);
  const [rulesText, setRulesText] = useState(currentRulesText);
  const [soulPrimeText, setSoulPrimeText] = useState('');
  const [soulPrimeInited, setSoulPrimeInited] = useState(false);

  if (soulPrime && !soulPrimeInited) {
    const text = String(soulPrime.text || soulPrime.content || '');
    setSoulPrimeText(text);
    setSoulPrimeInited(true);
  }

  const dnaDirty = primaryType !== currentPrimary ||
    JSON.stringify(secondaryTraits) !== JSON.stringify(currentSecondary) ||
    formality !== currentFormality ||
    responseLength !== currentResponseLength ||
    sentiment !== currentSentiment ||
    voiceSpeed !== currentSpeed ||
    voicePitch !== currentPitch ||
    rulesText !== currentRulesText;

  function toggleSecondary(trait: string) {
    setSecondaryTraits((prev) => {
      if (prev.includes(trait)) return prev.filter((t) => t !== trait);
      if (prev.length >= 3) return prev;
      return [...prev, trait];
    });
  }

  return (
    <div className="space-y-8">
      {/* Primary Personality Type */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('agentDetail.primaryType', 'Primary Personality Type')}
          </h3>
          <div className="flex gap-1.5">
            <Button
              tone="ghost"
              size="sm"
              onClick={() => {
                const randomIdx = Math.floor(Math.random() * DNA_PRIMARY_TYPES.length);
                setPrimaryType(DNA_PRIMARY_TYPES[randomIdx]!);
              }}
            >
              {t('agentDetail.randomize', 'Randomize')}
            </Button>
            <Button
              tone="ghost"
              size="sm"
              onClick={() => setPrimaryType(currentPrimary)}
            >
              {t('agentDetail.reset', 'Reset')}
            </Button>
          </div>
        </div>
        <p className="mb-3 text-xs text-[var(--nimi-text-muted)]">
          {t('agentDetail.primaryTypeHint', 'Select the core personality archetype for this agent.')}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {DNA_PRIMARY_TYPES.map((type) => (
            <Button
              key={type}
              tone={primaryType === type ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setPrimaryType(type)}
            >
              {type}
            </Button>
          ))}
        </div>
      </div>

      {/* Secondary Traits */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('agentDetail.secondaryTraits', 'Secondary Traits')}
            <span className="ml-2 text-xs font-normal text-[var(--nimi-text-muted)]">({secondaryTraits.length}/3)</span>
          </h3>
          <div className="flex gap-1.5">
            <Button
              tone="ghost"
              size="sm"
              onClick={() => {
                const shuffled = [...DNA_SECONDARY_TRAITS].sort(() => Math.random() - 0.5);
                setSecondaryTraits(shuffled.slice(0, 3));
              }}
            >
              {t('agentDetail.randomize', 'Randomize')}
            </Button>
            <Button
              tone="ghost"
              size="sm"
              onClick={() => setSecondaryTraits(currentSecondary)}
            >
              {t('agentDetail.reset', 'Reset')}
            </Button>
          </div>
        </div>
        <p className="mb-3 text-xs text-[var(--nimi-text-muted)]">
          {t('agentDetail.secondaryTraitsHint', 'Choose up to 3 traits that flavor the personality.')}
        </p>
        <div className="flex flex-wrap gap-2">
          {DNA_SECONDARY_TRAITS.map((trait) => {
            const selected = secondaryTraits.includes(trait);
            return (
              <Button
                key={trait}
                tone={selected ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => toggleSecondary(trait)}
                className="rounded-full"
              >
                {trait}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Communication Style */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('agentDetail.communicationStyle', 'Communication Style')}
        </h3>
        <div className="space-y-4">
          <DnaCategorySelector label={t('agentDetail.formality', 'Formality')} value={formality} options={['casual', 'formal', 'slang']} onChange={setFormality} />
          <DnaCategorySelector label={t('agentDetail.responseLength', 'Response Length')} value={responseLength} options={['short', 'medium', 'long']} onChange={setResponseLength} />
          <DnaCategorySelector label={t('agentDetail.sentiment', 'Sentiment')} value={sentiment} options={['positive', 'neutral', 'cynical']} onChange={setSentiment} />
        </div>
      </div>

      {/* Voice */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('agentDetail.voice', 'Voice')}
        </h3>
        <div className="space-y-4">
          <DnaSlider label={t('agentDetail.voiceSpeed', 'Speed')} value={voiceSpeed} onChange={setVoiceSpeed} />
          <DnaSlider label={t('agentDetail.voicePitch', 'Pitch')} value={voicePitch} onChange={setVoicePitch} />
        </div>
      </div>

      {/* Behavioral Rules */}
      <LabeledTextareaField
        label={t('agentDetail.behavioralRules', 'Behavioral Rules')}
        value={rulesText}
        onChange={setRulesText}
        rows={6}
        placeholder={t('agentDetail.rulesPlaceholder', 'e.g. Never break character\nDo not discuss real-world politics\nAlways respond in character voice')}
        helper={t('agentDetail.behavioralRulesHint', 'Define boundaries, trigger responses, and forbidden topics. One rule per line.')}
      />

      <div className="flex justify-end">
        <Button
          tone="primary"
          onClick={() => {
            const rulesLines = rulesText.split('\n').map((l) => l.trim()).filter(Boolean);
            void onSaveDna({
              ...(dna || {}),
              primaryType: primaryType || undefined,
              secondaryTraits,
              communication: { ...commRecord, formality, responseLength, sentiment },
              voice: { ...voiceRecord, speed: voiceSpeed, pitch: voicePitch },
              rules: { format: 'rule-lines-v1', lines: rulesLines, text: rulesText },
            });
          }}
          disabled={savingDna || !dnaDirty}
        >
          {savingDna ? t('agentDetail.saving', 'Saving...') : t('agentDetail.saveDna', 'Save DNA')}
        </Button>
      </div>

      {/* Soul Prime */}
      <div className="border-t border-[var(--nimi-border-subtle)] pt-6">
        <h3 className="mb-1 text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('agentDetail.soulPrime', 'Soul Prime')}
        </h3>
        <p className="mb-3 text-xs text-[var(--nimi-text-muted)]">
          {t(
            'agentDetail.soulPrimeHint',
            'Writes the canonical agent truth rule. Use labeled sections like Backstory:, Core Values:, Guidelines:, and Catchphrase: when needed.',
          )}
        </p>
        {soulPrimeLoading ? (
          <ForgeLoadingSpinner />
        ) : (
          <>
            <LabeledTextareaField
              label=""
              value={soulPrimeText}
              onChange={setSoulPrimeText}
              rows={10}
              placeholder={t(
                'agentDetail.soulPrimePlaceholder',
                'Backstory: ...\n\nCore Values: ...\n\nGuidelines: ...',
              )}
            />
            <div className="mt-3 flex justify-end">
              <Button
                tone="primary"
                onClick={() => { void onSaveSoulPrime({ text: soulPrimeText }); }}
                disabled={savingSoulPrime}
              >
                {savingSoulPrime ? t('agentDetail.saving', 'Saving...') : t('agentDetail.saveSoulPrime', 'Save Soul Prime')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PreviewTab                                                         */
/* ------------------------------------------------------------------ */

export function PreviewTab({ agent }: { agent: AgentDetail }) {
  const { t } = useTranslation();
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);

  const dnaRecord = toJsonObject(agent.dna);
  const primaryType = String(dnaRecord.primaryType || '—');
  const secondaryTraits = Array.isArray(dnaRecord.secondaryTraits)
    ? (dnaRecord.secondaryTraits as string[]).join(', ')
    : '—';
  const systemPrompt = [
    agent.concept ? `Concept: ${agent.concept}` : '',
    agent.scenario ? `Scenario: ${agent.scenario}` : '',
    dnaRecord.primaryType ? `Primary personality: ${String(dnaRecord.primaryType)}` : '',
    secondaryTraits !== '—' ? `Secondary traits: ${secondaryTraits}` : '',
  ].filter(Boolean).join('\n');
  const initialMessages: RuntimeChatSessionMessage[] = agent.greeting
    ? [{
      id: `greeting-${agent.id}`,
      role: 'assistant',
      content: agent.greeting,
      timestamp: new Date().toISOString(),
      status: 'complete',
    }]
    : [];
  const session = useRuntimeChatSession({
    initialMessages,
    resolveRequest: ({ messages }) => ({
      model: 'auto',
      input: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      system: systemPrompt || undefined,
      temperature: 0.8,
      maxTokens: 1024,
    }),
  });
  const resetMessages = session.resetMessages;

  useEffect(() => {
    resetMessages(initialMessages);
  }, [agent.id, resetMessages]);

  function handleResetConversation() {
    resetMessages(initialMessages);
  }

  return (
    <div className="space-y-4">
      <Surface tone="card" material="glass-regular" padding="none">
        <div className="flex items-center justify-between border-b border-[var(--nimi-border-subtle)] px-4 py-3">
          <div className="flex items-center gap-2">
            <ForgeEntityAvatar
              src={agent.avatarUrl}
              name={agent.displayName || agent.handle}
              size="sm"
            />
            <span className="text-sm font-medium text-[var(--nimi-text-primary)]">
              {agent.displayName || agent.handle}
            </span>
          </div>
          <div className="flex gap-1.5">
            <Button
              tone="ghost"
              size="sm"
              onClick={() => setShowSystemPrompt((v) => !v)}
            >
              {t('agentDetail.systemPrompt', 'System Prompt')}
            </Button>
            <Button
              tone="ghost"
              size="sm"
              onClick={handleResetConversation}
            >
              {t('agentDetail.resetChat', 'Reset')}
            </Button>
          </div>
        </div>

        {showSystemPrompt ? (
          <div className="space-y-2 border-b border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_45%,transparent)] px-4 py-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--nimi-text-muted)]">
              {t('agentDetail.systemPromptPreview', 'System Prompt Preview')}
            </p>
            <div className="space-y-1 text-xs text-[var(--nimi-text-muted)]">
              <p><span className="text-[var(--nimi-text-muted)]">{t('agentDetail.primaryLabel', 'Primary:')}</span> {primaryType}</p>
              <p><span className="text-[var(--nimi-text-muted)]">{t('agentDetail.secondaryLabel', 'Secondary:')}</span> {secondaryTraits}</p>
              {agent.concept ? <p><span className="text-[var(--nimi-text-muted)]">{t('agentDetail.conceptLabel', 'Concept:')}</span> {agent.concept}</p> : null}
              {agent.scenario ? <p><span className="text-[var(--nimi-text-muted)]">{t('agentDetail.scenarioLabel', 'Scenario:')}</span> {agent.scenario}</p> : null}
            </div>
          </div>
        ) : null}

        <RuntimeChatPanel
          session={session}
          className="rounded-none border-0 bg-transparent shadow-none"
          messagesClassName="h-80"
          userMessageBubbleClassName="rounded-lg border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_35%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_82%,white)] text-[var(--nimi-action-primary-text)]"
          assistantMessageBubbleClassName="rounded-lg nimi-material-glass-thin text-[var(--nimi-text-primary)]"
          composerClassName="border-[var(--nimi-border-subtle)]"
          placeholder={t('agentDetail.chatPlaceholder', 'Type a message...')}
          sendLabel={t('agentDetail.send', 'Send')}
          streamingLabel={t('agentDetail.streaming', 'Streaming...')}
          cancelLabel={t('agentDetail.cancel', 'Cancel')}
          resetLabel={t('agentDetail.resetChat', 'Reset')}
          onReset={handleResetConversation}
          emptyState={(
            <p className="py-8 text-center text-sm text-[var(--nimi-text-muted)]">
              {t('agentDetail.noMessages', 'No messages yet')}
            </p>
          )}
        />
      </Surface>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  KeysTab                                                            */
/* ------------------------------------------------------------------ */

export function KeysTab({
  keys,
  keysLoading,
  onCreateKey,
  onRevokeKey,
  creatingKey,
}: {
  keys: CreatorKeyItem[];
  keysLoading: boolean;
  onCreateKey: (payload: JsonObject) => Promise<void>;
  onRevokeKey: (keyId: string) => Promise<void>;
  creatingKey: boolean;
}) {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [keyName, setKeyName] = useState('');
  const revokeDialog = useConfirmDialog();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('agentDetail.apiKeys', 'API Keys')}
          </h3>
          <p className="mt-0.5 text-xs text-[var(--nimi-text-muted)]">
            {t('agentDetail.apiKeysHint', 'Manage API keys for programmatic access to your agents.')}
          </p>
        </div>
        <Button tone="primary" onClick={() => setShowForm(true)}>
          {t('agentDetail.createKey', 'Create Key')}
        </Button>
      </div>

      {showForm ? (
        <Surface tone="card" material="glass-thin" padding="md">
          <div className="space-y-3">
            <LabeledTextField
              label={t('agentDetail.keyName', 'Key Name')}
              value={keyName}
              onChange={setKeyName}
              placeholder={t('agentDetail.keyNamePlaceholder', 'e.g. production-key')}
            />
            <div className="flex justify-end gap-2">
              <Button
                tone="secondary"
                size="sm"
                onClick={() => {
                  setShowForm(false);
                  setKeyName('');
                }}
              >
                {t('agentDetail.cancel', 'Cancel')}
              </Button>
              <Button
                tone="primary"
                size="sm"
                onClick={() => {
                  if (!keyName.trim()) return;
                  void onCreateKey({ name: keyName.trim() }).then(() => {
                    setKeyName('');
                    setShowForm(false);
                  });
                }}
                disabled={creatingKey || !keyName.trim()}
              >
                {creatingKey ? t('agentDetail.creating', 'Creating...') : t('agentDetail.create', 'Create')}
              </Button>
            </div>
          </div>
        </Surface>
      ) : null}

      {keysLoading ? (
        <ForgeLoadingSpinner />
      ) : keys.length === 0 ? (
        <ForgeEmptyState message={t('agentDetail.noKeys', 'No API keys yet.')} />
      ) : (
        <div className="space-y-2">
          {keys.map((key) => (
            <ForgeListCard
              key={key.id}
              title={key.name}
              subtitle={[
                key.keyPreview,
                `${t('agentDetail.createdAt', 'Created:')} ${formatDate(key.createdAt)}`,
                key.lastUsedAt ? `${t('agentDetail.lastUsed', 'Last used:')} ${formatDate(key.lastUsedAt)}` : '',
                key.expiresAt ? `${t('agentDetail.expiresAt', 'Expires:')} ${formatDate(key.expiresAt)}` : '',
              ].filter(Boolean).join(' \u00b7 ')}
              actions={
                <Button
                  tone="danger"
                  size="sm"
                  onClick={async () => {
                    const confirmed = await revokeDialog.confirm();
                    if (confirmed) {
                      void onRevokeKey(key.id);
                    }
                  }}
                >
                  {t('agentDetail.revoke', 'Revoke')}
                </Button>
              }
            />
          ))}
        </div>
      )}

      <ForgeConfirmDialog
        {...revokeDialog.dialogProps}
        title={t('agentDetail.revokeKeyTitle', 'Revoke API Key')}
        message={t('agentDetail.confirmRevoke', 'Revoke this key? This cannot be undone.')}
        confirmLabel={t('agentDetail.revoke', 'Revoke')}
        cancelLabel={t('agentDetail.cancel', 'Cancel')}
      />
    </div>
  );
}
