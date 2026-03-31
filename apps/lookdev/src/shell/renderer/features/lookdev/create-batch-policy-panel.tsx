import { Button, SelectField, TextField, type SelectFieldOption } from '@nimiplatform/nimi-kit/ui';
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
  const imageTargetOptions: SelectFieldOption[] = imageTargets.map((target) => ({ value: target.key, label: target.label }));
  const visionTargetOptions: SelectFieldOption[] = visionTargets.map((target) => ({ value: target.key, label: target.label }));

  return (
    <section className="ld-card px-7 py-7">
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-[0.2em] text-[var(--ld-gold)]">{t('createBatch.policyEyebrow')}</div>
        <h3 className="text-2xl font-semibold text-white">{t('createBatch.policyTitle')}</h3>
        <div className="text-sm leading-6 text-white/58">{t('createBatch.policyTargetMap')}</div>
      </div>

      <div className="mt-8 grid gap-5">
        <div className="grid gap-2">
          <label htmlFor="lookdev-generation-target" className="text-sm text-white/74">{t('createBatch.generationTarget')}</label>
          <div className="text-sm leading-6 text-white/48">{t('createBatch.generationTargetDescription')}</div>
          <SelectField
            id="lookdev-generation-target"
            value={generationTargetKey}
            options={imageTargetOptions}
            placeholder={t('createBatch.selectGenerationTarget')}
            onValueChange={onGenerationTargetChange}
            aria-label={t('createBatch.generationTarget')}
            className="rounded-2xl border-white/10 bg-black/12 text-white"
            contentClassName="bg-[rgb(11_18_32)]"
          />
        </div>

        <div className="grid gap-2">
          <label htmlFor="lookdev-evaluation-target" className="text-sm text-white/74">{t('createBatch.evaluationTarget')}</label>
          <div className="text-sm leading-6 text-white/48">{t('createBatch.evaluationTargetDescription')}</div>
          <SelectField
            id="lookdev-evaluation-target"
            value={evaluationTargetKey}
            options={visionTargetOptions}
            placeholder={t('createBatch.selectEvaluationTarget')}
            onValueChange={onEvaluationTargetChange}
            aria-label={t('createBatch.evaluationTarget')}
            className="rounded-2xl border-white/10 bg-black/12 text-white"
            contentClassName="bg-[rgb(11_18_32)]"
          />
        </div>

        <div className="grid gap-2">
          <label htmlFor="lookdev-score-threshold" className="text-sm text-white/74">{t('createBatch.scoreThreshold')}</label>
          <TextField
            id="lookdev-score-threshold"
            value={scoreThreshold}
            onChange={(event) => onScoreThresholdChange(event.target.value)}
            type="number"
            min="1"
            max="100"
            aria-label={t('createBatch.scoreThreshold')}
            className="rounded-2xl border-white/10 bg-black/12 text-white"
            inputClassName="text-sm"
          />
        </div>

        <div className="grid gap-2">
          <label htmlFor="lookdev-max-concurrency" className="text-sm text-white/74">{t('createBatch.maxConcurrency')}</label>
          <TextField
            id="lookdev-max-concurrency"
            value={maxConcurrency}
            onChange={(event) => onMaxConcurrencyChange(event.target.value)}
            type="number"
            min="1"
            max="4"
            aria-label={t('createBatch.maxConcurrency')}
            className="rounded-2xl border-white/10 bg-black/12 text-white"
            inputClassName="text-sm"
          />
        </div>

        <div className="rounded-3xl border border-white/8 bg-black/14 px-5 py-5 text-sm leading-7 text-white/64">
          <div>{t('createBatch.policyNotesStylePack')}</div>
          <div>{t('createBatch.policyNotesCaptureSelection')}</div>
          <div>{t('createBatch.policyNotesWriteback')}</div>
        </div>

        {error ? <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

        <Button
          onClick={onCreate}
          disabled={disabled}
          tone="primary"
          size="lg"
          className="rounded-2xl text-sm"
          fullWidth
        >
          {saving ? t('createBatch.creatingButton') : t('createBatch.createButton')}
        </Button>
      </div>
    </section>
  );
}
