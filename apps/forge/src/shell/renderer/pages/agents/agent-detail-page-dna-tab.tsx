import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DNA_PRIMARY_TYPES,
  DNA_SECONDARY_TRAITS,
} from '@world-engine/services/agent-dna-traits.js';

type DnaTabProps = {
  agentId: string;
  dna: Record<string, unknown> | null;
  soulPrime: Record<string, unknown> | null;
  soulPrimeLoading: boolean;
  onSaveDna: (dna: Record<string, unknown>) => Promise<void>;
  onSaveSoulPrime: (soulPrime: Record<string, unknown>) => Promise<void>;
  savingDna: boolean;
  savingSoulPrime: boolean;
};

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

export function DnaTab({
  dna,
  soulPrime,
  soulPrimeLoading,
  onSaveDna,
  onSaveSoulPrime,
  savingDna,
  savingSoulPrime,
}: DnaTabProps) {
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
          <h3 className="text-sm font-semibold text-white">
            {t('agentDetail.primaryType', 'Primary Personality Type')}
          </h3>
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
        <h3 className="mb-3 text-sm font-semibold text-white">
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

      <div>
        <h3 className="mb-3 text-sm font-semibold text-white">
          {t('agentDetail.voice', 'Voice')}
        </h3>
        <div className="space-y-4">
          <DnaSlider label={t('agentDetail.voiceSpeed', 'Speed')} value={voiceSpeed} onChange={setVoiceSpeed} />
          <DnaSlider label={t('agentDetail.voicePitch', 'Pitch')} value={voicePitch} onChange={setVoicePitch} />
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold text-white">
          {t('agentDetail.behavioralRules', 'Behavioral Rules')}
        </h3>
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
            const rulesLines = rulesText.split('\n').map((line) => line.trim()).filter(Boolean);
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
          className="rounded-lg bg-white px-5 py-2 text-sm font-medium text-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
        >
          {savingDna ? t('agentDetail.saving', 'Saving...') : t('agentDetail.saveDna', 'Save DNA')}
        </button>
      </div>

      <div className="border-t border-neutral-800 pt-6">
        <h3 className="mb-1 text-sm font-semibold text-white">
          {t('agentDetail.soulPrime', 'Soul Prime')}
        </h3>
        <p className="mb-3 text-xs text-neutral-500">
          {t('agentDetail.soulPrimeHint', "The core system prompt that defines this agent's identity and behavior.")}
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
                onClick={() => {
                  void onSaveSoulPrime({ text: soulPrimeText });
                }}
                disabled={savingSoulPrime}
                className="rounded-lg bg-white px-5 py-2 text-sm font-medium text-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
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
