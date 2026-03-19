import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getPlatformClient } from '@nimiplatform/sdk';
import type { JsonObject } from '@renderer/bridge/types.js';
import {
  DNA_PRIMARY_TYPES,
  DNA_SECONDARY_TRAITS,
} from '@world-engine/services/agent-dna-traits.js';
import type {
  AgentDetail,
  CreatorKeyItem,
} from '@renderer/hooks/use-agent-queries.js';

function toJsonObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

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
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-xs text-neutral-400">{label}</span>
      <div className="flex gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
              value === opt
                ? 'border-white bg-white text-black'
                : 'border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-500 hover:text-white'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

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
      <span className="w-28 shrink-0 text-xs text-neutral-400">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-neutral-700 accent-white"
      />
      <span className="w-8 text-right text-xs tabular-nums text-neutral-400">{value}</span>
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-neutral-400">{label}</label>
      {children}
    </div>
  );
}

export function ProfileTab({
  agent,
  onSave,
  saving,
}: {
  agent: AgentDetail;
  onSave: (updates: JsonObject) => Promise<void>;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState(agent.displayName);
  const [concept, setConcept] = useState(agent.concept);
  const [description, setDescription] = useState(agent.description || '');
  const [scenario, setScenario] = useState(agent.scenario || '');
  const [greeting, setGreeting] = useState(agent.greeting || '');
  const [wakeStrategy, setWakeStrategy] = useState(agent.wakeStrategy);

  const dirty =
    displayName !== agent.displayName ||
    concept !== agent.concept ||
    description !== (agent.description || '') ||
    scenario !== (agent.scenario || '') ||
    greeting !== (agent.greeting || '') ||
    wakeStrategy !== agent.wakeStrategy;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 text-xs text-neutral-500">
        <span>{t('agentDetail.statusLabel', 'Status:')} <strong className="text-neutral-300">{agent.status}</strong></span>
        <span>{t('agentDetail.stateLabel', 'State:')} <strong className="text-neutral-300">{agent.state}</strong></span>
        <span>{t('agentDetail.ownershipLabel', 'Ownership:')} <strong className="text-neutral-300">{agent.ownershipType === 'WORLD_OWNED' ? t('agentDetail.ownerWorld', 'World') : t('agentDetail.ownerMaster', 'Master')}</strong></span>
        {agent.worldId ? <span>{t('agentDetail.worldLabel', 'World:')} <strong className="text-neutral-300">{agent.worldId}</strong></span> : null}
        <span>{t('agentDetail.createdLabel', 'Created:')} {formatDate(agent.createdAt)}</span>
        <span>{t('agentDetail.updatedLabel', 'Updated:')} {formatDate(agent.updatedAt)}</span>
      </div>

      <div className="space-y-4">
        <FieldGroup label={t('agentDetail.displayName', 'Display Name')}>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
          />
        </FieldGroup>
        <FieldGroup label={t('agentDetail.concept', 'Concept')}>
          <textarea
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            rows={2}
            className="w-full resize-none rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
          />
        </FieldGroup>
        <FieldGroup label={t('agentDetail.description', 'Description')}>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder={t('agentDetail.descriptionPlaceholder', 'Detailed description of the agent...')}
            className="w-full resize-none rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
          />
        </FieldGroup>
        <FieldGroup label={t('agentDetail.scenario', 'Scenario')}>
          <textarea
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            rows={3}
            placeholder={t('agentDetail.scenarioPlaceholder', 'The scenario or setting for this agent...')}
            className="w-full resize-none rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
          />
        </FieldGroup>
        <FieldGroup label={t('agentDetail.greeting', 'Greeting')}>
          <textarea
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            rows={2}
            placeholder={t('agentDetail.greetingPlaceholder', 'The first message the agent sends...')}
            className="w-full resize-none rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
          />
        </FieldGroup>
        <FieldGroup label={t('agentDetail.wakeStrategy', 'Wake Strategy')}>
          <div className="flex gap-2">
            {(['PASSIVE', 'PROACTIVE'] as const).map((strategy) => (
              <button
                key={strategy}
                onClick={() => setWakeStrategy(strategy)}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                  wakeStrategy === strategy
                    ? 'bg-white text-black'
                    : 'bg-neutral-800 text-neutral-400 hover:text-white'
                }`}
              >
                {strategy === 'PASSIVE' ? t('agentDetail.passive', 'PASSIVE') : t('agentDetail.proactive', 'PROACTIVE')}
              </button>
            ))}
          </div>
        </FieldGroup>
      </div>

      <div className="flex justify-end pt-2">
        <button
          onClick={() => {
            void onSave({
              displayName,
              concept,
              description: description || undefined,
              scenario: scenario || undefined,
              greeting: greeting || undefined,
              wakeStrategy,
            });
          }}
          disabled={saving || !dirty}
          className="rounded-lg bg-white px-5 py-2 text-sm font-medium text-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
        >
          {saving ? t('agentDetail.saving', 'Saving...') : t('agentDetail.saveProfile', 'Save Profile')}
        </button>
      </div>
    </div>
  );
}

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
      <div>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">{t('agentDetail.primaryType', 'Primary Personality Type')}</h3>
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                const randomIdx = Math.floor(Math.random() * DNA_PRIMARY_TYPES.length);
                setPrimaryType(DNA_PRIMARY_TYPES[randomIdx]!);
              }}
              className="rounded px-2 py-0.5 text-xs text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white"
              title="Randomize"
            >
              {t('agentDetail.randomize', 'Randomize')}
            </button>
            <button
              onClick={() => setPrimaryType(currentPrimary)}
              className="rounded px-2 py-0.5 text-xs text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white"
              title="Reset to saved value"
            >
              {t('agentDetail.reset', 'Reset')}
            </button>
          </div>
        </div>
        <p className="mb-3 text-xs text-neutral-500">
          {t('agentDetail.primaryTypeHint', 'Select the core personality archetype for this agent.')}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {DNA_PRIMARY_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => setPrimaryType(type)}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                primaryType === type
                  ? 'border-white bg-white text-black'
                  : 'border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-500 hover:text-white'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">
            {t('agentDetail.secondaryTraits', 'Secondary Traits')}
            <span className="ml-2 text-xs font-normal text-neutral-500">({secondaryTraits.length}/3)</span>
          </h3>
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                const shuffled = [...DNA_SECONDARY_TRAITS].sort(() => Math.random() - 0.5);
                setSecondaryTraits(shuffled.slice(0, 3));
              }}
              className="rounded px-2 py-0.5 text-xs text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white"
              title="Randomize"
            >
              {t('agentDetail.randomize', 'Randomize')}
            </button>
            <button
              onClick={() => setSecondaryTraits(currentSecondary)}
              className="rounded px-2 py-0.5 text-xs text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white"
              title="Reset to saved value"
            >
              {t('agentDetail.reset', 'Reset')}
            </button>
          </div>
        </div>
        <p className="mb-3 text-xs text-neutral-500">
          {t('agentDetail.secondaryTraitsHint', 'Choose up to 3 traits that flavor the personality.')}
        </p>
        <div className="flex flex-wrap gap-2">
          {DNA_SECONDARY_TRAITS.map((trait) => {
            const selected = secondaryTraits.includes(trait);
            return (
              <button
                key={trait}
                onClick={() => toggleSecondary(trait)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  selected
                    ? 'border-white bg-white text-black'
                    : 'border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-500 hover:text-white'
                }`}
              >
                {trait}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-white">{t('agentDetail.communicationStyle', 'Communication Style')}</h3>
        <div className="space-y-4">
          <DnaCategorySelector label={t('agentDetail.formality', 'Formality')} value={formality} options={['casual', 'formal', 'slang']} onChange={setFormality} />
          <DnaCategorySelector label={t('agentDetail.responseLength', 'Response Length')} value={responseLength} options={['short', 'medium', 'long']} onChange={setResponseLength} />
          <DnaCategorySelector label={t('agentDetail.sentiment', 'Sentiment')} value={sentiment} options={['positive', 'neutral', 'cynical']} onChange={setSentiment} />
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-white">{t('agentDetail.voice', 'Voice')}</h3>
        <div className="space-y-4">
          <DnaSlider label={t('agentDetail.voiceSpeed', 'Speed')} value={voiceSpeed} onChange={setVoiceSpeed} />
          <DnaSlider label={t('agentDetail.voicePitch', 'Pitch')} value={voicePitch} onChange={setVoicePitch} />
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold text-white">{t('agentDetail.behavioralRules', 'Behavioral Rules')}</h3>
        <p className="mb-3 text-xs text-neutral-500">
          {t('agentDetail.behavioralRulesHint', 'Define boundaries, trigger responses, and forbidden topics. One rule per line.')}
        </p>
        <textarea
          value={rulesText}
          onChange={(e) => setRulesText(e.target.value)}
          rows={6}
          placeholder={t('agentDetail.rulesPlaceholder', 'e.g. Never break character\nDo not discuss real-world politics\nAlways respond in character voice')}
          className="w-full resize-y rounded border border-neutral-700 bg-neutral-800 px-3 py-2 font-mono text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
        />
      </div>

      <div className="flex justify-end">
        <button
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
          className="rounded-lg bg-white px-5 py-2 text-sm font-medium text-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
        >
          {savingDna ? t('agentDetail.saving', 'Saving...') : t('agentDetail.saveDna', 'Save DNA')}
        </button>
      </div>

      <div className="border-t border-neutral-800 pt-6">
        <h3 className="mb-1 text-sm font-semibold text-white">{t('agentDetail.soulPrime', 'Soul Prime')}</h3>
        <p className="mb-3 text-xs text-neutral-500">
          {t('agentDetail.soulPrimeHint', 'The core system prompt that defines this agent\'s identity and behavior.')}
        </p>
        {soulPrimeLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white" />
          </div>
        ) : (
          <>
            <textarea
              value={soulPrimeText}
              onChange={(e) => setSoulPrimeText(e.target.value)}
              rows={10}
              placeholder={t('agentDetail.soulPrimePlaceholder', "Enter the agent's soul prime / system prompt...")}
              className="w-full resize-y rounded border border-neutral-700 bg-neutral-800 px-3 py-2 font-mono text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
            />
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => { void onSaveSoulPrime({ text: soulPrimeText }); }}
                disabled={savingSoulPrime}
                className="rounded-lg bg-white px-5 py-2 text-sm font-medium text-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
              >
                {savingSoulPrime ? t('agentDetail.saving', 'Saving...') : t('agentDetail.saveSoulPrime', 'Save Soul Prime')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function PreviewTab({ agent }: { agent: AgentDetail }) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Array<{ role: 'agent' | 'user'; text: string }>>(() => (
    agent.greeting ? [{ role: 'agent' as const, text: agent.greeting }] : []
  ));
  const [input, setInput] = useState('');
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [streaming, setStreaming] = useState(false);

  const dnaRecord = toJsonObject(agent.dna);
  const primaryType = String(dnaRecord.primaryType || '—');
  const secondaryTraits = Array.isArray(dnaRecord.secondaryTraits)
    ? (dnaRecord.secondaryTraits as string[]).join(', ')
    : '—';

  function handleResetConversation() {
    setMessages(agent.greeting ? [{ role: 'agent', text: agent.greeting }] : []);
  }

  async function handleSend() {
    if (!input.trim() || streaming) return;
    const userMsg = { role: 'user' as const, text: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setStreaming(true);
    try {
      const { runtime } = getPlatformClient();
      const chatMessages = messages.map((m) => ({
        role: m.role === 'agent' ? 'assistant' as const : 'user' as const,
        content: m.text,
      }));
      chatMessages.push({ role: 'user', content: userMsg.text });

      const systemPrompt = [
        agent.concept ? `Concept: ${agent.concept}` : '',
        agent.scenario ? `Scenario: ${agent.scenario}` : '',
        dnaRecord.primaryType ? `Primary personality: ${String(dnaRecord.primaryType)}` : '',
        secondaryTraits !== '—' ? `Secondary traits: ${secondaryTraits}` : '',
      ].filter(Boolean).join('\n');

      const result = await runtime.ai.text.stream({
        model: 'auto',
        input: chatMessages,
        system: systemPrompt || undefined,
        temperature: 0.8,
        maxTokens: 1024,
      });

      let agentText = '';
      setMessages((prev) => [...prev, { role: 'agent', text: '' }]);
      for await (const part of result.stream) {
        if (part.type === 'delta') {
          agentText += part.text;
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'agent', text: agentText };
            return updated;
          });
        }
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'agent', text: `Error: ${err instanceof Error ? err.message : 'Failed to generate response'}` }]);
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/50">
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-700">
              <span className="text-xs text-neutral-400">
                {(agent.displayName || agent.handle || '?')[0]?.toUpperCase()}
              </span>
            </div>
            <span className="text-sm font-medium text-white">{agent.displayName || agent.handle}</span>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => setShowSystemPrompt((v) => !v)}
              className={`rounded px-2 py-0.5 text-xs transition-colors ${
                showSystemPrompt ? 'bg-neutral-700 text-white' : 'text-neutral-500 hover:bg-neutral-800 hover:text-white'
              }`}
            >
              {t('agentDetail.systemPrompt', 'System Prompt')}
            </button>
            <button
              onClick={handleResetConversation}
              className="rounded px-2 py-0.5 text-xs text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white"
            >
              {t('agentDetail.resetChat', 'Reset')}
            </button>
          </div>
        </div>

        {showSystemPrompt ? (
          <div className="space-y-2 border-b border-neutral-800 bg-neutral-950/50 px-4 py-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-600">
              {t('agentDetail.systemPromptPreview', 'System Prompt Preview')}
            </p>
            <div className="space-y-1 text-xs text-neutral-400">
              <p><span className="text-neutral-600">{t('agentDetail.primaryLabel', 'Primary:')}</span> {primaryType}</p>
              <p><span className="text-neutral-600">{t('agentDetail.secondaryLabel', 'Secondary:')}</span> {secondaryTraits}</p>
              {agent.concept ? <p><span className="text-neutral-600">{t('agentDetail.conceptLabel', 'Concept:')}</span> {agent.concept}</p> : null}
              {agent.scenario ? <p><span className="text-neutral-600">{t('agentDetail.scenarioLabel', 'Scenario:')}</span> {agent.scenario}</p> : null}
            </div>
          </div>
        ) : null}

        <div className="h-80 space-y-3 overflow-auto p-4">
          {messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">{t('agentDetail.noMessages', 'No messages yet')}</p>
          ) : (
            messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${msg.role === 'user' ? 'bg-white text-black' : 'bg-neutral-800 text-white'}`}>
                  {msg.text}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex gap-2 border-t border-neutral-800 p-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={t('agentDetail.chatPlaceholder', 'Type a message...')}
            className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
          />
          <button
            onClick={() => void handleSend()}
            disabled={streaming || !input.trim()}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
          >
            {streaming ? t('agentDetail.streaming', 'Streaming...') : t('agentDetail.send', 'Send')}
          </button>
        </div>
      </div>
    </div>
  );
}

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">{t('agentDetail.apiKeys', 'API Keys')}</h3>
          <p className="mt-0.5 text-xs text-neutral-500">
            {t('agentDetail.apiKeysHint', 'Manage API keys for programmatic access to your agents.')}
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-neutral-200"
        >
          {t('agentDetail.createKey', 'Create Key')}
        </button>
      </div>

      {showForm ? (
        <div className="space-y-3 rounded-lg border border-neutral-700 bg-neutral-900 p-4">
          <FieldGroup label={t('agentDetail.keyName', 'Key Name')}>
            <input
              type="text"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder={t('agentDetail.keyNamePlaceholder', 'e.g. production-key')}
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
            />
          </FieldGroup>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setShowForm(false);
                setKeyName('');
              }}
              className="rounded px-4 py-1.5 text-sm text-neutral-400 transition-colors hover:text-white"
            >
              {t('agentDetail.cancel', 'Cancel')}
            </button>
            <button
              onClick={() => {
                if (!keyName.trim()) return;
                void onCreateKey({ name: keyName.trim() }).then(() => {
                  setKeyName('');
                  setShowForm(false);
                });
              }}
              disabled={creatingKey || !keyName.trim()}
              className="rounded-lg bg-white px-4 py-1.5 text-sm font-medium text-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
            >
              {creatingKey ? t('agentDetail.creating', 'Creating...') : t('agentDetail.create', 'Create')}
            </button>
          </div>
        </div>
      ) : null}

      {keysLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white" />
        </div>
      ) : keys.length === 0 ? (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-8 text-center">
          <p className="text-sm text-neutral-400">{t('agentDetail.noKeys', 'No API keys yet.')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {keys.map((key) => (
            <div key={key.id} className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">{key.name}</p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  <code className="rounded bg-neutral-800 px-1.5 py-0.5">{key.keyPreview}</code>
                  <span className="ml-2">{t('agentDetail.createdAt', 'Created:')} {formatDate(key.createdAt)}</span>
                  {key.lastUsedAt ? <span className="ml-2">{t('agentDetail.lastUsed', 'Last used:')} {formatDate(key.lastUsedAt)}</span> : null}
                  {key.expiresAt ? <span className="ml-2">{t('agentDetail.expiresAt', 'Expires:')} {formatDate(key.expiresAt)}</span> : null}
                </p>
              </div>
              <button
                onClick={() => {
                  if (confirm(t('agentDetail.confirmRevoke', 'Revoke this key? This cannot be undone.'))) {
                    void onRevokeKey(key.id);
                  }
                }}
                className="ml-3 rounded px-3 py-1 text-xs font-medium text-red-400/70 transition-colors hover:bg-red-500/10 hover:text-red-400"
              >
                {t('agentDetail.revoke', 'Revoke')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
