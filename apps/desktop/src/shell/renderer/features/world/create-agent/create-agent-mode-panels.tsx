/**
 * Mode-entry panels for lightweight RealmAgent creation (D-EXPL-008).
 *
 * - Mode select: pick one of the three admitted creation modes.
 * - Character Card import: choose a file; Nimi parses it locally.
 * - AI-assisted generation: describe a concept; Nimi generates a candidate.
 *
 * All three modes converge on a reviewable draft; these panels only collect
 * the mode-specific input that produces / pre-fills that draft.
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RealmAgentCreationMode } from './realm-agent-creation-draft.js';
import { CardPanel } from './create-agent-primitives.js';

const MODES: Array<{
  mode: RealmAgentCreationMode;
  titleKey: string;
  titleDefault: string;
  descKey: string;
  descDefault: string;
}> = [
  {
    mode: 'manual_quick_create',
    titleKey: 'World.createAgent.modes.manualTitle',
    titleDefault: 'Manual quick create',
    descKey: 'World.createAgent.modes.manualDesc',
    descDefault: 'Fill the agent fields yourself.',
  },
  {
    mode: 'character_card_import',
    titleKey: 'World.createAgent.modes.importTitle',
    titleDefault: 'Character Card import',
    descKey: 'World.createAgent.modes.importDesc',
    descDefault: 'Import a Character Card file; Nimi parses it locally.',
  },
  {
    mode: 'ai_assisted_generation',
    titleKey: 'World.createAgent.modes.aiTitle',
    titleDefault: 'AI-assisted generation',
    descKey: 'World.createAgent.modes.aiDesc',
    descDefault: 'Describe the concept; Nimi generates a candidate draft.',
  },
];

export function CreateAgentModeSelect(props: {
  onSelect: (mode: RealmAgentCreationMode) => void;
  recoverableDraft: boolean;
  onRecoverDraft: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      {props.recoverableDraft ? (
        <button
          type="button"
          onClick={props.onRecoverDraft}
          className="w-full rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.08] px-4 py-3 text-left transition hover:border-emerald-300/50 hover:bg-emerald-400/[0.12]"
        >
          <p className="text-sm font-medium text-emerald-200">
            {t('World.createAgent.recover.title', { defaultValue: 'Recover unfinished draft' })}
          </p>
          <p className="mt-1 text-xs text-[#A0C7BA]">
            {t('World.createAgent.recover.description', {
              defaultValue: 'A previous creation draft for this World was not finished. Resume it.',
            })}
          </p>
        </button>
      ) : null}
      <p className="text-sm text-[#A0C7BA]">
        {t('World.createAgent.modes.prompt', { defaultValue: 'Choose how to start this agent.' })}
      </p>
      <div className="space-y-3">
        {MODES.map((entry) => (
          <button
            key={entry.mode}
            type="button"
            onClick={() => props.onSelect(entry.mode)}
            className="w-full rounded-2xl border border-white/8 bg-white/[0.04] px-5 py-4 text-left transition hover:border-emerald-300/35 hover:bg-white/[0.06]"
          >
            <p className="text-sm font-semibold text-[#E8FFF6]">{t(entry.titleKey, { defaultValue: entry.titleDefault })}</p>
            <p className="mt-1 text-xs leading-5 text-[#9CC8B5]">{t(entry.descKey, { defaultValue: entry.descDefault })}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

export function CharacterCardImportPanel(props: {
  busy: boolean;
  errors: string[];
  onImport: (file: File) => void;
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-5">
      <p className="text-sm text-[#A0C7BA]">
        {t('World.createAgent.import.prompt', {
          defaultValue: 'Select a Character Card V2 (.json) file. Nimi parses it locally and maps it to a draft you can review.',
        })}
      </p>
      <CardPanel>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) {
              props.onImport(file);
            }
          }}
        />
        <button
          type="button"
          disabled={props.busy}
          onClick={() => fileInputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-emerald-400/30 bg-emerald-400/[0.04] px-6 py-10 text-center transition hover:border-emerald-300/55 hover:bg-emerald-400/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-300">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span className="text-sm font-medium text-emerald-200">
            {props.busy
              ? t('World.createAgent.import.parsing', { defaultValue: 'Parsing card...' })
              : t('World.createAgent.import.choose', { defaultValue: 'Choose Character Card file' })}
          </span>
        </button>
      </CardPanel>
      {props.errors.length > 0 ? (
        <div className="rounded-2xl border border-red-400/25 bg-red-400/[0.07] px-4 py-3">
          <p className="text-sm font-medium text-red-200">
            {t('World.createAgent.import.failed', { defaultValue: 'Could not import this card' })}
          </p>
          <ul className="mt-2 space-y-1">
            {props.errors.map((error, index) => (
              <li key={index} className="text-xs leading-5 text-red-100/85">• {error}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function AiAssistedGenerationPanel(props: {
  busy: boolean;
  error: string | null;
  onGenerate: (concept: string) => void;
}) {
  const { t } = useTranslation();
  const [concept, setConcept] = useState('');

  return (
    <div className="space-y-5">
      <p className="text-sm text-[#A0C7BA]">
        {t('World.createAgent.ai.prompt', {
          defaultValue: 'Describe the agent you want. Nimi generates a candidate draft for you to review and edit.',
        })}
      </p>
      <CardPanel>
        <textarea
          rows={5}
          value={concept}
          onChange={(event) => setConcept(event.target.value)}
          placeholder={t('World.createAgent.ai.placeholder', {
            defaultValue: 'e.g. A wandering cartographer who collects forgotten star maps and speaks in riddles.',
          })}
          className="w-full resize-none rounded-2xl border border-emerald-300/16 bg-white/5 px-4 py-3 text-sm text-[#E8FFF6] outline-none transition-all placeholder:text-[#9CC8B5]/35 focus:border-emerald-300/60 focus:bg-white/[0.07]"
        />
      </CardPanel>
      <button
        type="button"
        disabled={props.busy || concept.trim().length === 0}
        onClick={() => props.onGenerate(concept)}
        className="inline-flex h-11 w-full items-center justify-center rounded-full bg-emerald-300 px-6 text-sm font-semibold text-[#05110E] shadow-[0_0_18px_rgba(0,255,170,0.45)] transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:bg-emerald-300/25 disabled:text-[#05110E]/45 disabled:shadow-none"
      >
        {props.busy
          ? t('World.createAgent.ai.generating', { defaultValue: 'Generating draft...' })
          : t('World.createAgent.ai.generate', { defaultValue: 'Generate draft' })}
      </button>
      {props.error ? (
        <div className="rounded-2xl border border-red-400/25 bg-red-400/[0.07] px-4 py-3">
          <p className="text-xs leading-5 text-red-100/85">{props.error}</p>
        </div>
      ) : null}
    </div>
  );
}
