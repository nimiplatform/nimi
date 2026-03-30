import { useTranslation } from 'react-i18next';

type CreateBatchPolicyPanelProps = {
  imageTargets: Array<{ key: string; label: string }>;
  visionTargets: Array<{ key: string; label: string }>;
  generationTargetKey: string;
  evaluationTargetKey: string;
  scoreThreshold: string;
  maxConcurrency: string;
  saving: boolean;
  disabled: boolean;
  error: string | null;
  onGenerationTargetChange(value: string): void;
  onEvaluationTargetChange(value: string): void;
  onScoreThresholdChange(value: string): void;
  onMaxConcurrencyChange(value: string): void;
  onCreate(): void;
};

export function CreateBatchPolicyPanel(props: CreateBatchPolicyPanelProps) {
  const { t } = useTranslation();
  const {
    imageTargets,
    visionTargets,
    generationTargetKey,
    evaluationTargetKey,
    scoreThreshold,
    maxConcurrency,
    saving,
    disabled,
    error,
    onGenerationTargetChange,
    onEvaluationTargetChange,
    onScoreThresholdChange,
    onMaxConcurrencyChange,
    onCreate,
  } = props;

  return (
    <section className="ld-card px-7 py-7">
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-[0.2em] text-[var(--ld-gold)]">{t('createBatch.policyEyebrow')}</div>
        <h3 className="text-2xl font-semibold text-white">{t('createBatch.policyTitle')}</h3>
      </div>

      <div className="mt-8 grid gap-5">
        <div className="grid gap-2">
          <label htmlFor="lookdev-generation-target" className="text-sm text-white/74">{t('createBatch.generationTarget')}</label>
          <select
            id="lookdev-generation-target"
            value={generationTargetKey}
            onChange={(event) => onGenerationTargetChange(event.target.value)}
            className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
          >
            <option value="">{t('createBatch.selectGenerationTarget')}</option>
            {imageTargets.map((target) => (
              <option key={target.key} value={target.key}>{target.label}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-2">
          <label htmlFor="lookdev-evaluation-target" className="text-sm text-white/74">{t('createBatch.evaluationTarget')}</label>
          <select
            id="lookdev-evaluation-target"
            value={evaluationTargetKey}
            onChange={(event) => onEvaluationTargetChange(event.target.value)}
            className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
          >
            <option value="">{t('createBatch.selectEvaluationTarget')}</option>
            {visionTargets.map((target) => (
              <option key={target.key} value={target.key}>{target.label}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-2">
          <label htmlFor="lookdev-score-threshold" className="text-sm text-white/74">{t('createBatch.scoreThreshold')}</label>
          <input
            id="lookdev-score-threshold"
            value={scoreThreshold}
            onChange={(event) => onScoreThresholdChange(event.target.value)}
            type="number"
            min="1"
            max="100"
            className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
          />
        </div>

        <div className="grid gap-2">
          <label htmlFor="lookdev-max-concurrency" className="text-sm text-white/74">{t('createBatch.maxConcurrency')}</label>
          <input
            id="lookdev-max-concurrency"
            value={maxConcurrency}
            onChange={(event) => onMaxConcurrencyChange(event.target.value)}
            type="number"
            min="1"
            max="4"
            className="rounded-2xl border border-white/10 bg-black/12 px-4 py-3 text-white outline-none"
          />
        </div>

        <div className="rounded-3xl border border-white/8 bg-black/14 px-5 py-5 text-sm leading-7 text-white/64">
          <div>{t('createBatch.policyNotesStylePack')}</div>
          <div>{t('createBatch.policyNotesCaptureSelection')}</div>
          <div>{t('createBatch.policyNotesWriteback')}</div>
        </div>

        {error ? <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

        <button
          type="button"
          onClick={onCreate}
          disabled={disabled}
          className="rounded-2xl bg-[var(--ld-accent)] px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-[var(--ld-accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? t('createBatch.creatingButton') : t('createBatch.createButton')}
        </button>
      </div>
    </section>
  );
}
