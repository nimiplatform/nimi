import { useId } from 'react';
import { Button, SegmentedControl, TextField, TextareaField } from '@nimiplatform/kit/ui';
import { Plus, Trash2 } from 'lucide-react';

import {
  StudioParameterField,
  StudioParameterPanelFrame,
  optionalStudioNumber,
  type StudioParameterPanelProps,
} from '../../ai-studio-core/parameter-fields.js';
import { useTranslation } from '../../shell/i18n/index.js';
import {
  LAB_TEXT_DECIDE_EXAMPLES,
  LAB_TEXT_DECIDE_MAX_CANDIDATES,
  LAB_TEXT_DECIDE_MAX_QUESTIONS,
  LAB_TEXT_DECIDE_MAX_TIMEOUT_MS,
  LAB_TEXT_DECIDE_MIN_CANDIDATES,
  buildLabTextDecideRequest,
  labTextDecideQuestion,
  type LabTextDecideCandidateDraft,
  type LabTextDecideIssue,
  type LabTextDecideParameters,
  type LabTextDecideQuestionDraft,
} from './text-decide.js';

const K = 'CapabilityTests.textDecide';

function nextQuestionId(questions: readonly LabTextDecideQuestionDraft[]): string {
  const taken = new Set(questions.map((question) => question.id));
  let number = questions.length + 1;
  while (taken.has(`question_${number}`)) number += 1;
  return `question_${number}`;
}

// A choice keeps the candidates it had; switching to it from yes/no starts
// with the minimum number of rows.
function choiceCandidates(candidates: readonly LabTextDecideCandidateDraft[]): readonly LabTextDecideCandidateDraft[] {
  const padded = [...candidates];
  while (padded.length < LAB_TEXT_DECIDE_MIN_CANDIDATES) padded.push({ id: '', description: '' });
  return padded;
}

function IssueMessages({ id, messages }: { readonly id: string; readonly messages: readonly string[] }) {
  if (messages.length === 0) return null;
  return (
    <div id={id}>
      {messages.map((message) => <p key={message} className="lab-decision__issue">{message}</p>)}
    </div>
  );
}

export function LabTextDecideParameterPanel(props: StudioParameterPanelProps) {
  const { t } = useTranslation();
  const stateLabelId = useId();
  const stateIssueId = useId();
  const timeoutIssueId = useId();
  const questionsIssueId = useId();
  const parameters = props.parameters as LabTextDecideParameters;
  const format = parameters.stateFormat === 'json' ? 'json' : 'text';
  const questions = parameters.questions ?? [];
  const built = buildLabTextDecideRequest(parameters);
  const issues = built.ok ? [] : built.issues;
  const messagesFor = (target: LabTextDecideIssue['target']) => issues
    .filter((issue) => issue.target === target)
    .map((issue) => t(`${K}.issues.${issue.key}`, issue.detail === undefined ? undefined : { detail: issue.detail }));
  const stateMessages = messagesFor('state');
  const timeoutMessages = messagesFor('timeout');
  const update = (patch: Partial<LabTextDecideParameters>) => props.onChange({ ...parameters, ...patch });
  const setQuestions = (next: readonly LabTextDecideQuestionDraft[]) => update({ questions: next });
  const { disabled } = props;
  return (
    <StudioParameterPanelFrame
      translate={(key, values) => t(key, values)}
      disabled={disabled}
      onReset={() => props.onChange(props.contract.initial())}
    >
      <div className="studio-parameters__stack">
        <div className="lab-decision__examples" role="group" aria-label={t(`${K}.examples`)}>
          <span className="studio-parameters__label">{t(`${K}.examples`)}</span>
          {LAB_TEXT_DECIDE_EXAMPLES.map((example) => (
            <Button
              key={example.id}
              type="button"
              tone="secondary"
              size="sm"
              disabled={disabled}
              onClick={() => props.onChange({
                ...example.parameters,
                ...(parameters.timeoutMs !== undefined ? { timeoutMs: parameters.timeoutMs } : {}),
              })}
            >
              {t(example.labelKey)}
            </Button>
          ))}
        </div>

        <div className="lab-decision__section">
          <div className="lab-decision__section-head">
            <span className="studio-parameters__label" id={stateLabelId}>{t(`${K}.state`)}</span>
            <SegmentedControl
              size="sm"
              ariaLabel={t(`${K}.stateFormat`)}
              value={format}
              items={[
                { value: 'text', label: t(`${K}.formatText`), disabled },
                { value: 'json', label: t(`${K}.formatJson`), disabled },
              ]}
              onValueChange={(value) => update({ stateFormat: value === 'json' ? 'json' : 'text' })}
            />
          </div>
          <TextareaField
            rows={format === 'json' ? 8 : 4}
            value={parameters.state ?? ''}
            disabled={disabled}
            tone={stateMessages.length > 0 ? 'danger' : 'default'}
            aria-labelledby={stateLabelId}
            aria-describedby={stateMessages.length > 0 ? stateIssueId : undefined}
            placeholder={t(format === 'json' ? `${K}.statePlaceholderJson` : `${K}.statePlaceholderText`)}
            spellCheck={format === 'text'}
            textareaClassName={format === 'json' ? 'font-mono text-xs' : undefined}
            onChange={(event) => update({ state: event.currentTarget.value })}
          />
          <IssueMessages id={stateIssueId} messages={stateMessages} />
        </div>

        <div className="lab-decision__section">
          <span className="studio-parameters__label">{t(`${K}.questions`, { count: questions.length })}</span>
          {questions.map((question, index) => (
            <QuestionEditor
              key={index}
              index={index}
              question={question}
              disabled={disabled}
              messages={messagesFor(index)}
              onChange={(next) => setQuestions(questions.map((entry, position) => position === index ? next : entry))}
              onRemove={() => setQuestions(questions.filter((_, position) => position !== index))}
            />
          ))}
          <IssueMessages id={questionsIssueId} messages={messagesFor('questions')} />
          <div>
            <Button
              type="button"
              tone="ghost"
              size="sm"
              disabled={disabled || questions.length >= LAB_TEXT_DECIDE_MAX_QUESTIONS}
              leadingIcon={<Plus size={14} aria-hidden="true" />}
              onClick={() => setQuestions([...questions, labTextDecideQuestion(nextQuestionId(questions))])}
            >
              {t(`${K}.addQuestion`)}
            </Button>
          </div>
        </div>

        <StudioParameterField label={t(`${K}.timeout`)}>
          <TextField
            type="number"
            min={1}
            max={LAB_TEXT_DECIDE_MAX_TIMEOUT_MS}
            step={1}
            value={parameters.timeoutMs ?? ''}
            disabled={disabled}
            placeholder={t(`${K}.timeoutPlaceholder`)}
            tone={timeoutMessages.length > 0 ? 'danger' : 'default'}
            aria-describedby={timeoutMessages.length > 0 ? timeoutIssueId : undefined}
            onChange={(event) => props.onChange(optionalStudioNumber(parameters, 'timeoutMs', event.currentTarget.value))}
          />
        </StudioParameterField>
        <p className="studio-parameters__note">{t(`${K}.timeoutHint`)}</p>
        <IssueMessages id={timeoutIssueId} messages={timeoutMessages} />
        <p className="text-sm opacity-70">{t(`${K}.routeHint`)}</p>
      </div>
    </StudioParameterPanelFrame>
  );
}

function QuestionEditor({
  index,
  question,
  disabled,
  messages,
  onChange,
  onRemove,
}: {
  readonly index: number;
  readonly question: LabTextDecideQuestionDraft;
  readonly disabled: boolean;
  readonly messages: readonly string[];
  readonly onChange: (next: LabTextDecideQuestionDraft) => void;
  readonly onRemove: () => void;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const issueId = useId();
  const number = index + 1;
  const set = (patch: Partial<LabTextDecideQuestionDraft>) => onChange({ ...question, ...patch });
  const setCandidate = (position: number, patch: Partial<LabTextDecideCandidateDraft>) => set({
    candidates: question.candidates.map((candidate, entry) => entry === position ? { ...candidate, ...patch } : candidate),
  });
  const describedBy = messages.length > 0 ? issueId : undefined;
  return (
    <div className="lab-decision__question" role="group" aria-labelledby={headingId}>
      <div className="lab-decision__question-head">
        <strong id={headingId}>{t(`${K}.question`, { index: number })}</strong>
        <Button type="button" tone="ghost" size="sm" disabled={disabled} onClick={onRemove} aria-label={t(`${K}.removeQuestion`, { index: number })}>
          <Trash2 size={14} aria-hidden="true" />
        </Button>
      </div>
      <div className="lab-decision__row">
        <StudioParameterField label={t(`${K}.idLabel`)}>
          <TextField
            value={question.id}
            disabled={disabled}
            placeholder={t(`${K}.idPlaceholder`)}
            aria-label={t(`${K}.questionId`, { index: number })}
            aria-describedby={describedBy}
            onChange={(event) => set({ id: event.currentTarget.value })}
          />
        </StudioParameterField>
        <div className="studio-parameters__field">
          <span className="studio-parameters__label">{t(`${K}.kindLabel`)}</span>
          <SegmentedControl
            size="sm"
            ariaLabel={t(`${K}.kind`, { index: number })}
            value={question.kind}
            items={[
              { value: 'choice', label: t(`${K}.kindChoice`), disabled },
              { value: 'boolean', label: t(`${K}.kindBoolean`), disabled },
            ]}
            onValueChange={(value) => set(value === 'choice'
              ? { kind: 'choice', candidates: choiceCandidates(question.candidates) }
              : { kind: 'boolean' })}
          />
        </div>
      </div>
      <StudioParameterField label={t(`${K}.instructionsLabel`)}>
        <TextareaField
          rows={2}
          value={question.instructions}
          disabled={disabled}
          placeholder={t(`${K}.instructionsPlaceholder`)}
          aria-label={t(`${K}.instructions`, { index: number })}
          aria-describedby={describedBy}
          onChange={(event) => set({ instructions: event.currentTarget.value })}
        />
      </StudioParameterField>
      {question.kind === 'choice' ? (
        <div className="lab-decision__candidates">
          <span className="studio-parameters__label">{t(`${K}.candidates`)}</span>
          {question.candidates.map((candidate, position) => (
            <div className="lab-decision__candidate" key={position}>
              <TextField
                value={candidate.id}
                disabled={disabled}
                placeholder={t(`${K}.idPlaceholder`)}
                aria-label={t(`${K}.candidateId`, { question: number, index: position + 1 })}
                aria-describedby={describedBy}
                onChange={(event) => setCandidate(position, { id: event.currentTarget.value })}
              />
              <TextField
                value={candidate.description}
                disabled={disabled}
                placeholder={t(`${K}.candidateDescriptionPlaceholder`)}
                aria-label={t(`${K}.candidateDescription`, { question: number, index: position + 1 })}
                onChange={(event) => setCandidate(position, { description: event.currentTarget.value })}
              />
              <Button
                type="button"
                tone="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => set({ candidates: question.candidates.filter((_, entry) => entry !== position) })}
                aria-label={t(`${K}.removeCandidate`, { question: number, index: position + 1 })}
              >
                <Trash2 size={14} aria-hidden="true" />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              tone="ghost"
              size="sm"
              disabled={disabled || question.candidates.length >= LAB_TEXT_DECIDE_MAX_CANDIDATES}
              leadingIcon={<Plus size={14} aria-hidden="true" />}
              onClick={() => set({ candidates: [...question.candidates, { id: '', description: '' }] })}
            >
              {t(`${K}.addCandidate`)}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <StudioParameterField label={t(`${K}.trueCriterion`)}>
            <TextareaField
              rows={2}
              value={question.trueCriterion}
              disabled={disabled}
              onChange={(event) => set({ trueCriterion: event.currentTarget.value })}
            />
          </StudioParameterField>
          <StudioParameterField label={t(`${K}.falseCriterion`)}>
            <TextareaField
              rows={2}
              value={question.falseCriterion}
              disabled={disabled}
              onChange={(event) => set({ falseCriterion: event.currentTarget.value })}
            />
          </StudioParameterField>
        </>
      )}
      <IssueMessages id={issueId} messages={messages} />
    </div>
  );
}
