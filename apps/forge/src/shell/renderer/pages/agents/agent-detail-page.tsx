/**
 * Agent Detail Page — tabbed view (FG-AGENT-001/002/003/004)
 */

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  useAgentDetailQuery,
  useAgentSoulPrimeQuery,
  useCreatorKeysQuery,
  type AgentDetail,
  type CreatorKeyItem,
} from '@renderer/hooks/use-agent-queries.js';
import { useAgentMutations } from '@renderer/hooks/use-agent-mutations.js';
import {
  DNA_PRIMARY_TYPES,
  DNA_SECONDARY_TRAITS,
} from '@world-engine/services/agent-dna-traits.js';
import { getPlatformClient } from '@runtime/platform-client.js';

type TabId = 'profile' | 'dna' | 'preview' | 'keys';

function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export default function AgentDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agentId } = useParams<{ agentId: string }>();

  const [activeTab, setActiveTab] = useState<TabId>('profile');

  const agentQuery = useAgentDetailQuery(agentId || '');
  const soulPrimeQuery = useAgentSoulPrimeQuery(agentId || '');
  const keysQuery = useCreatorKeysQuery();
  const mutations = useAgentMutations();
  const queryClient = useQueryClient();

  const agent = agentQuery.data;

  if (!agentId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-neutral-400">No agent ID provided</p>
      </div>
    );
  }

  if (agentQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-neutral-400">Agent not found</p>
      </div>
    );
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: 'profile', label: t('agentDetail.tabProfile', 'Profile') },
    { id: 'dna', label: t('agentDetail.tabDna', 'DNA') },
    { id: 'preview', label: t('agentDetail.tabPreview', 'Preview') },
    { id: 'keys', label: t('agentDetail.tabKeys', 'Keys') },
  ];

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/agents')}
            className="rounded px-2 py-1 text-sm text-neutral-400 hover:text-white transition-colors"
          >
            &larr; {t('agents.backToList', 'Back')}
          </button>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="h-10 w-10 flex-shrink-0 rounded-full bg-neutral-800 flex items-center justify-center overflow-hidden">
              {agent.avatarUrl ? (
                <img src={agent.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-lg text-neutral-500">
                  {(agent.displayName || agent.handle || '?')[0]?.toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-white truncate">
                {agent.displayName || agent.handle}
              </h1>
              <p className="text-xs text-neutral-500">@{agent.handle}</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-neutral-800">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'border-white text-white'
                  : 'border-transparent text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'profile' && (
          <ProfileTab
            agent={agent}
            onSave={async (updates) => {
              await mutations.updateDnaMutation.mutateAsync({
                agentId,
                dna: updates,
              });
              await queryClient.invalidateQueries({ queryKey: ['forge', 'agents', 'detail', agentId] });
            }}
            saving={mutations.updateDnaMutation.isPending}
          />
        )}
        {activeTab === 'dna' && (
          <DnaTab
            agentId={agentId}
            dna={agent.dna}
            soulPrime={soulPrimeQuery.data || null}
            soulPrimeLoading={soulPrimeQuery.isLoading}
            onSaveDna={async (dna) => {
              await mutations.updateDnaMutation.mutateAsync({ agentId, dna });
              await queryClient.invalidateQueries({ queryKey: ['forge', 'agents', 'detail', agentId] });
            }}
            onSaveSoulPrime={async (soulPrime) => {
              await mutations.updateSoulPrimeMutation.mutateAsync({ agentId, soulPrime });
              await queryClient.invalidateQueries({ queryKey: ['forge', 'agents', 'soul-prime', agentId] });
            }}
            savingDna={mutations.updateDnaMutation.isPending}
            savingSoulPrime={mutations.updateSoulPrimeMutation.isPending}
          />
        )}
        {activeTab === 'preview' && <PreviewTab agent={agent} />}
        {activeTab === 'keys' && (
          <KeysTab
            keys={keysQuery.data || []}
            keysLoading={keysQuery.isLoading}
            onCreateKey={async (payload) => {
              await mutations.createKeyMutation.mutateAsync(payload);
              await queryClient.invalidateQueries({ queryKey: ['forge', 'creator', 'keys'] });
            }}
            onRevokeKey={async (keyId) => {
              await mutations.revokeKeyMutation.mutateAsync(keyId);
              await queryClient.invalidateQueries({ queryKey: ['forge', 'creator', 'keys'] });
            }}
            creatingKey={mutations.createKeyMutation.isPending}
          />
        )}
      </div>
    </div>
  );
}

// ── Profile Tab ──────────────────────────────────────────────

function ProfileTab({
  agent,
  onSave,
  saving,
}: {
  agent: AgentDetail;
  onSave: (updates: Record<string, unknown>) => Promise<void>;
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
      {/* Status bar */}
      <div className="flex items-center gap-3 text-xs text-neutral-500">
        <span>Status: <strong className="text-neutral-300">{agent.status}</strong></span>
        <span>State: <strong className="text-neutral-300">{agent.state}</strong></span>
        <span>Ownership: <strong className="text-neutral-300">{agent.ownershipType === 'WORLD_OWNED' ? 'World' : 'Master'}</strong></span>
        {agent.worldId && <span>World: <strong className="text-neutral-300">{agent.worldId}</strong></span>}
        <span>Created: {formatDate(agent.createdAt)}</span>
        <span>Updated: {formatDate(agent.updatedAt)}</span>
      </div>

      {/* Editable fields */}
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
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none resize-none"
          />
        </FieldGroup>

        <FieldGroup label={t('agentDetail.description', 'Description')}>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Detailed description of the agent..."
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none resize-none"
          />
        </FieldGroup>

        <FieldGroup label={t('agentDetail.scenario', 'Scenario')}>
          <textarea
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            rows={3}
            placeholder="The scenario or setting for this agent..."
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none resize-none"
          />
        </FieldGroup>

        <FieldGroup label={t('agentDetail.greeting', 'Greeting')}>
          <textarea
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            rows={2}
            placeholder="The first message the agent sends..."
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none resize-none"
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
                {strategy}
              </button>
            ))}
          </div>
        </FieldGroup>
      </div>

      {/* Save */}
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
          className="rounded-lg bg-white px-5 py-2 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50 transition-colors"
        >
          {saving ? t('agentDetail.saving', 'Saving...') : t('agentDetail.saveProfile', 'Save Profile')}
        </button>
      </div>
    </div>
  );
}

// ── DNA Tab ──────────────────────────────────────────────────

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
      <span className="text-xs text-neutral-400 w-28 shrink-0">{label}</span>
      <div className="flex gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors capitalize ${
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
      <span className="text-xs text-neutral-400 w-28 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1.5 rounded-full appearance-none bg-neutral-700 accent-white cursor-pointer"
      />
      <span className="text-xs text-neutral-400 w-8 text-right tabular-nums">{value}</span>
    </div>
  );
}

function DnaTab({
  agentId,
  dna,
  soulPrime,
  soulPrimeLoading,
  onSaveDna,
  onSaveSoulPrime,
  savingDna,
  savingSoulPrime,
}: {
  agentId: string;
  dna: Record<string, unknown> | null;
  soulPrime: Record<string, unknown> | null;
  soulPrimeLoading: boolean;
  onSaveDna: (dna: Record<string, unknown>) => Promise<void>;
  onSaveSoulPrime: (soulPrime: Record<string, unknown>) => Promise<void>;
  savingDna: boolean;
  savingSoulPrime: boolean;
}) {
  const { t } = useTranslation();
  const currentPrimary = String(dna?.primaryType || '');
  const currentSecondary = Array.isArray(dna?.secondaryTraits)
    ? (dna.secondaryTraits as string[])
    : [];
  const commRecord = dna?.communication && typeof dna.communication === 'object'
    ? (dna.communication as Record<string, unknown>)
    : {};
  const currentFormality = String(commRecord.formality || 'casual');
  const currentResponseLength = String(commRecord.responseLength || 'medium');
  const currentSentiment = String(commRecord.sentiment || 'neutral');
  const voiceRecord = dna?.voice && typeof dna.voice === 'object'
    ? (dna.voice as Record<string, unknown>)
    : {};
  const currentSpeed = Number(voiceRecord.speed) || 50;
  const currentPitch = Number(voiceRecord.pitch) || 50;
  const rulesRecord = dna?.rules && typeof dna.rules === 'object'
    ? (dna.rules as Record<string, unknown>)
    : {};
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

  // Initialize soul prime text when data loads
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
      {/* Primary Type */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-white">
            {t('agentDetail.primaryType', 'Primary Personality Type')}
          </h3>
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                const randomIdx = Math.floor(Math.random() * DNA_PRIMARY_TYPES.length);
                setPrimaryType(DNA_PRIMARY_TYPES[randomIdx]!);
              }}
              className="rounded px-2 py-0.5 text-xs text-neutral-500 hover:text-white hover:bg-neutral-800 transition-colors"
              title="Randomize"
            >
              Randomize
            </button>
            <button
              onClick={() => setPrimaryType(currentPrimary)}
              className="rounded px-2 py-0.5 text-xs text-neutral-500 hover:text-white hover:bg-neutral-800 transition-colors"
              title="Reset to saved value"
            >
              Reset
            </button>
          </div>
        </div>
        <p className="text-xs text-neutral-500 mb-3">
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

      {/* Secondary Traits */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-white">
            {t('agentDetail.secondaryTraits', 'Secondary Traits')}
            <span className="ml-2 text-xs font-normal text-neutral-500">
              ({secondaryTraits.length}/3)
            </span>
          </h3>
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                const shuffled = [...DNA_SECONDARY_TRAITS].sort(() => Math.random() - 0.5);
                setSecondaryTraits(shuffled.slice(0, 3));
              }}
              className="rounded px-2 py-0.5 text-xs text-neutral-500 hover:text-white hover:bg-neutral-800 transition-colors"
              title="Randomize"
            >
              Randomize
            </button>
            <button
              onClick={() => setSecondaryTraits(currentSecondary)}
              className="rounded px-2 py-0.5 text-xs text-neutral-500 hover:text-white hover:bg-neutral-800 transition-colors"
              title="Reset to saved value"
            >
              Reset
            </button>
          </div>
        </div>
        <p className="text-xs text-neutral-500 mb-3">
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

      {/* Communication Style */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-3">
          {t('agentDetail.communicationStyle', 'Communication Style')}
        </h3>
        <div className="space-y-4">
          <DnaCategorySelector
            label={t('agentDetail.formality', 'Formality')}
            value={formality}
            options={['casual', 'formal', 'slang']}
            onChange={setFormality}
          />
          <DnaCategorySelector
            label={t('agentDetail.responseLength', 'Response Length')}
            value={responseLength}
            options={['short', 'medium', 'long']}
            onChange={setResponseLength}
          />
          <DnaCategorySelector
            label={t('agentDetail.sentiment', 'Sentiment')}
            value={sentiment}
            options={['positive', 'neutral', 'cynical']}
            onChange={setSentiment}
          />
        </div>
      </div>

      {/* Voice */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-3">
          {t('agentDetail.voice', 'Voice')}
        </h3>
        <div className="space-y-4">
          <DnaSlider
            label={t('agentDetail.voiceSpeed', 'Speed')}
            value={voiceSpeed}
            onChange={setVoiceSpeed}
          />
          <DnaSlider
            label={t('agentDetail.voicePitch', 'Pitch')}
            value={voicePitch}
            onChange={setVoicePitch}
          />
        </div>
      </div>

      {/* Behavioral Rules */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-1">
          {t('agentDetail.behavioralRules', 'Behavioral Rules')}
        </h3>
        <p className="text-xs text-neutral-500 mb-3">
          {t('agentDetail.behavioralRulesHint', 'Define boundaries, trigger responses, and forbidden topics. One rule per line.')}
        </p>
        <textarea
          value={rulesText}
          onChange={(e) => setRulesText(e.target.value)}
          rows={6}
          placeholder="e.g. Never break character\nDo not discuss real-world politics\nAlways respond in character voice"
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none resize-y font-mono"
        />
      </div>

      {/* Save DNA */}
      <div className="flex justify-end">
        <button
          onClick={() => {
            const rulesLines = rulesText.split('\n').map((l) => l.trim()).filter(Boolean);
            void onSaveDna({
              ...(dna || {}),
              primaryType: primaryType || undefined,
              secondaryTraits,
              communication: {
                ...commRecord,
                formality,
                responseLength,
                sentiment,
              },
              voice: {
                ...voiceRecord,
                speed: voiceSpeed,
                pitch: voicePitch,
              },
              rules: {
                format: 'rule-lines-v1',
                lines: rulesLines,
                text: rulesText,
              },
            });
          }}
          disabled={savingDna || !dnaDirty}
          className="rounded-lg bg-white px-5 py-2 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50 transition-colors"
        >
          {savingDna ? t('agentDetail.saving', 'Saving...') : t('agentDetail.saveDna', 'Save DNA')}
        </button>
      </div>

      {/* Soul Prime */}
      <div className="border-t border-neutral-800 pt-6">
        <h3 className="text-sm font-semibold text-white mb-1">
          {t('agentDetail.soulPrime', 'Soul Prime')}
        </h3>
        <p className="text-xs text-neutral-500 mb-3">
          {t('agentDetail.soulPrimeHint', 'The core system prompt that defines this agent\'s identity and behavior.')}
        </p>
        {soulPrimeLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <textarea
              value={soulPrimeText}
              onChange={(e) => setSoulPrimeText(e.target.value)}
              rows={10}
              placeholder="Enter the agent's soul prime / system prompt..."
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none resize-y font-mono"
            />
            <div className="flex justify-end mt-3">
              <button
                onClick={() => {
                  void onSaveSoulPrime({ text: soulPrimeText });
                }}
                disabled={savingSoulPrime}
                className="rounded-lg bg-white px-5 py-2 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50 transition-colors"
              >
                {savingSoulPrime
                  ? t('agentDetail.saving', 'Saving...')
                  : t('agentDetail.saveSoulPrime', 'Save Soul Prime')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Preview Tab ──────────────────────────────────────────────

function PreviewTab({ agent }: { agent: AgentDetail }) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Array<{ role: 'agent' | 'user'; text: string }>>(() => {
    if (agent.greeting) {
      return [{ role: 'agent' as const, text: agent.greeting }];
    }
    return [];
  });
  const [input, setInput] = useState('');
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [streaming, setStreaming] = useState(false);

  const dnaRecord = agent.dna && typeof agent.dna === 'object' ? agent.dna : {};
  const primaryType = String(dnaRecord.primaryType || '—');
  const secondaryTraits = Array.isArray(dnaRecord.secondaryTraits)
    ? (dnaRecord.secondaryTraits as string[]).join(', ')
    : '—';

  function handleResetConversation() {
    if (agent.greeting) {
      setMessages([{ role: 'agent', text: agent.greeting }]);
    } else {
      setMessages([]);
    }
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
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 overflow-hidden">
        {/* Chat header */}
        <div className="border-b border-neutral-800 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-neutral-700 flex items-center justify-center">
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
                showSystemPrompt
                  ? 'bg-neutral-700 text-white'
                  : 'text-neutral-500 hover:text-white hover:bg-neutral-800'
              }`}
            >
              {t('agentDetail.systemPrompt', 'System Prompt')}
            </button>
            <button
              onClick={handleResetConversation}
              className="rounded px-2 py-0.5 text-xs text-neutral-500 hover:text-white hover:bg-neutral-800 transition-colors"
            >
              {t('agentDetail.resetChat', 'Reset')}
            </button>
          </div>
        </div>

        {/* System prompt preview */}
        {showSystemPrompt && (
          <div className="border-b border-neutral-800 bg-neutral-950/50 px-4 py-3 space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-neutral-600 font-medium">
              {t('agentDetail.systemPromptPreview', 'System Prompt Preview')}
            </p>
            <div className="text-xs text-neutral-400 space-y-1">
              <p><span className="text-neutral-600">Primary:</span> {primaryType}</p>
              <p><span className="text-neutral-600">Secondary:</span> {secondaryTraits}</p>
              {agent.concept && (
                <p><span className="text-neutral-600">Concept:</span> {agent.concept}</p>
              )}
              {agent.scenario && (
                <p><span className="text-neutral-600">Scenario:</span> {agent.scenario}</p>
              )}
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="h-80 overflow-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <p className="text-center text-sm text-neutral-500 py-8">
              {t('agentDetail.noMessages', 'No messages yet')}
            </p>
          ) : (
            messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`rounded-lg px-3 py-2 text-sm max-w-[80%] ${
                    msg.role === 'user'
                      ? 'bg-white text-black'
                      : 'bg-neutral-800 text-white'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Input */}
        <div className="border-t border-neutral-800 p-3 flex gap-2">
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
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50 transition-colors"
          >
            {streaming ? t('agentDetail.streaming', 'Streaming...') : t('agentDetail.send', 'Send')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Keys Tab ─────────────────────────────────────────────────

function KeysTab({
  keys,
  keysLoading,
  onCreateKey,
  onRevokeKey,
  creatingKey,
}: {
  keys: CreatorKeyItem[];
  keysLoading: boolean;
  onCreateKey: (payload: Record<string, unknown>) => Promise<void>;
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
          <h3 className="text-sm font-semibold text-white">
            {t('agentDetail.apiKeys', 'API Keys')}
          </h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            {t('agentDetail.apiKeysHint', 'Manage API keys for programmatic access to your agents.')}
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200 transition-colors"
        >
          {t('agentDetail.createKey', 'Create Key')}
        </button>
      </div>

      {/* Create key form */}
      {showForm && (
        <div className="rounded-lg border border-neutral-700 bg-neutral-900 p-4 space-y-3">
          <FieldGroup label={t('agentDetail.keyName', 'Key Name')}>
            <input
              type="text"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="e.g. production-key"
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
            />
          </FieldGroup>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setShowForm(false); setKeyName(''); }}
              className="rounded px-4 py-1.5 text-sm text-neutral-400 hover:text-white transition-colors"
            >
              Cancel
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
              className="rounded-lg bg-white px-4 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50 transition-colors"
            >
              {creatingKey ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Key list */}
      {keysLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      ) : keys.length === 0 ? (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-8 text-center">
          <p className="text-neutral-400 text-sm">
            {t('agentDetail.noKeys', 'No API keys yet.')}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {keys.map((key) => (
            <div
              key={key.id}
              className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">{key.name}</p>
                <p className="text-xs text-neutral-500 mt-0.5">
                  <code className="bg-neutral-800 rounded px-1.5 py-0.5">{key.keyPreview}</code>
                  <span className="ml-2">Created: {formatDate(key.createdAt)}</span>
                  {key.lastUsedAt && <span className="ml-2">Last used: {formatDate(key.lastUsedAt)}</span>}
                  {key.expiresAt && <span className="ml-2">Expires: {formatDate(key.expiresAt)}</span>}
                </p>
              </div>
              <button
                onClick={() => {
                  if (confirm('Revoke this key? This cannot be undone.')) {
                    void onRevokeKey(key.id);
                  }
                }}
                className="ml-3 rounded px-3 py-1 text-xs font-medium text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-colors"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shared ───────────────────────────────────────────────────

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-neutral-400 mb-1">{label}</label>
      {children}
    </div>
  );
}
