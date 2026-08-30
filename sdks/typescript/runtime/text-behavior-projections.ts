import {
  LocalCapabilityReason,
  TextBehaviorConfigurationState,
  type TextBehaviorCapabilityProjection,
  type ToolUseCapabilityProjection,
} from '../core-generated/runtime-protobuf/runtime/v1/capability_configuration.js';
import {
  TextBehaviorKind,
  ToolChoiceMode,
  ToolSpecKind,
} from '../core-generated/runtime-protobuf/runtime/v1/common.js';
import type { NimiTextBehaviorKind } from '../core/contracts/index.js';
import { createNimiError, ReasonCode } from '../types/index.js';

export type NimiToolSpecKind = 'function' | 'provider';
export type NimiToolChoiceMode = 'auto' | 'none' | 'required' | 'tool';
export type NimiTextBehaviorConfigurationState = 'unavailable' | 'configured' | 'ambiguous';

export interface NimiToolUseCapabilityProjection {
  readonly supportedToolSpecKinds: readonly NimiToolSpecKind[];
  readonly supportedToolChoiceModes: readonly NimiToolChoiceMode[];
  readonly supportsSingleCall: boolean;
  readonly supportsMultipleCalls: boolean;
  readonly supportsParallelCalls: boolean;
  readonly supportsSync: boolean;
  readonly supportsStream: boolean;
  readonly supportsToolOnlyResponse: boolean;
  readonly supportsToolResultRoundTrip: boolean;
  readonly supportsMixedTextAndToolCalls: boolean;
}

export interface NimiTextBehaviorCapabilityProjection {
  readonly kind: NimiTextBehaviorKind;
  readonly implementationSupported: boolean;
  readonly configurationState: NimiTextBehaviorConfigurationState;
  readonly reasons: readonly string[];
  readonly implementationToolUse?: NimiToolUseCapabilityProjection;
  readonly configuredToolUse?: NimiToolUseCapabilityProjection;
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r121
export function projectNimiTextBehaviorCapabilities(
  values: readonly TextBehaviorCapabilityProjection[],
): readonly NimiTextBehaviorCapabilityProjection[] {
  return Object.freeze(values.map(projectNimiTextBehaviorCapability));
}

function projectNimiTextBehaviorCapability(
  value: TextBehaviorCapabilityProjection,
): NimiTextBehaviorCapabilityProjection {
  const kind = textBehaviorKind(value.kind);
  if (kind !== 'tool-use' && (value.implementationToolUse || value.configuredToolUse)) {
    invalidProjection('Non-Tool-Use text behavior carried Tool Use primitives');
  }
  return Object.freeze({
    kind,
    implementationSupported: value.implementationSupported,
    configurationState: configurationState(value.configurationState),
    reasons: Object.freeze(value.reasons.map(localCapabilityReason)),
    ...(value.implementationToolUse
      ? { implementationToolUse: projectToolUseCapability(value.implementationToolUse) }
      : {}),
    ...(value.configuredToolUse
      ? { configuredToolUse: projectToolUseCapability(value.configuredToolUse) }
      : {}),
  });
}

function projectToolUseCapability(value: ToolUseCapabilityProjection): NimiToolUseCapabilityProjection {
  return Object.freeze({
    supportedToolSpecKinds: Object.freeze(value.supportedToolSpecKinds.map(toolSpecKind)),
    supportedToolChoiceModes: Object.freeze(value.supportedToolChoiceModes.map(toolChoiceMode)),
    supportsSingleCall: value.supportsSingleCall,
    supportsMultipleCalls: value.supportsMultipleCalls,
    supportsParallelCalls: value.supportsParallelCalls,
    supportsSync: value.supportsSync,
    supportsStream: value.supportsStream,
    supportsToolOnlyResponse: value.supportsToolOnlyResponse,
    supportsToolResultRoundTrip: value.supportsToolResultRoundTrip,
    supportsMixedTextAndToolCalls: value.supportsMixedTextAndToolCalls,
  });
}

function textBehaviorKind(value: TextBehaviorKind): NimiTextBehaviorKind {
  switch (value) {
    case TextBehaviorKind.TOOL_USE: return 'tool-use';
    case TextBehaviorKind.REASONING: return 'reasoning';
    case TextBehaviorKind.STRUCTURED_OUTPUT: return 'structured-output';
    default: return invalidProjection('Text behavior kind is unspecified');
  }
}

function configurationState(value: TextBehaviorConfigurationState): NimiTextBehaviorConfigurationState {
  switch (value) {
    case TextBehaviorConfigurationState.UNAVAILABLE: return 'unavailable';
    case TextBehaviorConfigurationState.CONFIGURED: return 'configured';
    case TextBehaviorConfigurationState.AMBIGUOUS: return 'ambiguous';
    default: return invalidProjection('Text behavior configuration state is unspecified');
  }
}

function toolSpecKind(value: ToolSpecKind): NimiToolSpecKind {
  switch (value) {
    case ToolSpecKind.FUNCTION: return 'function';
    case ToolSpecKind.PROVIDER: return 'provider';
    default: return invalidProjection('ToolSpec kind is unspecified');
  }
}

function toolChoiceMode(value: ToolChoiceMode): NimiToolChoiceMode {
  switch (value) {
    case ToolChoiceMode.AUTO: return 'auto';
    case ToolChoiceMode.NONE: return 'none';
    case ToolChoiceMode.REQUIRED: return 'required';
    case ToolChoiceMode.TOOL: return 'tool';
    default: return invalidProjection('Tool choice mode is unspecified');
  }
}

function localCapabilityReason(value: LocalCapabilityReason): string {
  const name = LocalCapabilityReason[value];
  if (!name || name === 'UNSPECIFIED') {
    invalidProjection('Local capability reason is unspecified');
  }
  return name;
}

function invalidProjection(message: string): never {
  throw createNimiError({
    source: 'runtime',
    reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    message,
    actionHint: 'inspect_runtime_text_behavior_projection',
  });
}
