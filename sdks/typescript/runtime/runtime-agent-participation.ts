import type {
  DescribeParticipationContextBlocksRequest,
  DescribeParticipationContextBlocksResponse,
  DescribeParticipationProfilesRequest,
  DescribeParticipationProfilesResponse,
  ExecuteParticipationRequest,
  ExecuteParticipationResponse,
  GetParticipationCandidateRequest,
  GetParticipationCandidateResponse,
  GetParticipationReplayRequest,
  GetParticipationReplayResponse,
  GetParticipationVerdictsRequest,
  GetParticipationVerdictsResponse,
  ListParticipationAuditEventsRequest,
  ListParticipationAuditEventsResponse,
  RuntimeTypedCallOptions,
  ValidateParticipationRequest,
  ValidateParticipationResponse,
} from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';
import {
  withNimiRuntimeAgentScopes,
  resolveNimiRuntimeAgentSubjectUserId,
  type NimiRuntimeAgentProtectedRuntime,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';

// SDK typed projection for the Runtime Agent Participation family
// (S-RUNTIME-211..S-RUNTIME-220). This surface is projection-only: it never
// constructs prompts, never selects providers/models, never decides verdicts,
// and never commits domain transcripts (S-RUNTIME-211, S-RUNTIME-219).
// Canonical 1:1 Agent Chat stays on runtime.agent.*; participation profiles
// are non-canonical candidate-first surfaces (K-AGCORE-062).

const READ_SCOPE = 'runtime.agent.participation.read';
const COMMAND_SCOPE = 'runtime.agent.participation.write';

export interface NimiRuntimeAgentParticipationClient extends NimiRuntimeAgentProtectedRuntime {
  readonly agent: {
    describeParticipationProfiles(
      request: DescribeParticipationProfilesRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<DescribeParticipationProfilesResponse>;
    describeParticipationContextBlocks(
      request: DescribeParticipationContextBlocksRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<DescribeParticipationContextBlocksResponse>;
    validateParticipation(
      request: ValidateParticipationRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<ValidateParticipationResponse>;
    executeParticipation(
      request: ExecuteParticipationRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<ExecuteParticipationResponse>;
    getParticipationCandidate(
      request: GetParticipationCandidateRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<GetParticipationCandidateResponse>;
    getParticipationVerdicts(
      request: GetParticipationVerdictsRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<GetParticipationVerdictsResponse>;
    listParticipationAuditEvents(
      request: ListParticipationAuditEventsRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<ListParticipationAuditEventsResponse>;
    getParticipationReplay(
      request: GetParticipationReplayRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<GetParticipationReplayResponse>;
  };
}

export interface NimiRuntimeAgentParticipationSurfaceOptions {
  readonly getRuntime: () => NimiRuntimeAgentParticipationClient;
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
}

export interface NimiRuntimeAgentParticipationSurface {
  describeProfiles(
    request?: DescribeParticipationProfilesRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<DescribeParticipationProfilesResponse>;
  describeContextBlocks(
    request?: DescribeParticipationContextBlocksRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<DescribeParticipationContextBlocksResponse>;
  validateRequest(
    request: ValidateParticipationRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ValidateParticipationResponse>;
  execute(
    request: ExecuteParticipationRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ExecuteParticipationResponse>;
  getCandidate(
    request: GetParticipationCandidateRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetParticipationCandidateResponse>;
  getVerdicts(
    request: GetParticipationVerdictsRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetParticipationVerdictsResponse>;
  listAuditEvents(
    request: ListParticipationAuditEventsRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ListParticipationAuditEventsResponse>;
  getReplay(
    request: GetParticipationReplayRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetParticipationReplayResponse>;
}

function participationInputError(message: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode: 'SDK_RUNTIME_PARTICIPATION_INPUT_INVALID',
    actionHint,
    source: 'sdk',
  });
}

function requireText(value: string | undefined, field: string): string {
  const text = (value ?? '').trim();
  if (text === '') {
    participationInputError(
      `participation ${field} is required`,
      `Provide a non-empty ${field}.`,
    );
  }
  return text;
}

export function createNimiRuntimeAgentParticipationSurface(
  options: NimiRuntimeAgentParticipationSurfaceOptions,
): NimiRuntimeAgentParticipationSurface {
  async function bind(): Promise<{
    runtime: NimiRuntimeAgentParticipationClient;
    subjectUserId: string;
  }> {
    const runtime = options.getRuntime();
    const subjectUserId = await resolveNimiRuntimeAgentSubjectUserId(
      options.getSubjectUserId,
      'runtime agent participation requires an authenticated subject user id',
    );
    return { runtime, subjectUserId };
  }

  function read<T>(
    call: (runtime: NimiRuntimeAgentParticipationClient, callOptions: RuntimeTypedCallOptions) => Promise<T>,
  ): Promise<T> {
    return bind().then(({ runtime, subjectUserId }) =>
      withNimiRuntimeAgentScopes(
        { runtime, subjectUserId, withScopes: options.withScopes },
        [READ_SCOPE],
        (callOptions) => call(runtime, callOptions),
      ),
    );
  }

  function command<T>(
    call: (runtime: NimiRuntimeAgentParticipationClient, callOptions: RuntimeTypedCallOptions) => Promise<T>,
  ): Promise<T> {
    return bind().then(({ runtime, subjectUserId }) =>
      withNimiRuntimeAgentScopes(
        { runtime, subjectUserId, withScopes: options.withScopes },
        [COMMAND_SCOPE],
        (callOptions) => call(runtime, callOptions),
      ),
    );
  }

  return {
    async describeProfiles(request = {}, callerOptions) {
      return read((runtime, callOptions) =>
        runtime.agent.describeParticipationProfiles(request, { ...callOptions, ...callerOptions }),
      );
    },
    async describeContextBlocks(request = { profileKind: 0 }, callerOptions) {
      return read((runtime, callOptions) =>
        runtime.agent.describeParticipationContextBlocks(request, { ...callOptions, ...callerOptions }),
      );
    },
    async validateRequest(request, callerOptions) {
      if (!request.spec) {
        participationInputError('participation spec is required', 'Provide request.spec.');
      }
      requireText(request.spec.agentId, 'spec.agentId');
      return command((runtime, callOptions) =>
        runtime.agent.validateParticipation(request, { ...callOptions, ...callerOptions }),
      );
    },
    async execute(request, callerOptions) {
      if (!request.spec) {
        participationInputError('participation spec is required', 'Provide request.spec.');
      }
      requireText(request.spec.agentId, 'spec.agentId');
      requireText(request.spec.requestId, 'spec.requestId');
      return command((runtime, callOptions) =>
        runtime.agent.executeParticipation(request, { ...callOptions, ...callerOptions }),
      );
    },
    async getCandidate(request, callerOptions) {
      requireText(request.participationId, 'participationId');
      return read((runtime, callOptions) =>
        runtime.agent.getParticipationCandidate(request, { ...callOptions, ...callerOptions }),
      );
    },
    async getVerdicts(request, callerOptions) {
      requireText(request.participationId, 'participationId');
      return read((runtime, callOptions) =>
        runtime.agent.getParticipationVerdicts(request, { ...callOptions, ...callerOptions }),
      );
    },
    async listAuditEvents(request, callerOptions) {
      return read((runtime, callOptions) =>
        runtime.agent.listParticipationAuditEvents(request, { ...callOptions, ...callerOptions }),
      );
    },
    async getReplay(request, callerOptions) {
      requireText(request.participationId, 'participationId');
      return read((runtime, callOptions) =>
        runtime.agent.getParticipationReplay(request, { ...callOptions, ...callerOptions }),
      );
    },
  };
}
