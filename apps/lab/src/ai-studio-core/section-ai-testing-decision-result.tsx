import { useAIStudioHost } from './host-context.js';
import type { StudioTextDecisionAnswer, StudioTypedOutput } from './runtime-types.js';

type TextDecisionOutput = Extract<StudioTypedOutput, { kind: 'text-decision' }>;

function formatProbability(value: number): string {
  return value.toFixed(4);
}

function barWidth(value: number): string {
  return `${Math.min(100, Math.max(0, value * 100))}%`;
}

// One entry per submitted question, in submitted order. Probabilities are
// shown exactly as returned; nothing is derived from them, including the
// complement of a yes/no probability.
export function TextDecisionResultView({ output, traceId }: { readonly output: TextDecisionOutput; readonly traceId?: string }) {
  const { translate: t } = useAIStudioHost();
  return (
    <section className="studio-result__rich" aria-label={t('StudioResults.decision.title')}>
      <p className="studio-result__plain">{t('StudioResults.decision.summary', { count: output.answers.length })}</p>
      <ol className="studio-decision">
        {output.answers.map((answer) => <TextDecisionAnswerView key={answer.questionId} answer={answer} />)}
      </ol>
      {traceId ? (
        <p className="studio-result__hint">
          {t('StudioResults.decision.trace')} <code>{traceId}</code>
        </p>
      ) : null}
    </section>
  );
}

function TextDecisionAnswerView({ answer }: { readonly answer: StudioTextDecisionAnswer }) {
  const { translate: t } = useAIStudioHost();
  const rows = answer.kind === 'choice'
    ? answer.probabilities.map((entry) => ({
        label: entry.candidateId,
        probability: entry.probability,
        selected: entry.candidateId === answer.selectedCandidateId,
      }))
    : [{ label: t('StudioResults.decision.trueLabel'), probability: answer.trueProbability, selected: false }];
  return (
    <li className="studio-decision__question">
      <div className="studio-decision__head">
        <code className="studio-decision__id">{answer.questionId}</code>
        <span className="studio-decision__kind">
          {t(answer.kind === 'choice' ? 'StudioResults.decision.choice' : 'StudioResults.decision.boolean')}
        </span>
      </div>
      <p className="studio-decision__answer">
        {answer.kind === 'choice'
          ? t('StudioResults.decision.selected', { candidate: answer.selectedCandidateId })
          : t('StudioResults.decision.trueProbability', { probability: formatProbability(answer.trueProbability) })}
      </p>
      <ul
        className="studio-decision__bars"
        aria-label={t(answer.kind === 'choice' ? 'StudioResults.decision.candidates' : 'StudioResults.decision.trueBar')}
      >
        {rows.map((row) => (
          <li
            key={row.label}
            className={row.selected ? 'studio-decision__bar studio-decision__bar--selected' : 'studio-decision__bar'}
            aria-current={row.selected ? 'true' : undefined}
          >
            <span className="studio-decision__label">{row.label}</span>
            <span className="studio-decision__track" aria-hidden="true">
              <span className="studio-decision__fill" style={{ width: barWidth(row.probability) }} />
            </span>
            <span className="studio-decision__value">{formatProbability(row.probability)}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}
