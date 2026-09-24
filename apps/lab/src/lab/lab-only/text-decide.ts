import type {
  NimiLocalAppScenarioExecuteOptions,
  NimiLocalAppScenarioExecuteResult,
  NimiLocalAppTextDecideSpec,
  NimiLocalAppTextDecisionAnswer,
  NimiLocalAppTextDecisionCandidate,
  NimiLocalAppTextDecisionJson,
  NimiLocalAppTextDecisionQuestion,
} from '@nimiplatform/sdk/app';
import { isJsonObject } from '@nimiplatform/sdk/types';
import {
  LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  defineStudioParameters,
} from '../../ai-studio-core/parameters.js';
import {
  studioNonSuccessDiagnostics,
  studioRuntimeErrorMessage,
  type StudioCapabilityRuntimeContext,
} from '../../ai-studio-core/runtime.js';
import type {
  StudioCapabilityRunResult,
  StudioNonSuccessReason,
  StudioTextDecisionAnswer,
} from '../../ai-studio-core/runtime-types.js';

// The Decisions form holds one state and an editable question list. It keeps
// both candidates and yes/no criteria per question so switching the answer
// type does not discard either; only the fields of the chosen type are sent.
export type LabTextDecideStateFormat = 'text' | 'json';
export type LabTextDecideQuestionKind = 'choice' | 'boolean';

export type LabTextDecideCandidateDraft = {
  readonly id: string;
  readonly description: string;
};

export type LabTextDecideQuestionDraft = {
  readonly id: string;
  readonly instructions: string;
  readonly kind: LabTextDecideQuestionKind;
  readonly candidates: readonly LabTextDecideCandidateDraft[];
  readonly trueCriterion: string;
  readonly falseCriterion: string;
};

export type LabTextDecideParameters = {
  readonly stateFormat?: LabTextDecideStateFormat;
  readonly state?: string;
  readonly questions?: readonly LabTextDecideQuestionDraft[];
  // Optional caller deadline passed as the execute timeout.
  readonly timeoutMs?: number;
};

export const LAB_TEXT_DECIDE_MAX_QUESTIONS = 64;
export const LAB_TEXT_DECIDE_MIN_CANDIDATES = 2;
export const LAB_TEXT_DECIDE_MAX_CANDIDATES = 255;
export const LAB_TEXT_DECIDE_MAX_TIMEOUT_MS = 120_000;

export type LabTextDecideIssueKey =
  | 'stateRequired'
  | 'stateJsonInvalid'
  | 'stateJsonNotContainer'
  | 'questionCount'
  | 'idRequired'
  | 'idSpaces'
  | 'questionIdRepeated'
  | 'instructionsRequired'
  | 'candidateCount'
  | 'candidateIdRequired'
  | 'candidateIdSpaces'
  | 'candidateIdRepeated'
  | 'timeout';

// `target` is the state, the question list, the timeout or a question index.
export type LabTextDecideIssue = {
  readonly target: 'state' | 'questions' | 'timeout' | number;
  readonly key: LabTextDecideIssueKey;
  readonly detail?: string;
};

export type LabTextDecideRequest = {
  readonly spec: NimiLocalAppTextDecideSpec;
  readonly timeoutMs?: number;
};

export type LabTextDecideBuild =
  | { readonly ok: true; readonly request: LabTextDecideRequest }
  | { readonly ok: false; readonly issues: readonly LabTextDecideIssue[] };

export function labTextDecideQuestion(
  id: string,
  kind: LabTextDecideQuestionKind = 'boolean',
): LabTextDecideQuestionDraft {
  return {
    id,
    instructions: '',
    kind,
    candidates: kind === 'choice' ? [{ id: '', description: '' }, { id: '', description: '' }] : [],
    trueCriterion: '',
    falseCriterion: '',
  };
}

// Example requests are fixed test data sent to Runtime as written, so they
// are not translated with the UI; their button labels are.
export const LAB_TEXT_DECIDE_EXAMPLES: readonly {
  readonly id: 'relevance' | 'intent';
  readonly labelKey: string;
  readonly parameters: LabTextDecideParameters;
}[] = Object.freeze([
  {
    id: 'relevance',
    labelKey: 'CapabilityTests.textDecide.exampleRelevance',
    parameters: {
      stateFormat: 'json',
      state: JSON.stringify({
        query: 'noise cancelling headphones for long flights',
        result: {
          title: 'Twelve travel headphones tested on long-haul flights',
          snippet: 'We wore each pair for a full transatlantic flight and measured how much cabin noise it removed, how comfortable it stayed after eight hours and how long the battery lasted.',
          url: 'https://reviews.example/travel-headphones',
        },
      }, null, 2),
      questions: [
        {
          id: 'relevant',
          instructions: 'Does this search result help answer the query?',
          kind: 'boolean',
          candidates: [],
          trueCriterion: 'The result directly addresses what the query asks for.',
          falseCriterion: 'The result is off-topic or only loosely related to the query.',
        },
        {
          id: 'hands_on',
          instructions: 'Is this result based on hands-on testing rather than a product listing or an advertisement?',
          kind: 'boolean',
          candidates: [],
          trueCriterion: 'The author used or tested the products.',
          falseCriterion: 'It is a shop page, a listing or an advertisement.',
        },
      ],
    },
  },
  {
    id: 'intent',
    labelKey: 'CapabilityTests.textDecide.exampleIntent',
    parameters: {
      stateFormat: 'text',
      state: '我上周买的蓝牙耳机左耳一直没有声音，重启和重新配对都试过了。能给我换一副新的吗？来回运费谁出？',
      questions: [
        {
          id: 'intent',
          instructions: '这位用户这条消息的主要诉求是什么？',
          kind: 'choice',
          candidates: [
            { id: 'refund', description: '申请退货退款' },
            { id: 'exchange', description: '更换同款新商品' },
            { id: 'repair', description: '申请维修或售后检测' },
            { id: 'shipping', description: '询问物流进度或运费' },
            { id: 'other', description: '其他问题' },
          ],
          trueCriterion: '',
          falseCriterion: '',
        },
        {
          id: 'needs_agent',
          instructions: '这条消息是否需要人工客服跟进？',
          kind: 'boolean',
          candidates: [],
          trueCriterion: '用户提出了需要人工核实或处理的售后请求。',
          falseCriterion: '可以直接用常见问题的标准答复解决。',
        },
      ],
    },
  },
]);

function hasSurroundingSpace(value: string): boolean {
  return value !== value.trim();
}

function parseJsonState(state: string): { readonly ok: true; readonly value: NimiLocalAppTextDecisionJson } | { readonly ok: false; readonly issue: LabTextDecideIssue } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(state);
  } catch (error) {
    return { ok: false, issue: { target: 'state', key: 'stateJsonInvalid', detail: error instanceof Error ? error.message : String(error) } };
  }
  if (!isJsonObject(parsed) && !Array.isArray(parsed)) return { ok: false, issue: { target: 'state', key: 'stateJsonNotContainer' } };
  return { ok: true, value: parsed as NimiLocalAppTextDecisionJson };
}

// App-side checks for what the form can get wrong. Byte bounds and the exact
// character rules stay with the SDK and Runtime, which reject them with their
// own typed reasons.
export function buildLabTextDecideRequest(parameters: LabTextDecideParameters | undefined): LabTextDecideBuild {
  const issues: LabTextDecideIssue[] = [];
  const stateText = parameters?.state ?? '';
  let state: NimiLocalAppTextDecideSpec['state'] | null = null;
  if (!stateText.trim()) {
    issues.push({ target: 'state', key: 'stateRequired' });
  } else if (parameters?.stateFormat === 'json') {
    const parsed = parseJsonState(stateText);
    if (parsed.ok) state = { json: parsed.value };
    else issues.push(parsed.issue);
  } else {
    state = { text: stateText };
  }

  const drafts = parameters?.questions ?? [];
  if (drafts.length < 1 || drafts.length > LAB_TEXT_DECIDE_MAX_QUESTIONS) issues.push({ target: 'questions', key: 'questionCount' });
  const questionIds = new Set<string>();
  const questions = drafts.map((draft, index): NimiLocalAppTextDecisionQuestion => {
    if (!draft.id) issues.push({ target: index, key: 'idRequired' });
    else if (hasSurroundingSpace(draft.id)) issues.push({ target: index, key: 'idSpaces' });
    else if (questionIds.has(draft.id)) issues.push({ target: index, key: 'questionIdRepeated' });
    questionIds.add(draft.id);
    if (!draft.instructions.trim()) issues.push({ target: index, key: 'instructionsRequired' });
    const instructions = { text: draft.instructions };
    if (draft.kind === 'boolean') {
      return {
        id: draft.id,
        instructions,
        kind: 'boolean',
        ...(draft.trueCriterion.trim() ? { trueCriterion: { text: draft.trueCriterion } } : {}),
        ...(draft.falseCriterion.trim() ? { falseCriterion: { text: draft.falseCriterion } } : {}),
      };
    }
    if (draft.candidates.length < LAB_TEXT_DECIDE_MIN_CANDIDATES || draft.candidates.length > LAB_TEXT_DECIDE_MAX_CANDIDATES) {
      issues.push({ target: index, key: 'candidateCount' });
    }
    const candidateIds = new Set<string>();
    const candidateIssues = new Set<LabTextDecideIssueKey>();
    const candidates: NimiLocalAppTextDecisionCandidate[] = [];
    for (const candidate of draft.candidates) {
      if (!candidate.id) candidateIssues.add('candidateIdRequired');
      else if (hasSurroundingSpace(candidate.id)) candidateIssues.add('candidateIdSpaces');
      else if (candidateIds.has(candidate.id)) candidateIssues.add('candidateIdRepeated');
      candidateIds.add(candidate.id);
      candidates.push(candidate.description.trim()
        ? { id: candidate.id, description: { text: candidate.description } }
        : { id: candidate.id });
    }
    for (const key of candidateIssues) issues.push({ target: index, key });
    return { id: draft.id, instructions, kind: 'choice', candidates };
  });

  const timeoutMs = parameters?.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > LAB_TEXT_DECIDE_MAX_TIMEOUT_MS)) {
    issues.push({ target: 'timeout', key: 'timeout' });
  }
  if (issues.length > 0 || !state) return { ok: false, issues };
  return {
    ok: true,
    request: {
      spec: { type: 'text-decide', state, questions },
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    },
  };
}

export function describeLabTextDecideIssue(
  issue: LabTextDecideIssue,
  translate: (key: string, values?: Readonly<Record<string, unknown>>) => string,
): string {
  const detail = translate(`CapabilityTests.textDecide.issues.${issue.key}`, issue.detail === undefined ? undefined : { detail: issue.detail });
  if (typeof issue.target !== 'number') return detail;
  return translate('CapabilityTests.textDecide.issueAt', {
    location: translate('CapabilityTests.textDecide.question', { index: issue.target + 1 }),
    detail,
  });
}

// History records the exact spec a run sent. A record restores the form only
// when it is a complete spec the form can represent; a truncated preview or
// JSON instructions, descriptions or criteria are not restored.
export function encodeLabTextDecideRequest(parameters: LabTextDecideParameters): string {
  const built = buildLabTextDecideRequest(parameters);
  return built.ok ? JSON.stringify(built.request.spec, null, 2) : '';
}

function recordedText(value: unknown): string | null {
  return isJsonObject(value) && Object.keys(value).length === 1 && typeof value.text === 'string' ? value.text : null;
}

function recordedOptionalText(value: unknown): string | null {
  return value === undefined ? '' : recordedText(value);
}

export function decodeLabTextDecideRequest(recorded: string): Partial<LabTextDecideParameters> | null {
  let spec: unknown;
  try {
    spec = JSON.parse(recorded);
  } catch {
    return null;
  }
  if (!isJsonObject(spec) || spec.type !== 'text-decide' || !isJsonObject(spec.state) || !Array.isArray(spec.questions)) return null;
  let stateFormat: LabTextDecideStateFormat;
  let state: string;
  const stateText = recordedText(spec.state);
  if (stateText !== null) {
    stateFormat = 'text';
    state = stateText;
  } else if (Object.keys(spec.state).length === 1 && (isJsonObject(spec.state.json) || Array.isArray(spec.state.json))) {
    stateFormat = 'json';
    state = JSON.stringify(spec.state.json, null, 2);
  } else {
    return null;
  }
  const questions: LabTextDecideQuestionDraft[] = [];
  for (const question of spec.questions) {
    if (!isJsonObject(question) || typeof question.id !== 'string') return null;
    const instructions = recordedText(question.instructions);
    if (instructions === null) return null;
    if (question.kind === 'boolean') {
      const trueCriterion = recordedOptionalText(question.trueCriterion);
      const falseCriterion = recordedOptionalText(question.falseCriterion);
      if (trueCriterion === null || falseCriterion === null) return null;
      questions.push({ id: question.id, instructions, kind: 'boolean', candidates: [], trueCriterion, falseCriterion });
      continue;
    }
    if (question.kind !== 'choice' || !Array.isArray(question.candidates)) return null;
    const candidates: LabTextDecideCandidateDraft[] = [];
    for (const candidate of question.candidates) {
      if (!isJsonObject(candidate) || typeof candidate.id !== 'string') return null;
      const description = recordedOptionalText(candidate.description);
      if (description === null) return null;
      candidates.push({ id: candidate.id, description });
    }
    questions.push({ id: question.id, instructions, kind: 'choice', candidates, trueCriterion: '', falseCriterion: '' });
  }
  return { stateFormat, state, questions };
}

export const labTextDecideParameters = defineStudioParameters<LabTextDecideParameters>({
  initial: () => LAB_TEXT_DECIDE_EXAMPLES[0]!.parameters,
  // Nimi runs text.decide on the Local or Cloud route saved in the App's own
  // AIConfig; every field is sent on either route.
  routeMatrix: {
    stateFormat: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    state: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    questions: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    timeoutMs: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  },
  summarize: (parameters) => ({
    stateFormat: parameters.stateFormat === 'json' ? 'json' : 'text',
    questions: parameters.questions?.length ?? 0,
    ...(parameters.timeoutMs !== undefined ? { timeoutMs: parameters.timeoutMs } : {}),
  }),
  hasAlternativeInput: (parameters) => buildLabTextDecideRequest(parameters).ok,
  recordedInput: {
    encode: encodeLabTextDecideRequest,
    decode: decodeLabTextDecideRequest,
  },
});

function validProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

// The SDK already validates the result against the request; the App also
// requires every answer to match the question and candidates it submitted, in
// order, before it shows anything.
function matchLabTextDecisionAnswers(
  spec: NimiLocalAppTextDecideSpec,
  answers: readonly NimiLocalAppTextDecisionAnswer[],
): StudioTextDecisionAnswer[] | null {
  if (answers.length !== spec.questions.length) return null;
  const matched: StudioTextDecisionAnswer[] = [];
  for (const [index, question] of spec.questions.entries()) {
    const answer = answers[index];
    if (!answer || answer.questionId !== question.id || answer.kind !== question.kind) return null;
    if (answer.kind === 'boolean') {
      if (!validProbability(answer.trueProbability)) return null;
      matched.push({ questionId: answer.questionId, kind: 'boolean', trueProbability: answer.trueProbability });
      continue;
    }
    if (question.kind !== 'choice' || answer.probabilities.length !== question.candidates.length) return null;
    const probabilities: { candidateId: string; probability: number }[] = [];
    for (const [position, entry] of answer.probabilities.entries()) {
      if (entry.candidateId !== question.candidates[position]?.id || !validProbability(entry.probability)) return null;
      probabilities.push({ candidateId: entry.candidateId, probability: entry.probability });
    }
    if (!question.candidates.some((candidate) => candidate.id === answer.selectedCandidateId)) return null;
    matched.push({ questionId: answer.questionId, kind: 'choice', selectedCandidateId: answer.selectedCandidateId, probabilities });
  }
  return matched;
}

// Typed failures this request can hit before or during the call. Every other
// failure keeps the shared Runtime error projection.
function labTextDecideFailureReason(error: unknown): StudioNonSuccessReason | null {
  switch (studioNonSuccessDiagnostics(error)?.reasonCode) {
    case 'SDK_LOCAL_APP_INPUT_INVALID':
    case 'AI_INPUT_INVALID':
    case 'AI_INPUT_LIMIT_EXCEEDED':
      return 'input-invalid';
    case 'OPERATION_TIMEOUT':
    case 'AI_PROVIDER_TIMEOUT':
    // The carrier's own deadline, reached when the call sets no timeoutMs
    // (its lowercase carrier code arrives normalized).
    case 'TIMEOUT':
      return 'runtime-timeout';
    default:
      return null;
  }
}

function stopped(context: StudioCapabilityRuntimeContext, error?: unknown): StudioCapabilityRunResult {
  const diagnostics = error === undefined ? undefined : studioNonSuccessDiagnostics(error);
  return context.host.nonSuccess(
    context.capability,
    'operation-aborted',
    context.host.translate('CapabilityTests.textDecide.stopped'),
    diagnostics,
  );
}

// One synchronous Scenario call per run. Stop aborts that call; the SDK then
// settles it as its typed canceled failure without waiting for Runtime, and a
// result that still arrives after Stop is never shown.
// @nimi-authority: rule.nimi.runtime.ai-provider.text-decision
// @nimi-authority: rule.nimi.sdks.feature-clients.scenario-execute-call-control
export async function runLabTextDecide(context: StudioCapabilityRuntimeContext): Promise<StudioCapabilityRunResult> {
  const { host, capability } = context;
  const built = buildLabTextDecideRequest(context.input.parameters as LabTextDecideParameters | undefined);
  if (!built.ok) {
    const [issue] = built.issues;
    return host.nonSuccess(capability, 'input-invalid', issue ? describeLabTextDecideIssue(issue, host.translate) : '');
  }
  const { spec, timeoutMs } = built.request;
  const signal = context.input.signal;
  if (signal?.aborted) return stopped(context);
  const options: NimiLocalAppScenarioExecuteOptions = {
    ...(signal ? { signal } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
  let response: NimiLocalAppScenarioExecuteResult;
  try {
    response = await host.client.ai.scenario.execute(spec, options);
  } catch (error) {
    if (signal?.aborted) return stopped(context, error);
    const reason = labTextDecideFailureReason(error);
    if (!reason) throw error;
    return host.nonSuccess(capability, reason, studioRuntimeErrorMessage(error), studioNonSuccessDiagnostics(error));
  }
  if (signal?.aborted) return stopped(context);
  const output = response.output;
  if (output.type !== 'text-decide') {
    return host.nonSuccess(capability, 'runtime-call-failed', host.translate('CapabilityTests.textDecide.unexpectedOutput'));
  }
  const answers = matchLabTextDecisionAnswers(spec, output.answers);
  if (!answers) {
    return host.nonSuccess(capability, 'runtime-call-failed', host.translate('CapabilityTests.textDecide.resultMismatch'));
  }
  return {
    ok: true,
    capabilityId: capability.id,
    capabilityLabel: capability.label,
    message: host.translate('CapabilityTests.textDecide.completed', { count: answers.length }),
    output: { kind: 'text-decision', answers },
    ...(response.traceId ? { trace: { traceId: response.traceId } } : {}),
  };
}
