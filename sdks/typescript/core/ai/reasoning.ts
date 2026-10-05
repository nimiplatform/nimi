import { ReasoningActivation, ReasoningEffort, ReasoningPresentation, type ReasoningConfig } from '../../core-generated/runtime-protobuf/runtime/v1/ai';
import { createNimiError } from '../../types';

export type NimiRuntimeAIReasoningActivation = 'disabled' | 'adaptive' | 'required';
export type NimiRuntimeAIReasoningPresentation = 'hidden' | 'summary';
export type NimiRuntimeAIReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'maximum';

export type NimiReasoningInputCapabilities = {
  readonly followsModelDefault: true;
  readonly supportsDisabled: boolean;
  readonly supportsRequired: boolean;
  readonly supportsAdaptive: boolean;
  readonly efforts: readonly NimiRuntimeAIReasoningEffort[];
  readonly supportsBudget: boolean;
  readonly presentations: readonly NimiRuntimeAIReasoningPresentation[];
};

export function projectReasoningInputCapabilities(value: unknown, fail: (detail: string) => never = (detail) => { throw createNimiError({ code:'SDK_AI_RUNTIME_OUTPUT_INVALID',reasonCode:'SDK_AI_RUNTIME_OUTPUT_INVALID',message:detail,source:'sdk',retryable:false }); }): NimiReasoningInputCapabilities {
  const record = value as Record<string, unknown>;
  const keys = ['followsModelDefault', 'supportsDisabled', 'supportsRequired', 'supportsAdaptive', 'efforts', 'supportsBudget', 'presentations'];
  if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).length !== keys.length || Object.keys(record).some((key) => !keys.includes(key))
    || record.followsModelDefault !== true || ['supportsDisabled', 'supportsRequired', 'supportsAdaptive', 'supportsBudget'].some((key) => typeof record[key] !== 'boolean')
    || !Array.isArray(record.efforts) || new Set(record.efforts).size !== record.efforts.length || record.efforts.some((effort) => !['minimal', 'low', 'medium', 'high', 'xhigh', 'maximum'].includes(effort))
    || !Array.isArray(record.presentations) || new Set(record.presentations).size !== record.presentations.length || record.presentations.some((presentation) => !['hidden', 'summary'].includes(presentation))) return fail('Invalid reasoning input capabilities');
  return Object.freeze({ ...record, efforts: Object.freeze([...record.efforts]), presentations: Object.freeze([...record.presentations]) }) as NimiReasoningInputCapabilities;
}

export type NimiRuntimeAIReasoningOptions =
  | {
      readonly activation?: 'disabled';
      readonly presentation?: 'hidden';
      readonly effort?: never;
      readonly exactBudgetTokens?: never;
    }
  | {
      readonly activation: 'adaptive' | 'required';
      readonly presentation?: NimiRuntimeAIReasoningPresentation;
      readonly effort: NimiRuntimeAIReasoningEffort;
      readonly exactBudgetTokens?: never;
    }
  | {
      readonly activation: 'adaptive' | 'required';
      readonly presentation?: NimiRuntimeAIReasoningPresentation;
      readonly effort?: never;
      readonly exactBudgetTokens: number;
    };

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
export function toRuntimeReasoningConfig(reasoning: NimiRuntimeAIReasoningOptions | undefined, runtimeInputInvalid: (detail: string) => never): ReasoningConfig | undefined {
  if (reasoning === undefined) return undefined;
  if (!reasoning || typeof reasoning !== 'object' || Array.isArray(reasoning) || Object.keys(reasoning).some((key) => !['activation', 'presentation', 'effort', 'exactBudgetTokens'].includes(key))) return runtimeInputInvalid('Invalid typed reasoning config');
  const activation = reasoning.activation;
  if (activation !== undefined && !['disabled', 'adaptive', 'required'].includes(activation)) return runtimeInputInvalid('Invalid reasoning activation');
  const presentation = reasoning?.presentation ?? 'hidden';
  if (!['hidden', 'summary'].includes(presentation)) return runtimeInputInvalid('Invalid reasoning presentation');
  if (activation === undefined) {
    if (presentation !== 'hidden' || reasoning.effort !== undefined || reasoning.exactBudgetTokens !== undefined) {
      runtimeInputInvalid('Explicit Runtime reasoning controls require an activation');
    }
    return undefined;
  }
  if (activation === 'disabled') {
    if (presentation !== 'hidden' || reasoning?.effort !== undefined || reasoning?.exactBudgetTokens !== undefined) {
      runtimeInputInvalid('Disabled Runtime reasoning admits no intensity and must remain hidden');
    }
    return {
      activation: ReasoningActivation.DISABLED,
      intensity: { oneofKind: undefined },
      presentation: ReasoningPresentation.HIDDEN,
    };
  }
  const hasEffort = reasoning?.effort !== undefined;
  const hasExactBudget = reasoning?.exactBudgetTokens !== undefined;
  if (hasEffort === hasExactBudget) {
    runtimeInputInvalid('Adaptive or required Runtime reasoning requires exactly one effort or exactBudgetTokens intensity');
  }
  if (hasExactBudget) {
    const exactBudgetTokens = reasoning.exactBudgetTokens;
    if (typeof exactBudgetTokens !== 'number' || !Number.isSafeInteger(exactBudgetTokens) || exactBudgetTokens <= 0 || exactBudgetTokens > 0xffff_ffff) {
      runtimeInputInvalid('Runtime reasoning exactBudgetTokens must be a positive safe integer');
    }
    return {
      activation: activation === 'adaptive' ? ReasoningActivation.ADAPTIVE : ReasoningActivation.REQUIRED,
      intensity: { oneofKind: 'exactBudgetTokens', exactBudgetTokens },
      presentation: presentation === 'summary' ? ReasoningPresentation.SUMMARY : ReasoningPresentation.HIDDEN,
    };
  }
  return {
    activation: activation === 'adaptive' ? ReasoningActivation.ADAPTIVE : ReasoningActivation.REQUIRED,
    intensity: { oneofKind: 'effort', effort: toRuntimeReasoningEffort(reasoning?.effort, runtimeInputInvalid) },
    presentation: presentation === 'summary' ? ReasoningPresentation.SUMMARY : ReasoningPresentation.HIDDEN,
  };
}

function toRuntimeReasoningEffort(effort: NimiRuntimeAIReasoningEffort | undefined, runtimeInputInvalid: (detail: string) => never): ReasoningEffort {
  switch (effort) {
    case 'minimal': return ReasoningEffort.MINIMAL;
    case 'low': return ReasoningEffort.LOW;
    case 'medium': return ReasoningEffort.MEDIUM;
    case 'high': return ReasoningEffort.HIGH;
    case 'xhigh': return ReasoningEffort.XHIGH;
    case 'maximum': return ReasoningEffort.MAXIMUM;
    default: return runtimeInputInvalid('Runtime reasoning effort is invalid');
  }
}
