import { createTool, type Tool, type ToolAction, type ToolExecutionContext } from '@mastra/core/tools';

import type { NimiJsonObject } from '@nimiplatform/sdk/contracts';
import { type NimiRuntimeAgentDelegatedCapabilitySurface } from '@nimiplatform/sdk/runtime';

export const NIMI_MASTRA_RUNTIME_DELEGATED_TOOL_ERROR_CODE = 'runtime_delegated_tool_error' as const;
export const NIMI_MASTRA_RUNTIME_DELEGATED_TOOL_APPROVAL_REQUIRED_CODE = 'runtime_delegated_tool_approval_required' as const;

export type NimiMastraRuntimeDelegatedToolValue<TInput, TValue> =
  | TValue
  | ((input: TInput, context: ToolExecutionContext) => TValue | Promise<TValue>);

export interface NimiMastraRuntimeDelegatedToolBinding<TInput> {
  readonly runtime: NimiRuntimeAgentDelegatedCapabilitySurface;
  readonly ownerUserId: NimiMastraRuntimeDelegatedToolValue<TInput, string>;
  readonly runtimeSourceRef: NimiMastraRuntimeDelegatedToolValue<TInput, string>;
  readonly localAgentRef: NimiMastraRuntimeDelegatedToolValue<TInput, string>;
  readonly conversationAnchorId: NimiMastraRuntimeDelegatedToolValue<TInput, string>;
  readonly turnId: NimiMastraRuntimeDelegatedToolValue<TInput, string>;
  readonly streamId?: NimiMastraRuntimeDelegatedToolValue<TInput, string | undefined>;
  readonly requestId?: NimiMastraRuntimeDelegatedToolValue<TInput, string | undefined>;
  readonly providerProfileId: NimiMastraRuntimeDelegatedToolValue<TInput, string>;
  readonly capabilityId: NimiMastraRuntimeDelegatedToolValue<TInput, string>;
  readonly descriptorHash: NimiMastraRuntimeDelegatedToolValue<TInput, string>;
  readonly protocolRevision?: NimiMastraRuntimeDelegatedToolValue<TInput, string | undefined>;
  readonly outputKind?: NimiMastraRuntimeDelegatedToolValue<TInput, string | undefined>;
  readonly requiresApproval?: NimiMastraRuntimeDelegatedToolValue<TInput, boolean | undefined>;
}

export interface NimiMastraRuntimeTurnBinding {
  readonly runtime: NimiRuntimeAgentDelegatedCapabilitySurface;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly conversationAnchorId: string;
  readonly turnId: string;
  readonly streamId?: string;
  readonly requestId?: string;
  readonly providerProfileId: string;
  readonly protocolRevision?: string;
  readonly outputKind?: string;
  readonly requiresApproval?: boolean;
}

export interface NimiMastraRuntimeDelegatedToolBindingOptions extends NimiMastraRuntimeTurnBinding {
  readonly capabilityId: string;
  readonly descriptorHash: string;
}

export interface NimiMastraRuntimeDelegatedToolOptions<
  TInput extends NimiJsonObject = NimiJsonObject,
  TOutput extends NimiJsonObject = NimiJsonObject,
> {
  readonly id: string;
  readonly description: string;
  readonly inputSchema?: ToolAction<TInput, TOutput>['inputSchema'];
  readonly outputSchema?: ToolAction<TInput, TOutput>['outputSchema'];
  readonly binding: NimiMastraRuntimeDelegatedToolBinding<TInput>;
}

export interface NimiMastraRuntimeDelegatedToolResumeOptions {
  readonly runtime: NimiRuntimeAgentDelegatedCapabilitySurface;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly approvalRequestId: string;
}

export class NimiMastraRuntimeDelegatedToolError extends Error {
  readonly code = NIMI_MASTRA_RUNTIME_DELEGATED_TOOL_ERROR_CODE;
  readonly reasonCode: string;

  constructor(message: string, reasonCode: string) {
    super(message);
    this.name = 'NimiMastraRuntimeDelegatedToolError';
    this.reasonCode = reasonCode;
  }
}

export class NimiMastraRuntimeDelegatedToolApprovalRequiredError extends Error {
  readonly code = NIMI_MASTRA_RUNTIME_DELEGATED_TOOL_APPROVAL_REQUIRED_CODE;
  readonly approvalRequestId: string;
  readonly response: NimiMastraRuntimeDelegatedExecutionResponse;

  constructor(approvalRequestId: string, response: NimiMastraRuntimeDelegatedExecutionResponse) {
    super(`Runtime delegated tool approval required: ${approvalRequestId}`);
    this.name = 'NimiMastraRuntimeDelegatedToolApprovalRequiredError';
    this.approvalRequestId = approvalRequestId;
    this.response = response;
  }
}

type NimiMastraRuntimeDelegatedExecutionResponse =
  Awaited<ReturnType<NimiRuntimeAgentDelegatedCapabilitySurface['executeCapability']>>;
type NimiMastraRuntimeDelegatedResumeResponse =
  Awaited<ReturnType<NimiRuntimeAgentDelegatedCapabilitySurface['resumeApprovedCapability']>>;

export function createNimiMastraRuntimeDelegatedToolBinding<
  TInput extends NimiJsonObject = NimiJsonObject,
>(options: NimiMastraRuntimeDelegatedToolBindingOptions): NimiMastraRuntimeDelegatedToolBinding<TInput> {
  if (!options || !options.runtime) {
    throw new NimiMastraRuntimeDelegatedToolError(
      'Nimi Mastra Runtime delegated tool binding requires a Runtime delegation surface.',
      'NIMI_MASTRA_RUNTIME_DELEGATED_TOOL_RUNTIME_REQUIRED',
    );
  }
  return {
    runtime: options.runtime,
    ownerUserId: requireText(options.ownerUserId, 'owner_user_id'),
    runtimeSourceRef: requireText(options.runtimeSourceRef, 'runtime_source_ref'),
    localAgentRef: requireText(options.localAgentRef, 'local_agent_ref'),
    conversationAnchorId: requireText(options.conversationAnchorId, 'conversation_anchor_id'),
    turnId: requireText(options.turnId, 'turn_id'),
    streamId: normalizeText(options.streamId) || undefined,
    requestId: normalizeText(options.requestId) || undefined,
    providerProfileId: requireText(options.providerProfileId, 'provider_profile_id'),
    capabilityId: requireText(options.capabilityId, 'capability_id'),
    descriptorHash: requireText(options.descriptorHash, 'descriptor_hash'),
    protocolRevision: normalizeText(options.protocolRevision) || undefined,
    outputKind: normalizeText(options.outputKind) || undefined,
    requiresApproval: options.requiresApproval,
  };
}

export function createNimiMastraRuntimeDelegatedTool<
  TInput extends NimiJsonObject = NimiJsonObject,
  TOutput extends NimiJsonObject = NimiJsonObject,
>(options: NimiMastraRuntimeDelegatedToolOptions<TInput, TOutput>): Tool<TInput, TOutput> {
  if (!options || !options.binding || !options.binding.runtime) {
    throw new NimiMastraRuntimeDelegatedToolError(
      'Nimi Mastra Runtime delegated tool requires a Runtime delegation surface.',
      'NIMI_MASTRA_RUNTIME_DELEGATED_TOOL_RUNTIME_REQUIRED',
    );
  }
  const id = requireText(options.id, 'tool id');
  const toolAction: ToolAction<TInput, TOutput, unknown, unknown, ToolExecutionContext, string> = {
    id,
    description: requireText(options.description, 'tool description'),
    inputSchema: options.inputSchema,
    outputSchema: options.outputSchema,
    execute: async (input, context) => {
      const inputObject = requireJsonObject(input, 'tool input') as TInput;
      const binding = options.binding;
      const response = await binding.runtime.executeCapability({
        ownerUserId: await resolveText(binding.ownerUserId, inputObject, context, 'owner_user_id'),
        runtimeSourceRef: await resolveText(binding.runtimeSourceRef, inputObject, context, 'runtime_source_ref'),
        localAgentRef: await resolveText(binding.localAgentRef, inputObject, context, 'local_agent_ref'),
        conversationAnchorId: await resolveText(binding.conversationAnchorId, inputObject, context, 'conversation_anchor_id'),
        turnId: await resolveText(binding.turnId, inputObject, context, 'turn_id'),
        streamId: await resolveOptionalText(binding.streamId, inputObject, context),
        requestId: await resolveOptionalText(binding.requestId, inputObject, context),
        providerProfileId: await resolveText(binding.providerProfileId, inputObject, context, 'provider_profile_id'),
        capabilityId: await resolveText(binding.capabilityId, inputObject, context, 'capability_id'),
        toolName: id,
        arguments: inputObject,
        descriptorHash: await resolveText(binding.descriptorHash, inputObject, context, 'descriptor_hash'),
        protocolRevision: await resolveOptionalText(binding.protocolRevision, inputObject, context),
        outputKind: await resolveOptionalText(binding.outputKind, inputObject, context),
        requiresApproval: await resolveOptionalBoolean(binding.requiresApproval, inputObject, context),
      });
      return delegatedExecutionOutput(response) as TOutput;
    },
  };
  const createTypedTool = createTool as unknown as (
    action: ToolAction<TInput, TOutput, unknown, unknown, ToolExecutionContext, string>,
  ) => Tool<TInput, TOutput>;
  return createTypedTool(toolAction);
}

export async function resumeNimiMastraRuntimeDelegatedTool(
  options: NimiMastraRuntimeDelegatedToolResumeOptions,
): Promise<NimiJsonObject> {
  if (!options || !options.runtime) {
    throw new NimiMastraRuntimeDelegatedToolError(
      'Nimi Mastra Runtime delegated tool resume requires a Runtime delegation surface.',
      'NIMI_MASTRA_RUNTIME_DELEGATED_TOOL_RUNTIME_REQUIRED',
    );
  }
  const response = await options.runtime.resumeApprovedCapability({
    ownerUserId: requireText(options.ownerUserId, 'owner_user_id'),
    runtimeSourceRef: requireText(options.runtimeSourceRef, 'runtime_source_ref'),
    localAgentRef: requireText(options.localAgentRef, 'local_agent_ref'),
    approvalRequestId: requireText(options.approvalRequestId, 'approval_request_id'),
  });
  return delegatedResumeOutput(response);
}

function delegatedExecutionOutput(response: NimiMastraRuntimeDelegatedExecutionResponse): NimiJsonObject {
  if (response.approvalRequest || response.diagnostic?.runtimeDecision === 'approval_required') {
    const approvalRequestId = normalizeText(response.approvalRequest?.approvalRequestId);
    if (!approvalRequestId) {
      throw new NimiMastraRuntimeDelegatedToolError(
        'Runtime delegated tool approval response did not include approval_request_id.',
        'NIMI_MASTRA_RUNTIME_DELEGATED_TOOL_APPROVAL_REQUEST_ID_MISSING',
      );
    }
    throw new NimiMastraRuntimeDelegatedToolApprovalRequiredError(approvalRequestId, response);
  }
  requireAcceptedFirewallVerdict(response.diagnostic?.firewallVerdict, 'executeDelegatedCapability');
  return requireModelOutput(response.output, 'executeDelegatedCapability');
}

function delegatedResumeOutput(response: NimiMastraRuntimeDelegatedResumeResponse): NimiJsonObject {
  requireAcceptedFirewallVerdict(response.diagnostic?.firewallVerdict, 'resumeDelegatedCapability');
  return requireModelOutput(response.output, 'resumeDelegatedCapability');
}

function requireAcceptedFirewallVerdict(verdict: unknown, methodName: string): void {
  const normalized = normalizeText(verdict).toUpperCase();
  if (!normalized.startsWith('ACCEPTED_')) {
    throw new NimiMastraRuntimeDelegatedToolError(
      `Runtime ${methodName} returned model_output without accepted firewall verdict evidence.`,
      'NIMI_MASTRA_RUNTIME_DELEGATED_TOOL_FIREWALL_VERDICT_REQUIRED',
    );
  }
}

function requireModelOutput(output: NimiJsonObject | undefined, methodName: string): NimiJsonObject {
  if (!output) {
    throw new NimiMastraRuntimeDelegatedToolError(
      `Runtime ${methodName} returned no output for delegated tool execution.`,
      'NIMI_MASTRA_RUNTIME_DELEGATED_TOOL_MODEL_OUTPUT_MISSING',
    );
  }
  return output;
}

async function resolveText<TInput>(
  value: NimiMastraRuntimeDelegatedToolValue<TInput, string>,
  input: TInput,
  context: ToolExecutionContext,
  field: string,
): Promise<string> {
  return requireText(await resolveValue(value, input, context), field);
}

async function resolveOptionalText<TInput>(
  value: NimiMastraRuntimeDelegatedToolValue<TInput, string | undefined> | undefined,
  input: TInput,
  context: ToolExecutionContext,
): Promise<string | undefined> {
  if (value === undefined) {
    return undefined;
  }
  const resolved = normalizeText(await resolveValue(value, input, context));
  return resolved || undefined;
}

async function resolveOptionalBoolean<TInput>(
  value: NimiMastraRuntimeDelegatedToolValue<TInput, boolean | undefined> | undefined,
  input: TInput,
  context: ToolExecutionContext,
): Promise<boolean | undefined> {
  if (value === undefined) {
    return undefined;
  }
  const resolved = await resolveValue(value, input, context);
  if (resolved === undefined) {
    return undefined;
  }
  if (typeof resolved !== 'boolean') {
    throw new NimiMastraRuntimeDelegatedToolError(
      'Runtime delegated tool requires requiresApproval to resolve to a boolean.',
      'NIMI_MASTRA_RUNTIME_DELEGATED_TOOL_INPUT_INVALID',
    );
  }
  return resolved;
}

async function resolveValue<TInput, TValue>(
  value: NimiMastraRuntimeDelegatedToolValue<TInput, TValue>,
  input: TInput,
  context: ToolExecutionContext,
): Promise<TValue> {
  return typeof value === 'function'
    ? await (value as (input: TInput, context: ToolExecutionContext) => TValue | Promise<TValue>)(input, context)
    : value;
}

function requireText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new NimiMastraRuntimeDelegatedToolError(
      `Runtime delegated tool requires ${field}.`,
      'NIMI_MASTRA_RUNTIME_DELEGATED_TOOL_INPUT_INVALID',
    );
  }
  return normalized;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireJsonObject(value: unknown, field: string): NimiJsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NimiMastraRuntimeDelegatedToolError(
      `Runtime delegated tool requires ${field} to be a JSON object.`,
      'NIMI_MASTRA_RUNTIME_DELEGATED_TOOL_INPUT_INVALID',
    );
  }
  return value as NimiJsonObject;
}
