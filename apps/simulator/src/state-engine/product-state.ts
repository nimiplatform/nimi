/**
 * Simulator-owned Shell product state: persona, agent presence, grants,
 * interaction ledger, consent, and flow runner state — committed under the
 * `shell` partition's `product` sub-state through declared, closed-schema
 * commands. Follows the overlay-state conventions: one owner, closed write
 * set, fail-closed reads, no wall-clock, no host randomness.
 *
 * Authority: P-SIM-001 (simulated labeling), P-SIM-010..012, P-SIM-019.
 */

import {
  assertJsonValue,
  freezeJsonValue,
  type JsonValue,
} from './json-value.ts';
import {
  simulatorError,
  simulatorFail,
  simulatorOk,
  type SimulatorResult,
} from './errors.ts';
import { formatCanonicalId } from './ids.ts';
import { validateSchema } from './schema.ts';
import type { EngineContext } from './engine-context.ts';
import { freezeCommittedState, recordSettlement } from './engine-context.ts';
import { abortIntegrity, notifyStateSubscribers } from './module-commands.ts';
import type { QueuedOperation } from './engine-types.ts';
import type { SimulatorEventRecord } from './types.ts';
import {
  SIMULATOR_PRODUCT_FLOWS,
  type SimulatorProductAgentStatus,
  type SimulatorProductFlowDefinition,
  type SimulatorProductFlowStep,
  type SimulatorProductLedgerKind,
  type SimulatorProductLedgerResult,
} from './product-flows.ts';
import { isSimulatorRouteState } from './route-state.ts';
import {
  PRODUCT_AGENT_STATUSES,
  PRODUCT_EVENT_SCHEMAS,
  PRODUCT_FLOW_STATUSES,
  PRODUCT_LEDGER_KINDS,
  PRODUCT_LEDGER_RESULTS,
  SIMULATOR_PRODUCT_COMMANDS,
  SIMULATOR_PRODUCT_EVENTS,
  productLedgerEntrySchema,
  type SimulatorProductFlowStatus,
} from './product-state-contract.ts';

export {
  registerProductCommands,
  SIMULATOR_PRODUCT_COMMANDS,
  SIMULATOR_PRODUCT_EVENTS,
  type SimulatorProductFlowStatus,
} from './product-state-contract.ts';

/** Ledger entry shape accepted from interactions and the flow catalog. */
export interface SimulatorProductLedgerInput {
  readonly kind: SimulatorProductLedgerKind;
  readonly title: string;
  readonly detail: string;
  readonly actors: readonly string[];
  readonly tags?: readonly string[];
  readonly result: SimulatorProductLedgerResult;
}

/** Shell-partition effects an interaction may commit atomically. */
export interface SimulatorInteractionProductEffects {
  readonly persona?: { readonly name: string; readonly id: string; readonly role: string };
  readonly agent?: {
    readonly status: SimulatorProductAgentStatus;
    readonly location?: string;
    readonly carry?: string | null;
  };
  readonly ledger?: readonly SimulatorProductLedgerInput[];
  readonly routes?: readonly {
    readonly moduleId: string;
    readonly route: JsonValue;
  }[];
}

/** Typed read projection of the `shell.product` sub-state for Shell consumers. */
export interface SimulatorShellProductState {
  readonly persona: { readonly name: string; readonly id: string; readonly role: string } | null;
  readonly agentPersona: { readonly name: string; readonly kind: string; readonly mode: string };
  readonly agent: {
    readonly status: SimulatorProductAgentStatus;
    readonly location: string;
    readonly carry: string | null;
  };
  readonly grants: readonly {
    readonly id: string;
    readonly title: string;
    readonly scope: string;
    readonly from: string;
    readonly to: string;
    readonly meta: string;
    readonly tags: readonly string[];
    readonly receipt: {
      readonly access: string;
      readonly range: string;
      readonly validity: string;
      readonly expiry: string;
      readonly restriction: string;
      readonly lastUsed: string;
    };
    readonly status: 'active' | 'revoked';
    readonly seeded: boolean;
  }[];
  readonly ledger: readonly {
    readonly id: string;
    readonly epoch: number;
    readonly kind: SimulatorProductLedgerKind;
    readonly title: string;
    readonly detail: string;
    readonly actors: readonly string[];
    readonly tags?: readonly string[];
    readonly result: SimulatorProductLedgerResult;
    readonly at: string;
    readonly history?: boolean;
  }[];
  readonly consent: {
    readonly flowId: string;
    readonly grantId: string;
    readonly origin: string;
  } | null;
  readonly flow: {
    readonly flowId: string | null;
    readonly stepIndex: number;
    readonly status: SimulatorProductFlowStatus;
    readonly currentDirective: JsonValue;
  };
  readonly opSeq: number;
}

/**
 * Pure parse of the `shell.product` sub-state for Shell-side reads. Returns
 * null when the scenario does not seed product state; throws on malformed
 * state (fail-closed, never a synthesized fallback).
 */
export function parseShellProductState(value: JsonValue | undefined): SimulatorShellProductState | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SIMULATOR_PRODUCT_STATE_INVALID');
  }
  return value as unknown as SimulatorShellProductState;
}

type JsonRecord = Readonly<Record<string, JsonValue>>;

function isRecord(value: JsonValue | undefined): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function formatProductOpTime(op: number): string {
  const mm = String(Math.floor(op / 60)).padStart(2, '0');
  const ss = String(op % 60).padStart(2, '0');
  return `T+${mm}:${ss}`;
}

function ledgerId(epoch: number, op: number): string {
  return `${epoch}:op:${String(op).padStart(3, '0')}`;
}

function validateLedgerEntry(entry: JsonValue): void {
  if (!isRecord(entry)
    || typeof entry.id !== 'string'
    || !Number.isSafeInteger(entry.epoch)
    || typeof entry.kind !== 'string'
    || !PRODUCT_LEDGER_KINDS.includes(entry.kind as SimulatorProductLedgerKind)
    || typeof entry.title !== 'string'
    || typeof entry.detail !== 'string'
    || !Array.isArray(entry.actors)
    || typeof entry.result !== 'string'
    || !PRODUCT_LEDGER_RESULTS.includes(entry.result as SimulatorProductLedgerResult)
    || typeof entry.at !== 'string') {
    abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
  }
}

function validateGrant(grant: JsonValue): void {
  if (!isRecord(grant)
    || typeof grant.id !== 'string'
    || typeof grant.title !== 'string'
    || (grant.status !== 'active' && grant.status !== 'revoked')
    || typeof grant.seeded !== 'boolean'
    || !isRecord(grant.receipt)) {
    abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
  }
}

function validateFlowState(flow: JsonValue): void {
  if (!isRecord(flow)
    || (flow.flowId !== null && typeof flow.flowId !== 'string')
    || !Number.isSafeInteger(flow.stepIndex)
    || typeof flow.status !== 'string'
    || !PRODUCT_FLOW_STATUSES.includes(flow.status as SimulatorProductFlowStatus)
    || (flow.currentDirective !== null && !isRecord(flow.currentDirective))) {
    abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
  }
}

/** Reads and validates the product sub-state; null when the scenario does not seed it. */
export function readProductState(context: EngineContext): JsonRecord | null {
  const shell = context.committed.snapshot.shell;
  if (!isRecord(shell)) abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
  const product = shell.product;
  if (product === undefined) return null;
  if (!isRecord(product)
    || (product.persona !== null && !isRecord(product.persona))
    || !isRecord(product.agentPersona)
    || !isRecord(product.agent)
    || !PRODUCT_AGENT_STATUSES.includes(product.agent.status as SimulatorProductAgentStatus)
    || !Array.isArray(product.grants)
    || !Array.isArray(product.ledger)
    || (product.consent !== null && !isRecord(product.consent))
    || !Number.isSafeInteger(product.opSeq)) {
    abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
  }
  for (const grant of product.grants) validateGrant(grant);
  for (const entry of product.ledger) validateLedgerEntry(entry);
  validateFlowState(product.flow as JsonValue);
  return product;
}

function requireProductState(context: EngineContext, operation: QueuedOperation): JsonRecord | null {
  const product = readProductState(context);
  if (product === null) {
    recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError('SIMULATOR_UNSUPPORTED', {
      moduleId: operation.issuer.moduleId,
      instanceId: operation.issuer.instanceId,
      operationId: operation.operationId,
    })));
    return null;
  }
  return product;
}

function failOperation(
  context: EngineContext,
  operation: QueuedOperation,
  code: 'SIMULATOR_INVALID_PAYLOAD' | 'SIMULATOR_INVALID_LIFECYCLE',
): void {
  recordSettlement(context, operation.sequence, operation.settle, simulatorFail(simulatorError(code, {
    moduleId: operation.issuer.moduleId,
    instanceId: operation.issuer.instanceId,
    operationId: operation.operationId,
  })));
}

interface ProductCommit {
  readonly shell: JsonValue;
  readonly events: readonly { readonly type: string; readonly payload: JsonRecord }[];
}

class ProductEditor {
  private product: JsonRecord;
  private readonly context: EngineContext;
  private readonly events: { type: string; payload: JsonRecord }[] = [];

  constructor(context: EngineContext, product: JsonRecord) {
    this.context = context;
    this.product = product;
  }

  personaName(): string {
    const persona = this.product.persona;
    return isRecord(persona) && typeof persona.name === 'string' ? persona.name : '模拟居民';
  }

  agentPersonaName(): string {
    const agentPersona = this.product.agentPersona;
    return isRecord(agentPersona) && typeof agentPersona.name === 'string' ? agentPersona.name : 'Nimi';
  }

  grants(): readonly JsonValue[] {
    return this.product.grants as readonly JsonValue[];
  }

  grant(grantId: string): JsonRecord | null {
    const found = this.grants().find((entry) => isRecord(entry) && entry.id === grantId);
    return isRecord(found) ? found : null;
  }

  flow(): JsonRecord {
    return this.product.flow as JsonRecord;
  }

  consent(): JsonRecord | null {
    const consent = this.product.consent;
    return isRecord(consent) ? consent : null;
  }

  setPersona(persona: { readonly name: string; readonly id: string; readonly role: string }): void {
    this.product = { ...this.product, persona: { name: persona.name, id: persona.id, role: persona.role } };
    this.events.push({
      type: SIMULATOR_PRODUCT_EVENTS.personaChanged,
      payload: { persona: this.product.persona as JsonValue },
    });
  }

  setAgent(agent: {
    readonly status: SimulatorProductAgentStatus;
    readonly location?: string;
    readonly carry?: string | null;
  }): void {
    const current = this.product.agent as JsonRecord;
    const next: JsonRecord = {
      status: agent.status,
      location: agent.location ?? (current.location as JsonValue),
      carry: agent.carry !== undefined ? agent.carry : (current.carry as JsonValue),
    };
    this.product = { ...this.product, agent: next };
    this.events.push({ type: SIMULATOR_PRODUCT_EVENTS.agentChanged, payload: { ...next } });
  }

  setGrantStatus(grantId: string, status: 'active' | 'revoked'): void {
    const grants = this.grants().map((entry) => (
      isRecord(entry) && entry.id === grantId ? { ...entry, status } : entry
    ));
    this.product = { ...this.product, grants };
    this.events.push({
      type: SIMULATOR_PRODUCT_EVENTS.grantChanged,
      payload: { grantId, status },
    });
  }

  setConsent(consent: { readonly flowId: string; readonly grantId: string; readonly origin: string } | null): void {
    this.product = { ...this.product, consent };
    this.events.push({
      type: SIMULATOR_PRODUCT_EVENTS.consentChanged,
      payload: { consent: consent as JsonValue | null },
    });
  }

  setFlow(flow: JsonRecord): void {
    this.product = { ...this.product, flow };
    this.events.push({ type: SIMULATOR_PRODUCT_EVENTS.flowChanged, payload: { ...flow } });
  }

  appendLedger(input: SimulatorProductLedgerInput): JsonRecord {
    const op = (this.product.opSeq as number) + 1;
    const entry: JsonRecord = {
      id: ledgerId(this.context.epoch, op),
      epoch: this.context.epoch,
      kind: input.kind,
      title: input.title,
      detail: input.detail,
      actors: [...input.actors],
      ...(input.tags ? { tags: [...input.tags] } : {}),
      result: input.result,
      at: formatProductOpTime(op),
    };
    this.product = {
      ...this.product,
      opSeq: op,
      ledger: [...this.product.ledger as readonly JsonValue[], entry],
    };
    this.events.push({
      type: SIMULATOR_PRODUCT_EVENTS.ledgerAppended,
      payload: { entryId: entry.id, kind: input.kind, result: input.result },
    });
    return entry;
  }

  commit(): ProductCommit {
    const shell = this.context.committed.snapshot.shell as JsonRecord;
    return {
      shell: freezeJsonValue({ ...shell, product: this.product }),
      events: this.events,
    };
  }
}

function appendProductEvents(
  context: EngineContext,
  commit: ProductCommit,
  causationOperationId: string,
): void {
  for (const event of commit.events) {
    const schema = PRODUCT_EVENT_SCHEMAS[event.type];
    const validation = schema ? validateSchema(schema, event.payload) : { ok: false as const };
    if (!validation.ok) {
      abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
    }
    const sequence = context.allocators.evt.next();
    const record: SimulatorEventRecord = Object.freeze({
      eventId: formatCanonicalId(context.epoch, 'evt', sequence),
      sequence,
      epoch: context.epoch,
      fullType: event.type,
      ownerModuleId: 'simulator',
      payload: validation.value,
      causationOperationId,
    });
    context.eventLog.push(record);
  }
}

function commitProduct(
  context: EngineContext,
  editor: ProductEditor,
  options: { readonly bumpRevision: boolean; readonly causationOperationId: string },
): void {
  const commit = editor.commit();
  appendProductEvents(context, commit, options.causationOperationId);
  context.committed = freezeCommittedState({
    ...context.committed,
    snapshot: { ...context.committed.snapshot, shell: commit.shell },
    revision: options.bumpRevision ? context.committed.revision + 1 : context.committed.revision,
  });
}

function settleProductCommand(
  context: EngineContext,
  operation: QueuedOperation,
  editor: ProductEditor,
  value: JsonValue,
): void {
  commitProduct(context, editor, { bumpRevision: true, causationOperationId: operation.operationId });
  notifyStateSubscribers(context);
  recordSettlement(context, operation.sequence, operation.settle, simulatorOk(value));
}

function flowDefinition(flowId: string): SimulatorProductFlowDefinition {
  const definition = SIMULATOR_PRODUCT_FLOWS[flowId];
  if (!definition) abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
  return definition;
}

/** The directive published for a step index, or null for engine-effect steps. */
function stepDirective(flow: SimulatorProductFlowDefinition, stepIndex: number): JsonRecord | null {
  const step = flow.steps[stepIndex];
  if (!step) return null;
  return step.type === 'directive' || step.type === 'request' ? directiveOf(step) : null;
}

function beginFlow(
  context: EngineContext,
  operation: QueuedOperation,
  editor: ProductEditor,
  flowId: string,
): void {
  const flow = flowDefinition(flowId);
  const current = editor.flow();
  if (current.status === 'running' || current.status === 'awaiting-consent' || editor.consent() !== null) {
    failOperation(context, operation, 'SIMULATOR_INVALID_LIFECYCLE');
    return;
  }
  const grant = flow.requiredGrant ? editor.grant(flow.requiredGrant) : null;
  if (flow.requiredGrant && !grant) {
    failOperation(context, operation, 'SIMULATOR_INVALID_PAYLOAD');
    return;
  }
  if (grant && grant.status !== 'active') {
    if (flow.consentable) {
      editor.setConsent({ flowId: flow.id, grantId: grant.id as string, origin: flow.origin });
      editor.setFlow({ flowId: flow.id, stepIndex: 0, status: 'awaiting-consent', currentDirective: null });
      settleProductCommand(context, operation, editor, { flowId: flow.id, status: 'awaiting-consent' });
      return;
    }
    editor.appendLedger({
      kind: 'flow',
      title: `${flow.title} · 未提交`,
      detail: `授权「${String(grant.title)}」已被撤销。操作返回稳定的 typed unsupported，未提交任何状态。`,
      actors: [flow.originLabel, '生态共享'],
      result: 'unsupported',
    });
    editor.setFlow({ flowId: flow.id, stepIndex: 0, status: 'blocked', currentDirective: null });
    settleProductCommand(context, operation, editor, { flowId: flow.id, status: 'blocked' });
    return;
  }
  editor.setFlow({
    flowId: flow.id,
    stepIndex: 0,
    status: 'running',
    currentDirective: stepDirective(flow, 0),
  });
  settleProductCommand(context, operation, editor, { flowId: flow.id, status: 'running' });
}

function directiveOf(step: SimulatorProductFlowStep): JsonRecord {
  if (step.type === 'directive') {
    return {
      name: step.name,
      moduleId: step.moduleId ?? null,
      text: step.text ?? null,
      title: step.title ?? null,
      detail: step.detail ?? null,
    };
  }
  if (step.type === 'request') {
    return {
      name: 'request-interaction',
      interactionType: step.interactionType,
      commandType: step.commandType,
      moduleId: step.moduleId,
    };
  }
  abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
  throw new Error('SIMULATOR_PRODUCT_DIRECTIVE_INVALID');
}

function applyFlowStep(
  context: EngineContext,
  operation: QueuedOperation,
  editor: ProductEditor,
): void {
  const current = editor.flow();
  if (current.status !== 'running' || typeof current.flowId !== 'string') {
    failOperation(context, operation, 'SIMULATOR_INVALID_LIFECYCLE');
    return;
  }
  const flow = flowDefinition(current.flowId);
  const stepIndex = current.stepIndex as number;
  const step = flow.steps[stepIndex];
  if (!step) {
    failOperation(context, operation, 'SIMULATOR_INVALID_LIFECYCLE');
    return;
  }
  if (step.type === 'agent') {
    editor.setAgent({ status: step.status, location: step.location, carry: step.carry });
  } else if (step.type === 'ledger') {
    editor.appendLedger({
      kind: step.kind,
      title: step.title,
      detail: step.detail,
      actors: step.actors,
      result: step.result,
    });
  }
  const nextIndex = stepIndex + 1;
  const completed = nextIndex >= flow.steps.length;
  editor.setFlow({
    flowId: flow.id,
    stepIndex: nextIndex,
    status: completed ? 'completed' : 'running',
    currentDirective: completed ? null : stepDirective(flow, nextIndex),
  });
  settleProductCommand(context, operation, editor, {
    flowId: flow.id,
    stepIndex: nextIndex,
    status: completed ? 'completed' : 'running',
  });
}

export function processProductCommand(context: EngineContext, operation: QueuedOperation): boolean {
  const type = operation.type;
  if (!Object.values(SIMULATOR_PRODUCT_COMMANDS).includes(type as never)) return false;
  const payload = operation.payload as JsonRecord;
  const product = requireProductState(context, operation);
  if (product === null) return true;
  const editor = new ProductEditor(context, product);

  if (type === SIMULATOR_PRODUCT_COMMANDS.grantToggle) {
    const grantId = payload.grantId as string;
    const grant = editor.grant(grantId);
    if (!grant) {
      failOperation(context, operation, 'SIMULATOR_INVALID_PAYLOAD');
      return true;
    }
    const next = grant.status === 'active' ? 'revoked' : 'active';
    editor.setGrantStatus(grantId, next);
    editor.appendLedger({
      kind: 'delegation',
      title: next === 'revoked' ? `撤销授权 · ${String(grant.title)}` : `重新授权 · ${String(grant.title)}`,
      detail: next === 'revoked'
        ? `你在基座撤销了「${String(grant.title)}」。依赖它的后续操作将返回稳定的 typed unsupported，且不提交任何状态。`
        : `你在基座重新授权了「${String(grant.title)}」。`,
      actors: [editor.personaName(), String(grant.from)],
      result: next === 'revoked' ? 'info' : 'committed',
    });
    settleProductCommand(context, operation, editor, { grantId, status: next });
    return true;
  }

  if (type === SIMULATOR_PRODUCT_COMMANDS.consentRequest) {
    beginFlow(context, operation, editor, payload.flowId as string);
    return true;
  }

  if (type === SIMULATOR_PRODUCT_COMMANDS.consentResolve) {
    const consent = editor.consent();
    if (!consent) {
      failOperation(context, operation, 'SIMULATOR_INVALID_LIFECYCLE');
      return true;
    }
    const flow = flowDefinition(consent.flowId as string);
    const grant = editor.grant(consent.grantId as string);
    if (!grant) {
      failOperation(context, operation, 'SIMULATOR_INVALID_PAYLOAD');
      return true;
    }
    editor.setConsent(null);
    if (payload.accept === true) {
      if (grant.status !== 'active') editor.setGrantStatus(grant.id as string, 'active');
      editor.appendLedger({
        kind: 'delegation',
        title: `重新授权 · ${String(grant.title)}`,
        detail: `你在基座重新授权了「${String(grant.title)}」。`,
        actors: [editor.personaName(), String(grant.from)],
        result: 'committed',
      });
      editor.setFlow({
        flowId: flow.id,
        stepIndex: 0,
        status: 'running',
        currentDirective: stepDirective(flow, 0),
      });
      settleProductCommand(context, operation, editor, { accepted: true, flowId: flow.id, status: 'running' });
      return true;
    }
    editor.appendLedger({
      kind: 'delegation',
      title: `授权被拒绝 · ${String(grant.title)}`,
      detail: '你拒绝了本次系统级授权请求。未提交任何状态，目标应用未收到内容。',
      actors: [editor.personaName(), editor.agentPersonaName()],
      result: 'denied',
    });
    editor.setFlow({ flowId: flow.id, stepIndex: 0, status: 'denied', currentDirective: null });
    settleProductCommand(context, operation, editor, { accepted: false, flowId: flow.id, status: 'denied' });
    return true;
  }

  if (type === SIMULATOR_PRODUCT_COMMANDS.flowBegin) {
    beginFlow(context, operation, editor, payload.flowId as string);
    return true;
  }

  if (type === SIMULATOR_PRODUCT_COMMANDS.flowStep) {
    applyFlowStep(context, operation, editor);
    return true;
  }

  if (type === SIMULATOR_PRODUCT_COMMANDS.ledgerAppend) {
    const entry = editor.appendLedger({
      kind: payload.kind as SimulatorProductLedgerKind,
      title: payload.title as string,
      detail: payload.detail as string,
      actors: payload.actors as readonly string[],
      tags: payload.tags as readonly string[],
      result: payload.result as SimulatorProductLedgerResult,
    });
    settleProductCommand(context, operation, editor, { entryId: entry.id });
    return true;
  }

  if (type === SIMULATOR_PRODUCT_COMMANDS.agentTransition) {
    editor.setAgent({
      status: payload.status as SimulatorProductAgentStatus,
      location: payload.location as string,
      carry: payload.carry as string | null,
    });
    settleProductCommand(context, operation, editor, { transitioned: true });
    return true;
  }

  if (type === SIMULATOR_PRODUCT_COMMANDS.personaCommit) {
    editor.setPersona({
      name: payload.name as string,
      id: payload.id as string,
      role: payload.role as string,
    });
    settleProductCommand(context, operation, editor, { committed: true });
    return true;
  }

  return false;
}

const INTERACTION_LEDGER_EFFECT_SCHEMA = productLedgerEntrySchema();

function validateInteractionEffects(effects: SimulatorInteractionProductEffects): void {
  if (effects.persona) {
    const validation = validateSchema({
      kind: 'object',
      properties: {
        name: { kind: 'string', minLength: 1, maxLength: 128 },
        id: { kind: 'string', minLength: 1, maxLength: 128 },
        role: { kind: 'string', minLength: 1, maxLength: 128 },
      },
    }, effects.persona as unknown as JsonValue);
    if (!validation.ok) abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
  }
  for (const entry of effects.ledger ?? []) {
    const validation = validateSchema(INTERACTION_LEDGER_EFFECT_SCHEMA, {
      ...entry,
      tags: entry.tags ?? [],
    } as unknown as JsonValue);
    if (!validation.ok) abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
  }
}

/**
 * Applies an interaction's declared product effects to the committed snapshot
 * in place (the caller owns the surrounding atomic commit and revision bump).
 * Returns the replacement partitions plus the product event records to append.
 */
export function applyInteractionProductEffects(
  context: EngineContext,
  effects: SimulatorInteractionProductEffects,
  causationOperationId: string,
): { readonly shell: JsonValue; readonly instances: JsonValue } {
  validateInteractionEffects(effects);
  const product = readProductState(context);
  if (product === null) {
    abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
  }
  const editor = new ProductEditor(context, product as JsonRecord);
  if (effects.persona) editor.setPersona(effects.persona);
  if (effects.agent) editor.setAgent(effects.agent);
  for (const entry of effects.ledger ?? []) editor.appendLedger(entry);
  const commit = editor.commit();

  let instances = context.committed.snapshot.instances as unknown as JsonValue;
  if (effects.routes && effects.routes.length > 0) {
    const mutable = { ...context.committed.snapshot.instances };
    for (const target of effects.routes) {
      if (!isSimulatorRouteState(target.route)) {
        abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
      }
      let routed = 0;
      for (const [instanceId, instance] of Object.entries(mutable)) {
        if (instance.moduleId !== target.moduleId) continue;
        if (instance.status !== 'inactive' && instance.status !== 'active') continue;
        mutable[instanceId] = { ...instance, route: target.route as unknown as typeof instance.route };
        routed += 1;
      }
      if (routed === 0) abortIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
    }
    instances = freezeJsonValue(assertJsonValue(mutable));
  }
  appendProductEvents(context, commit, causationOperationId);
  return { shell: commit.shell, instances };
}
