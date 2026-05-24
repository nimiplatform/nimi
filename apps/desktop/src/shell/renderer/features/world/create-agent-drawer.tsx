/**
 * Lightweight RealmAgent creation drawer (T5-3 / D-EXPL-008 ~ D-EXPL-011).
 *
 * Entered from `Explore → World detail → Create Agent`. Replaces the previous
 * single-mode direct-write form with a draft-first surface:
 *
 *   mode select → mode input → draft editor → review → confirm
 *
 * All three creation modes (manual / Character Card import / AI-assisted
 * generation) produce a client-side draft. The draft is locally persisted so a
 * failed creation stays recoverable (D-EXPL-011). The single Realm truth write
 * happens only on the explicit confirm in the review step (D-EXPL-010), via
 * the `onConfirm` callback the parent wires to `dataSync.createAgent`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@nimiplatform/kit/ui';
import {
  clearPersistedDraft,
  createEmptyDraft,
  draftIsSubmittable,
  loadPersistedDraft,
  persistDraft,
  persistedDraftHasContent,
  type RealmAgentCreationDraft,
  type RealmAgentCreationDraftFields,
  type RealmAgentCreationMode,
} from './create-agent/realm-agent-creation-draft.js';
import { importCharacterCardFile } from './create-agent/character-card-draft-mapper.js';
import { generateRealmAgentDraft } from './create-agent/realm-agent-ai-generation.js';
import { CreateAgentDraftEditor } from './create-agent/create-agent-draft-editor.js';
import { CreateAgentReviewPanel } from './create-agent/create-agent-review-panel.js';
import {
  AiAssistedGenerationPanel,
  CharacterCardImportPanel,
  CreateAgentModeSelect,
} from './create-agent/create-agent-mode-panels.js';

/**
 * Confirm payload — the reviewed draft plus the locally selected avatar file
 * (object URLs are not Realm truth; the parent resolves the upload).
 */
export type CreateAgentConfirmInput = {
  draft: RealmAgentCreationDraft;
  avatarFile: File | null;
};

type CreateAgentDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  /** Single Realm truth write — invoked only on explicit user confirm. */
  onConfirm: (input: CreateAgentConfirmInput) => void;
  worldId: string;
  worldName: string;
  worldBannerUrl?: string | null;
  worldDescription?: string | null;
  submitting?: boolean;
  /** Typed creation-rejection feedback (D-EXPL-012); draft stays recoverable. */
  rejectionMessage?: string | null;
};

type DrawerStep = 'mode-select' | 'mode-input' | 'draft-editor' | 'review';

const AVATAR_MAX_BYTES = 10 * 1024 * 1024;

export function CreateAgentDrawer(props: CreateAgentDrawerProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<DrawerStep>('mode-select');
  const [draft, setDraft] = useState<RealmAgentCreationDraft>(() => createEmptyDraft(props.worldId));
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const avatarUrlRef = useRef<string>('');

  const recoverable = useMemo(() => {
    if (!props.isOpen || !props.worldId) {
      return null;
    }
    const persisted = loadPersistedDraft(props.worldId);
    return persistedDraftHasContent(persisted) ? persisted : null;
  }, [props.isOpen, props.worldId]);

  // Reset transient state when the drawer closes. The persisted draft is
  // intentionally NOT cleared here so a failed/abandoned creation stays
  // recoverable (D-EXPL-011) — it is cleared only on a successful Realm write.
  useEffect(() => {
    if (props.isOpen) {
      return;
    }
    if (avatarUrlRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(avatarUrlRef.current);
      avatarUrlRef.current = '';
    }
    setStep('mode-select');
    setDraft(createEmptyDraft(props.worldId));
    setAvatarFile(null);
    setAvatarError(null);
    setImportBusy(false);
    setImportErrors([]);
    setAiBusy(false);
    setAiError(null);
  }, [props.isOpen, props.worldId]);

  // Persist the draft on every change for failed-creation recoverability.
  useEffect(() => {
    if (props.isOpen && step !== 'mode-select') {
      persistDraft(draft);
    }
  }, [draft, props.isOpen, step]);

  const applyDraft = (next: RealmAgentCreationDraft) => {
    setDraft(next);
  };

  const updateField = <K extends keyof RealmAgentCreationDraftFields>(
    key: K,
    value: RealmAgentCreationDraftFields[K],
  ) => {
    setDraft((current) => ({
      ...current,
      fields: { ...current.fields, [key]: value },
      updatedAt: Date.now(),
    }));
  };

  const handleAvatarSelect = (file: File | null | undefined) => {
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      setAvatarError(t('World.createAgent.avatarImageRequired', { defaultValue: 'Please choose an image file.' }));
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError(t('World.createAgent.avatarTooLarge', { defaultValue: 'Avatar image must be 10MB or smaller.' }));
      return;
    }
    if (avatarUrlRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(avatarUrlRef.current);
    }
    const previewUrl = URL.createObjectURL(file);
    avatarUrlRef.current = previewUrl;
    setAvatarError(null);
    setAvatarFile(file);
    updateField('avatarPreviewUrl', previewUrl);
  };

  const handleModeSelect = (mode: RealmAgentCreationMode) => {
    setDraft(createEmptyDraft(props.worldId, mode));
    setImportErrors([]);
    setAiError(null);
    if (mode === 'manual_quick_create') {
      setStep('draft-editor');
      return;
    }
    setStep('mode-input');
  };

  const handleRecoverDraft = () => {
    if (!recoverable) {
      return;
    }
    setDraft(recoverable);
    setStep('draft-editor');
  };

  const handleImport = async (file: File) => {
    setImportBusy(true);
    setImportErrors([]);
    try {
      const outcome = await importCharacterCardFile(props.worldId, file);
      if (!outcome.ok) {
        setImportErrors(outcome.errors);
        return;
      }
      applyDraft(outcome.draft);
      setStep('draft-editor');
    } finally {
      setImportBusy(false);
    }
  };

  const handleGenerate = async (concept: string) => {
    setAiBusy(true);
    setAiError(null);
    try {
      const outcome = await generateRealmAgentDraft(props.worldId, concept);
      if (!outcome.ok) {
        setAiError(outcome.error);
        return;
      }
      applyDraft(outcome.draft);
      setStep('draft-editor');
    } finally {
      setAiBusy(false);
    }
  };

  const canReachReview = draftIsSubmittable(draft);

  const handleConfirm = () => {
    if (!canReachReview || props.submitting) {
      return;
    }
    props.onConfirm({ draft, avatarFile });
  };

  // Step header copy.
  const stepTitle = (() => {
    switch (step) {
      case 'mode-select':
        return t('World.createAgent.step.modeSelect', { defaultValue: 'Create New Agent' });
      case 'mode-input':
        return draft.mode === 'character_card_import'
          ? t('World.createAgent.modes.importTitle', { defaultValue: 'Character Card import' })
          : t('World.createAgent.modes.aiTitle', { defaultValue: 'AI-assisted generation' });
      case 'draft-editor':
        return t('World.createAgent.step.draftEditor', { defaultValue: 'Edit draft' });
      case 'review':
        return t('World.createAgent.step.review', { defaultValue: 'Review & create' });
      default:
        return '';
    }
  })();

  const goBack = () => {
    if (step === 'review') {
      setStep('draft-editor');
      return;
    }
    if (step === 'draft-editor') {
      setStep(draft.mode === 'manual_quick_create' ? 'mode-select' : 'mode-input');
      return;
    }
    if (step === 'mode-input') {
      setStep('mode-select');
    }
  };

  return (
    <div className={`pointer-events-none fixed inset-0 z-50 ${props.isOpen ? '' : 'hidden'}`}>
      <div
        className={`absolute inset-0 bg-black/55 transition-opacity duration-300 ${props.isOpen ? 'opacity-100' : 'opacity-0'}`}
        onClick={props.onClose}
      />
      <aside
        className={`pointer-events-auto absolute right-0 top-12 flex h-[calc(100vh-3rem)] w-full max-w-[40vw] min-w-[420px] flex-col rounded-tl-[28px] nimi-material-glass-thick border-l border-t border-emerald-400/25 bg-[#0B1313]/85 shadow-[-24px_0_60px_rgba(0,0,0,0.45)] backdrop-blur-[var(--nimi-backdrop-blur-strong)] transition-transform duration-300 ease-out ${props.isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-emerald-300/70 to-transparent shadow-[0_0_20px_rgba(16,185,129,0.45)]" />

        <header className="sticky top-0 z-10 overflow-hidden nimi-material-glass-thick border-b border-emerald-400/12 bg-[#0B1313]/80 px-7 py-6 backdrop-blur-[var(--nimi-backdrop-blur-strong)]">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(16,185,129,0.18)_0%,rgba(16,185,129,0.08)_28%,rgba(11,19,19,0.12)_62%,rgba(11,19,19,0)_100%)]" />
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              {step !== 'mode-select' ? (
                <button
                  type="button"
                  onClick={goBack}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-400/18 bg-white/5 text-[#D9FFF2] transition hover:border-emerald-300/40 hover:bg-emerald-400/10"
                  aria-label={t('World.createAgent.back', { defaultValue: 'Back' })}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
              ) : null}
              <div>
                <h2 className="text-2xl font-semibold tracking-[0.01em] text-[#F2FFF9]">{stepTitle}</h2>
                <p className="mt-1 text-sm text-[#A0C7BA]">
                  {t('World.createAgent.subtitle', {
                    worldName: props.worldName,
                    defaultValue: 'Bring a new character to life in {{worldName}}',
                  })}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-emerald-400/18 bg-white/5 text-[#D9FFF2] transition hover:border-emerald-300/40 hover:bg-emerald-400/10 hover:text-white"
              aria-label={t('World.createAgent.close', { defaultValue: 'Close create agent drawer' })}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </header>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-6 px-7 pb-24 pt-6">
            {props.rejectionMessage ? (
              <div className="rounded-2xl border border-red-400/30 bg-red-400/[0.08] px-4 py-3">
                <p className="text-sm font-medium text-red-200">
                  {t('World.createAgent.rejection.title', { defaultValue: 'Creation could not be completed' })}
                </p>
                <p className="mt-1 text-xs leading-5 text-red-100/85">{props.rejectionMessage}</p>
                <p className="mt-1 text-xs leading-5 text-[#A0C7BA]">
                  {t('World.createAgent.rejection.recoverable', {
                    defaultValue: 'Your draft is kept — adjust it and try again.',
                  })}
                </p>
              </div>
            ) : null}

            {step === 'mode-select' ? (
              <CreateAgentModeSelect
                onSelect={handleModeSelect}
                recoverableDraft={Boolean(recoverable)}
                onRecoverDraft={handleRecoverDraft}
              />
            ) : null}

            {step === 'mode-input' && draft.mode === 'character_card_import' ? (
              <CharacterCardImportPanel busy={importBusy} errors={importErrors} onImport={handleImport} />
            ) : null}

            {step === 'mode-input' && draft.mode === 'ai_assisted_generation' ? (
              <AiAssistedGenerationPanel busy={aiBusy} error={aiError} onGenerate={handleGenerate} />
            ) : null}

            {step === 'draft-editor' ? (
              <>
                {draft.warnings.length > 0 ? (
                  <div className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3">
                    <p className="text-sm font-medium text-amber-200">
                      {t('World.createAgent.review.warningsTitle', {
                        count: draft.warnings.length,
                        defaultValue: '{{count}} warning(s)',
                      })}
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {draft.warnings.map((warning, index) => (
                        <li key={`${warning.field}-${index}`} className="text-xs leading-5 text-amber-100/85">
                          • {warning.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <CreateAgentDraftEditor
                  fields={draft.fields}
                  onFieldChange={updateField}
                  onAvatarSelect={handleAvatarSelect}
                  avatarError={avatarError}
                />
              </>
            ) : null}

            {step === 'review' ? (
              <CreateAgentReviewPanel draft={draft} worldName={props.worldName} />
            ) : null}
          </div>
        </ScrollArea>

        <footer className="sticky bottom-0 z-10 nimi-material-glass-thick border-t border-emerald-400/12 bg-[#0B1313]/80 px-7 py-5 backdrop-blur-[var(--nimi-backdrop-blur-strong)]">
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={props.onClose}
              className="inline-flex h-11 items-center justify-center rounded-full border border-white/10 bg-transparent px-5 text-sm font-medium text-[#C4DED5] transition hover:border-white/20 hover:bg-white/5 hover:text-white"
            >
              {t('World.createAgent.cancel', { defaultValue: 'Cancel' })}
            </button>
            {step === 'draft-editor' ? (
              <button
                type="button"
                disabled={!canReachReview}
                onClick={() => setStep('review')}
                className="inline-flex h-11 items-center justify-center rounded-full bg-emerald-300 px-6 text-sm font-semibold text-[#05110E] shadow-[0_0_18px_rgba(0,255,170,0.45)] transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:bg-emerald-300/25 disabled:text-[#05110E]/45 disabled:shadow-none"
              >
                {t('World.createAgent.toReview', { defaultValue: 'Review draft' })}
              </button>
            ) : null}
            {step === 'review' ? (
              <button
                type="button"
                disabled={!canReachReview || props.submitting}
                onClick={handleConfirm}
                className="inline-flex h-11 items-center justify-center rounded-full bg-emerald-300 px-6 text-sm font-semibold text-[#05110E] shadow-[0_0_18px_rgba(0,255,170,0.45)] transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:bg-emerald-300/25 disabled:text-[#05110E]/45 disabled:shadow-none"
              >
                {props.submitting
                  ? t('World.createAgent.creating', { defaultValue: 'Creating...' })
                  : t('World.createAgent.confirmCreate', { defaultValue: 'Confirm & create agent' })}
              </button>
            ) : null}
          </div>
        </footer>
      </aside>
    </div>
  );
}

/** Clear the locally persisted draft after a successful Realm write. */
export function clearCreateAgentDraft(worldId: string): void {
  clearPersistedDraft(worldId);
}
