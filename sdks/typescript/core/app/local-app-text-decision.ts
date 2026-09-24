import type { NimiJsonValue } from '../contracts/primitives.js';
import type {
  TextDecideScenarioSpec,
  TextDecisionContent,
  TextDecisionResult,
} from '../../core-generated/runtime-typed-client.js';
import {
  asRecord,
  assertExactProjectionKeys,
  localAppError,
  localAppProjectionError,
} from './local-app-runtime-platform-validation.js';

export type { NimiJsonValue } from '../contracts/primitives.js';

/** One JSON object or array; the SDK carries it as its JSON.stringify text. */
export type NimiLocalAppTextDecisionJson =
  | { readonly [key: string]: NimiJsonValue }
  | readonly NimiJsonValue[];

export type NimiLocalAppTextDecisionContent =
  | { readonly text: string }
  | { readonly json: NimiLocalAppTextDecisionJson };

export type NimiLocalAppTextDecisionCandidate = {
  readonly id: string;
  readonly description?: NimiLocalAppTextDecisionContent;
};

export type NimiLocalAppTextDecisionQuestion =
  | {
      readonly id: string;
      readonly instructions: NimiLocalAppTextDecisionContent;
      readonly kind: 'choice';
      readonly candidates: readonly NimiLocalAppTextDecisionCandidate[];
    }
  | {
      readonly id: string;
      readonly instructions: NimiLocalAppTextDecisionContent;
      readonly kind: 'boolean';
      readonly trueCriterion?: NimiLocalAppTextDecisionContent;
      readonly falseCriterion?: NimiLocalAppTextDecisionContent;
    };

export type NimiLocalAppTextDecideSpec = {
  readonly type: 'text-decide';
  readonly state: NimiLocalAppTextDecisionContent;
  readonly questions: readonly NimiLocalAppTextDecisionQuestion[];
};

/**
 * Carrier form of a text decision. JSON content is the exact JSON.stringify
 * text produced by the SDK so no later carrier reorders or respells it.
 */
export type NimiLocalAppTextDecisionShellContent =
  | { readonly text: string }
  | { readonly json: string };

export type NimiLocalAppTextDecisionShellCandidate = {
  readonly id: string;
  readonly description?: NimiLocalAppTextDecisionShellContent;
};

export type NimiLocalAppTextDecisionShellQuestion =
  | {
      readonly id: string;
      readonly instructions: NimiLocalAppTextDecisionShellContent;
      readonly kind: 'choice';
      readonly candidates: readonly NimiLocalAppTextDecisionShellCandidate[];
    }
  | {
      readonly id: string;
      readonly instructions: NimiLocalAppTextDecisionShellContent;
      readonly kind: 'boolean';
      readonly trueCriterion?: NimiLocalAppTextDecisionShellContent;
      readonly falseCriterion?: NimiLocalAppTextDecisionShellContent;
    };

export type NimiLocalAppTextDecideShellSpec = {
  readonly type: 'text-decide';
  readonly state: NimiLocalAppTextDecisionShellContent;
  readonly questions: readonly NimiLocalAppTextDecisionShellQuestion[];
};

export type NimiLocalAppTextDecisionProbability = {
  readonly candidateId: string;
  readonly probability: number;
};

export type NimiLocalAppTextDecisionAnswer =
  | {
      readonly questionId: string;
      readonly kind: 'choice';
      readonly selectedCandidateId: string;
      readonly probabilities: readonly NimiLocalAppTextDecisionProbability[];
    }
  | {
      readonly questionId: string;
      readonly kind: 'boolean';
      readonly trueProbability: number;
    };

export type NimiLocalAppTextDecideOutput = {
  readonly type: 'text-decide';
  readonly answers: readonly NimiLocalAppTextDecisionAnswer[];
};

type TextDecisionQuestionShape =
  | { readonly id: string; readonly kind: 'choice'; readonly candidates: readonly { readonly id: string }[] }
  | { readonly id: string; readonly kind: 'boolean' };

// Public text.decide bounds mirrored from Runtime. Implementation-specific
// encoding limits remain Runtime-owned (AI_INPUT_LIMIT_EXCEEDED).
const MAX_STATE_BYTES = 256 * 1024;
const MAX_QUESTIONS = 64;
const MAX_INSTRUCTION_BYTES = 32 * 1024;
const MAX_CRITERION_BYTES = 8 * 1024;
const MIN_CANDIDATES = 2;
const MAX_CANDIDATES = 255;
const MAX_ID_BYTES = 64;
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const PROBABILITY_SUM_TOLERANCE = 0.02;
// A binary64 sum of decimal probabilities that is exactly 0.98 or 1.02 lands a
// few ulps past the bound; this absorbs only that rounding.
const PROBABILITY_SUM_EPSILON = 1e-9;
const ARGMAX_TOLERANCE = 1e-6;

type ContentForm = 'public' | 'shell';

// @nimi-authority: rule.nimi.sdks.feature-clients.scenario-execute-call-control
/** Validates the public spec and returns its exact carrier form. */
export function prepareNimiLocalAppTextDecideSpec(value: unknown): NimiLocalAppTextDecideShellSpec {
  return textDecideSpec(value, 'public');
}

/**
 * Shared carrier validation for Kit and Host layers. JSON content must be the
 * canonical JSON.stringify text of one strict object or array.
 */
export function validateNimiLocalAppTextDecideShellSpec(value: unknown): NimiLocalAppTextDecideShellSpec {
  return textDecideSpec(value, 'shell');
}

/** Rebuilds the public spec from a validated carrier spec without respelling JSON. */
export function nimiLocalAppTextDecideSpecFromShell(value: unknown): NimiLocalAppTextDecideSpec {
  const spec = validateNimiLocalAppTextDecideShellSpec(value);
  const content = (entry: NimiLocalAppTextDecisionShellContent): NimiLocalAppTextDecisionContent => (
    'text' in entry
      ? Object.freeze({ text: entry.text })
      : Object.freeze({ json: deepFreeze(JSON.parse(entry.json) as NimiLocalAppTextDecisionJson) })
  );
  return Object.freeze({
    type: 'text-decide',
    state: content(spec.state),
    questions: Object.freeze(spec.questions.map((question): NimiLocalAppTextDecisionQuestion => (
      question.kind === 'choice'
        ? Object.freeze({
            id: question.id,
            instructions: content(question.instructions),
            kind: 'choice',
            candidates: Object.freeze(question.candidates.map((candidate) => Object.freeze({
              id: candidate.id,
              ...(candidate.description ? { description: content(candidate.description) } : {}),
            }))),
          })
        : Object.freeze({
            id: question.id,
            instructions: content(question.instructions),
            kind: 'boolean',
            ...(question.trueCriterion ? { trueCriterion: content(question.trueCriterion) } : {}),
            ...(question.falseCriterion ? { falseCriterion: content(question.falseCriterion) } : {}),
          })
    ))),
  });
}

// @nimi-authority: rule.nimi.runtime.ai-provider.text-decision
/**
 * Validates one text-decide output against the submitted questions: exactly
 * one answer per question in submitted order, candidate probabilities in
 * submitted candidate order, finite values in [0,1], a normalized
 * distribution, and a selected candidate at the maximum.
 */
export function validateNimiLocalAppTextDecideOutput(
  value: unknown,
  spec: { readonly questions: readonly TextDecisionQuestionShape[] },
): NimiLocalAppTextDecideOutput {
  const output = asRecord(value);
  assertExactProjectionKeys(output, ['type', 'answers'], 'text decision output');
  if (output.type !== 'text-decide' || !Array.isArray(output.answers)
    || output.answers.length !== spec.questions.length) {
    localAppProjectionError('text decision answers');
  }
  const answerValues = output.answers as readonly unknown[];
  const answers = spec.questions.map((question, index): NimiLocalAppTextDecisionAnswer => {
    const field = `text decision answer ${index}`;
    const answer = asRecord(answerValues[index]);
    if (!answer || answer.questionId !== question.id || answer.kind !== question.kind) {
      localAppProjectionError(field);
    }
    if (question.kind === 'boolean') {
      assertExactProjectionKeys(answer, ['questionId', 'kind', 'trueProbability'], field);
      if (!validProbability(answer.trueProbability)) localAppProjectionError(`${field} probability`);
      return Object.freeze({ questionId: question.id, kind: 'boolean', trueProbability: answer.trueProbability });
    }
    assertExactProjectionKeys(answer, ['questionId', 'kind', 'selectedCandidateId', 'probabilities'], field);
    if (!Array.isArray(answer.probabilities) || answer.probabilities.length !== question.candidates.length) {
      localAppProjectionError(`${field} probabilities`);
    }
    const entries = answer.probabilities as readonly unknown[];
    let sum = 0;
    let maximum = Number.NEGATIVE_INFINITY;
    let selected = Number.NaN;
    const probabilities = question.candidates.map((candidate, position) => {
      const entry = asRecord(entries[position]);
      assertExactProjectionKeys(entry, ['candidateId', 'probability'], `${field} probability ${position}`);
      if (entry.candidateId !== candidate.id || !validProbability(entry.probability)) {
        localAppProjectionError(`${field} probability ${position}`);
      }
      const probability = entry.probability;
      sum += probability;
      maximum = Math.max(maximum, probability);
      if (candidate.id === answer.selectedCandidateId) selected = probability;
      return Object.freeze({ candidateId: candidate.id, probability });
    });
    if (Number.isNaN(selected) || Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE + PROBABILITY_SUM_EPSILON
      || selected < maximum - ARGMAX_TOLERANCE) {
      localAppProjectionError(`${field} distribution`);
    }
    return Object.freeze({
      questionId: question.id,
      kind: 'choice',
      selectedCandidateId: answer.selectedCandidateId as string,
      probabilities: Object.freeze(probabilities),
    });
  });
  return Object.freeze({ type: 'text-decide', answers: Object.freeze(answers) });
}

/** Maps a validated carrier spec to the generated Runtime request message. */
export function runtimeTextDecideSpec(spec: NimiLocalAppTextDecideShellSpec): TextDecideScenarioSpec {
  return {
    state: runtimeDecisionContent(spec.state),
    questions: spec.questions.map((question) => ({
      id: question.id,
      instructions: runtimeDecisionContent(question.instructions),
      kind: question.kind === 'choice'
        ? {
            oneofKind: 'choice' as const,
            choice: {
              candidates: question.candidates.map((candidate) => ({
                id: candidate.id,
                ...(candidate.description ? { description: runtimeDecisionContent(candidate.description) } : {}),
              })),
            },
          }
        : {
            oneofKind: 'boolean' as const,
            boolean: {
              ...(question.trueCriterion ? { trueCriterion: runtimeDecisionContent(question.trueCriterion) } : {}),
              ...(question.falseCriterion ? { falseCriterion: runtimeDecisionContent(question.falseCriterion) } : {}),
            },
          },
    })),
  };
}

/** Projects the generated Runtime result into the unvalidated carrier output. */
export function localTextDecideOutputFromRuntime(result: TextDecisionResult): unknown {
  return {
    type: 'text-decide',
    answers: result.answers.map((answer) => {
      if (answer.result.oneofKind === 'choice') {
        return {
          questionId: answer.questionId,
          kind: 'choice',
          selectedCandidateId: answer.result.choice.selectedCandidateId,
          probabilities: answer.result.choice.probabilities.map((entry) => ({
            candidateId: entry.candidateId,
            probability: entry.probability,
          })),
        };
      }
      if (answer.result.oneofKind === 'boolean') {
        return {
          questionId: answer.questionId,
          kind: 'boolean',
          trueProbability: answer.result.boolean.trueProbability,
        };
      }
      return localAppProjectionError('text decision Runtime answer');
    }),
  };
}

function runtimeDecisionContent(content: NimiLocalAppTextDecisionShellContent): TextDecisionContent {
  return 'text' in content
    ? { value: { oneofKind: 'text', text: content.text } }
    : { value: { oneofKind: 'json', json: content.json } };
}

function textDecideSpec(value: unknown, form: ContentForm): NimiLocalAppTextDecideShellSpec {
  const record = asRecord(value);
  if (!record || !hasExactKeys(record, ['type', 'state', 'questions']) || record.type !== 'text-decide') {
    invalidDecision('text-decide spec must contain exactly type, state and questions');
  }
  const state = decisionContent(record.state, MAX_STATE_BYTES, form, 'state');
  if (!Array.isArray(record.questions) || record.questions.length < 1 || record.questions.length > MAX_QUESTIONS) {
    invalidDecision(`text-decide requires 1 to ${MAX_QUESTIONS} questions`);
  }
  const questionIds = new Set<string>();
  const questions = (record.questions as readonly unknown[]).map((entry, index): NimiLocalAppTextDecisionShellQuestion => {
    const field = `question ${index}`;
    const question = asRecord(entry);
    if (!question) invalidDecision(`${field} is invalid`);
    const id = decisionId(question.id, `${field} id`);
    if (questionIds.has(id)) invalidDecision('question ids must be unique');
    questionIds.add(id);
    if (question.kind === 'choice') {
      if (!hasExactKeys(question, ['id', 'instructions', 'kind', 'candidates'])) {
        invalidDecision(`${field} choice fields are invalid`);
      }
      const instructions = decisionContent(question.instructions, MAX_INSTRUCTION_BYTES, form, `${field} instructions`);
      if (!Array.isArray(question.candidates) || question.candidates.length < MIN_CANDIDATES
        || question.candidates.length > MAX_CANDIDATES) {
        invalidDecision(`${field} requires ${MIN_CANDIDATES} to ${MAX_CANDIDATES} candidates`);
      }
      const candidateIds = new Set<string>();
      const candidates = (question.candidates as readonly unknown[]).map((candidateValue, candidateIndex) => {
        const candidateField = `${field} candidate ${candidateIndex}`;
        const candidate = asRecord(candidateValue);
        if (!candidate || !hasAllowedKeys(candidate, ['id'], ['description'])) {
          invalidDecision(`${candidateField} fields are invalid`);
        }
        const candidateId = decisionId(candidate.id, `${candidateField} id`);
        if (candidateIds.has(candidateId)) invalidDecision(`${field} candidate ids must be unique`);
        candidateIds.add(candidateId);
        return Object.freeze(candidate.description === undefined
          ? { id: candidateId }
          : { id: candidateId, description: decisionContent(candidate.description, MAX_CRITERION_BYTES, form, `${candidateField} description`) });
      });
      return Object.freeze({ id, instructions, kind: 'choice', candidates: Object.freeze(candidates) });
    }
    if (question.kind === 'boolean') {
      if (!hasAllowedKeys(question, ['id', 'instructions', 'kind'], ['trueCriterion', 'falseCriterion'])) {
        invalidDecision(`${field} boolean fields are invalid`);
      }
      const instructions = decisionContent(question.instructions, MAX_INSTRUCTION_BYTES, form, `${field} instructions`);
      const trueCriterion = question.trueCriterion === undefined
        ? undefined
        : decisionContent(question.trueCriterion, MAX_CRITERION_BYTES, form, `${field} trueCriterion`);
      const falseCriterion = question.falseCriterion === undefined
        ? undefined
        : decisionContent(question.falseCriterion, MAX_CRITERION_BYTES, form, `${field} falseCriterion`);
      return Object.freeze({
        id,
        instructions,
        kind: 'boolean',
        ...(trueCriterion ? { trueCriterion } : {}),
        ...(falseCriterion ? { falseCriterion } : {}),
      });
    }
    return invalidDecision(`${field} kind must be choice or boolean`);
  });
  const spec: NimiLocalAppTextDecideShellSpec = Object.freeze({
    type: 'text-decide',
    state,
    questions: Object.freeze(questions),
  });
  if (textDecideProtoSize(spec) > MAX_REQUEST_BYTES) {
    invalidDecision('text-decide request exceeds 1 MiB');
  }
  return spec;
}

function decisionContent(
  value: unknown,
  maxBytes: number,
  form: ContentForm,
  field: string,
): NimiLocalAppTextDecisionShellContent {
  const record = asRecord(value);
  const keys = record ? Object.keys(record) : [];
  if (!record || keys.length !== 1) invalidDecision(`${field} must contain exactly text or json`);
  if (keys[0] === 'text') {
    if (!validDecisionText(record.text, maxBytes)) invalidDecision(`${field} text is invalid`);
    return Object.freeze({ text: record.text as string });
  }
  if (keys[0] === 'json') {
    return Object.freeze({
      json: form === 'public'
        ? serializeDecisionJson(record.json, maxBytes, field)
        : canonicalDecisionJson(record.json, maxBytes, field),
    });
  }
  return invalidDecision(`${field} must contain exactly text or json`);
}

function serializeDecisionJson(value: unknown, maxBytes: number, field: string): string {
  if (!value || typeof value !== 'object') invalidDecision(`${field} JSON must be one object or array`);
  assertStrictDecisionJson(value, 1, maxBytes, { nodes: 0 }, field);
  const text = JSON.stringify(value);
  if (typeof text !== 'string' || utf8Length(text) > maxBytes) invalidDecision(`${field} JSON exceeds ${maxBytes} bytes`);
  return text;
}

function canonicalDecisionJson(value: unknown, maxBytes: number, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || !isWellFormed(value) || utf8Length(value) > maxBytes) {
    invalidDecision(`${field} JSON text is invalid`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return invalidDecision(`${field} JSON text is invalid`);
  }
  if (!parsed || typeof parsed !== 'object') invalidDecision(`${field} JSON must be one object or array`);
  assertStrictDecisionJson(parsed, 1, maxBytes, { nodes: 0 }, field);
  // The carrier accepts only the SDK serialization. Canonical equality also
  // excludes duplicate keys, insignificant whitespace and respelled numbers.
  if (JSON.stringify(parsed) !== value) invalidDecision(`${field} JSON text is not canonical`);
  return value;
}

function assertStrictDecisionJson(
  value: unknown,
  depth: number,
  maxBytes: number,
  budget: { nodes: number },
  field: string,
): void {
  budget.nodes += 1;
  if (budget.nodes > maxBytes) invalidDecision(`${field} JSON exceeds ${maxBytes} bytes`);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalidDecision(`${field} JSON numbers must be finite`);
    return;
  }
  if (typeof value === 'string') {
    if (!isWellFormed(value)) invalidDecision(`${field} JSON strings must be Unicode`);
    return;
  }
  if (typeof value !== 'object') invalidDecision(`${field} JSON contains an unsupported value`);
  if (depth > MAX_JSON_DEPTH) invalidDecision(`${field} JSON nesting exceeds ${MAX_JSON_DEPTH}`);
  const object = value as object;
  if (Array.isArray(object)) {
    // Holes, extra properties and accessors would be rewritten by JSON.stringify.
    if (Reflect.ownKeys(object).length !== object.length + 1) invalidDecision(`${field} JSON array is not dense`);
    for (let index = 0; index < object.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(object, index);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
        invalidDecision(`${field} JSON array is not dense`);
      }
      assertStrictDecisionJson(descriptor.value, depth + 1, maxBytes, budget, field);
    }
    return;
  }
  const prototype = Object.getPrototypeOf(object);
  if (prototype !== Object.prototype && prototype !== null) invalidDecision(`${field} JSON objects must be plain`);
  for (const key of Reflect.ownKeys(object)) {
    if (typeof key !== 'string' || !isWellFormed(key)) invalidDecision(`${field} JSON keys must be Unicode strings`);
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
      invalidDecision(`${field} JSON object properties must be plain data`);
    }
    assertStrictDecisionJson(descriptor.value, depth + 1, maxBytes, budget, field);
  }
}

function decisionId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || !isWellFormed(value) || utf8Length(value) > MAX_ID_BYTES) {
    invalidDecision(`${field} must be 1 to ${MAX_ID_BYTES} bytes of Unicode`);
  }
  const codePoints = Array.from(value, (entry) => entry.codePointAt(0) as number);
  if (isRuntimeSpace(codePoints[0] as number) || isRuntimeSpace(codePoints[codePoints.length - 1] as number)
    || codePoints.some(isControl)) {
    invalidDecision(`${field} contains surrounding whitespace or control characters`);
  }
  return value;
}

function validDecisionText(value: unknown, maxBytes: number): value is string {
  if (typeof value !== 'string' || value.length === 0 || !isWellFormed(value)
    || value.includes('\0') || utf8Length(value) > maxBytes) return false;
  for (const entry of value) {
    const codePoint = entry.codePointAt(0) as number;
    if (!isRuntimeSpace(codePoint) && !(codePoint >= 0x1c && codePoint <= 0x1f)) return true;
  }
  return false;
}

function validProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

// Runtime trims and tests blank text with Unicode White_Space.
function isRuntimeSpace(codePoint: number): boolean {
  return (codePoint >= 0x09 && codePoint <= 0x0d) || codePoint === 0x20 || codePoint === 0x85
    || codePoint === 0xa0 || codePoint === 0x1680 || (codePoint >= 0x2000 && codePoint <= 0x200a)
    || codePoint === 0x2028 || codePoint === 0x2029 || codePoint === 0x202f || codePoint === 0x205f
    || codePoint === 0x3000;
}

function isControl(codePoint: number): boolean {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

function isWellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit < 0xd800 || unit > 0xdfff) continue;
    if (unit > 0xdbff || index + 1 >= value.length) return false;
    const next = value.charCodeAt(index + 1);
    if (next < 0xdc00 || next > 0xdfff) return false;
    index += 1;
  }
  return true;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

// Exact protobuf size of TextDecideScenarioSpec; Runtime bounds proto.Size.
function textDecideProtoSize(spec: NimiLocalAppTextDecideShellSpec): number {
  const content = (entry: NimiLocalAppTextDecisionShellContent) => lengthDelimited(utf8Length('text' in entry ? entry.text : entry.json));
  const questions = spec.questions.reduce((total, question) => {
    let size = lengthDelimited(utf8Length(question.id)) + lengthDelimited(content(question.instructions));
    if (question.kind === 'choice') {
      const choice = question.candidates.reduce((sum, candidate) => sum + lengthDelimited(
        lengthDelimited(utf8Length(candidate.id))
          + (candidate.description ? lengthDelimited(content(candidate.description)) : 0),
      ), 0);
      size += lengthDelimited(choice);
    } else {
      size += lengthDelimited(
        (question.trueCriterion ? lengthDelimited(content(question.trueCriterion)) : 0)
          + (question.falseCriterion ? lengthDelimited(content(question.falseCriterion)) : 0),
      );
    }
    return total + lengthDelimited(size);
  }, 0);
  return lengthDelimited(content(spec.state)) + questions;
}

function lengthDelimited(size: number): number {
  let varint = 1;
  for (let remaining = size; remaining >= 0x80; remaining = Math.floor(remaining / 0x80)) varint += 1;
  return 1 + varint + size;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

function hasAllowedKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  return required.every((key) => Object.hasOwn(record, key))
    && Object.keys(record).every((key) => required.includes(key) || optional.includes(key));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value as object)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

function invalidDecision(reason: string): never {
  return localAppError(
    `Local-app AI input is invalid: ${reason}.`,
    'SDK_LOCAL_APP_INPUT_INVALID',
    'provide_exact_local_app_ai_input',
  );
}
