// SDK Default Experience client.
//
// Implements the same contract as the typed RuntimeAdapter that Wave 1's
// Desktop bridge consumes. Takes an injected DefaultExperienceTransport
// from the host. Validates canonical dimension enums on every response;
// any non-canonical value is rejected with a typed DefaultExperienceClientError.

import type { DefaultExperienceTransport } from './transport.js';
import {
  isCanonicalApplicableScope,
  isCanonicalColdStartState,
  isCanonicalComputePosture,
  isCanonicalPrivacyPosture,
  isCanonicalRoutingPolicy,
  type ApplicableScope,
  type ApplyResult,
  type ColdStartProjection,
  type DefaultExperienceProfile,
  type HostProfile,
  type ProfilePreferences,
  type ScopeRef,
  type UpstreamInputs,
} from './types.js';

export class DefaultExperienceClientError extends Error {
  readonly code:
    | 'invalid-dependency'
    | 'transport-error'
    | 'non-canonical-response'
    | 'missing-required-field';
  constructor(
    code: DefaultExperienceClientError['code'],
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.code = code;
    this.name = 'DefaultExperienceClientError';
  }
}

export class DefaultExperienceClient {
  constructor(private readonly transport: DefaultExperienceTransport) {
    if (transport === null || transport === undefined) {
      throw new DefaultExperienceClientError(
        'invalid-dependency',
        'DefaultExperienceClient: transport is required',
      );
    }
  }

  async hostProfile(): Promise<HostProfile> {
    let response;
    try {
      response = await this.transport.hostProfile();
    } catch (error) {
      throw new DefaultExperienceClientError('transport-error', 'hostProfile transport error', error);
    }
    if (!response || typeof response.profileId !== 'string' || response.profileId.length === 0) {
      throw new DefaultExperienceClientError(
        'missing-required-field',
        'hostProfile response missing profileId',
      );
    }
    if (!response.platform || typeof response.platform.os !== 'string' || typeof response.platform.arch !== 'string') {
      throw new DefaultExperienceClientError(
        'missing-required-field',
        'hostProfile response missing platform.os or platform.arch',
      );
    }
    return response;
  }

  async recommendProfile(
    scope: ApplicableScope,
    preferences?: ProfilePreferences,
  ): Promise<DefaultExperienceProfile> {
    if (!isCanonicalApplicableScope(scope)) {
      throw new DefaultExperienceClientError(
        'missing-required-field',
        `recommendProfile: scope "${String(scope)}" is not a canonical ApplicableScope`,
      );
    }
    let response;
    try {
      response = await this.transport.recommendProfile(scope, preferences);
    } catch (error) {
      throw new DefaultExperienceClientError('transport-error', 'recommendProfile transport error', error);
    }
    validateProfile(response);
    return response;
  }

  async applyProfile(scopeRef: ScopeRef, profileId: string): Promise<ApplyResult> {
    if (!scopeRef || typeof scopeRef.id !== 'string' || scopeRef.id.length === 0) {
      throw new DefaultExperienceClientError('missing-required-field', 'applyProfile: scopeRef.id is required');
    }
    if (typeof profileId !== 'string' || profileId.length === 0) {
      throw new DefaultExperienceClientError('missing-required-field', 'applyProfile: profileId is required');
    }
    let response;
    try {
      response = await this.transport.applyProfile(scopeRef, profileId);
    } catch (error) {
      throw new DefaultExperienceClientError('transport-error', 'applyProfile transport error', error);
    }
    if (!response || typeof response.applied !== 'boolean') {
      throw new DefaultExperienceClientError(
        'missing-required-field',
        'applyProfile response missing applied boolean',
      );
    }
    return response;
  }

  async projectColdStart(inputs: UpstreamInputs): Promise<ColdStartProjection> {
    validateUpstreamInputs(inputs);
    let response;
    try {
      response = await this.transport.projectColdStart(inputs);
    } catch (error) {
      throw new DefaultExperienceClientError('transport-error', 'projectColdStart transport error', error);
    }
    if (!response || !isCanonicalColdStartState(response.state)) {
      throw new DefaultExperienceClientError(
        'non-canonical-response',
        `projectColdStart response state "${String(response?.state)}" is not canonical`,
      );
    }
    return response;
  }
}

function validateProfile(profile: DefaultExperienceProfile | null | undefined): void {
  if (!profile) {
    throw new DefaultExperienceClientError('missing-required-field', 'recommendProfile: response is null/undefined');
  }
  if (typeof profile.alias !== 'string' || profile.alias.length === 0) {
    throw new DefaultExperienceClientError('missing-required-field', 'recommendProfile: alias is required');
  }
  if (!isCanonicalPrivacyPosture(profile.privacyPosture)) {
    throw new DefaultExperienceClientError(
      'non-canonical-response',
      `recommendProfile: privacyPosture "${String(profile.privacyPosture)}" is not canonical`,
    );
  }
  if (!isCanonicalComputePosture(profile.computePosture)) {
    throw new DefaultExperienceClientError(
      'non-canonical-response',
      `recommendProfile: computePosture "${String(profile.computePosture)}" is not canonical`,
    );
  }
  if (!isCanonicalRoutingPolicy(profile.routingPolicy)) {
    throw new DefaultExperienceClientError(
      'non-canonical-response',
      `recommendProfile: routingPolicy "${String(profile.routingPolicy)}" is not canonical`,
    );
  }
  for (const scope of profile.applicableScopes ?? []) {
    if (!isCanonicalApplicableScope(scope)) {
      throw new DefaultExperienceClientError(
        'non-canonical-response',
        `recommendProfile: applicableScopes contains non-canonical "${String(scope)}"`,
      );
    }
  }
}

function validateUpstreamInputs(inputs: UpstreamInputs | null | undefined): void {
  if (!inputs) {
    throw new DefaultExperienceClientError('missing-required-field', 'projectColdStart: inputs is required');
  }
  const fields: ReadonlyArray<{ name: string; value: unknown }> = [
    { name: 'runtimeDaemon', value: inputs.runtimeDaemon },
    { name: 'account', value: inputs.account },
    { name: 'defaultExperienceProfile', value: inputs.defaultExperienceProfile },
    { name: 'materialization', value: inputs.materialization },
    { name: 'appRegistry', value: inputs.appRegistry },
    { name: 'cognitionMemory', value: inputs.cognitionMemory },
  ];
  for (const field of fields) {
    if (!isCanonicalColdStartState(field.value)) {
      throw new DefaultExperienceClientError(
        'missing-required-field',
        `projectColdStart: ${field.name} value "${String(field.value)}" is not a canonical ColdStartState`,
      );
    }
  }
}
