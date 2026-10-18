import {
  getNimiRuntimeReasonCodeMessage,
  extractNimiRuntimeReasonCodeFromError,
  NIMI_CHATGPT_PLAN_MANAGE_USAGE_ACTION_HINT,
  NIMI_CHATGPT_PLAN_REAUTHORIZE_ACTION_HINT,
  toNimiRuntimeUserFacingError,
} from '@nimiplatform/sdk/runtime';
import type { TFunction } from 'i18next';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';

function translateMessage(
  t: TFunction,
  key: string,
  defaultValue: string,
): string {
  const translated = t(key, { defaultValue });
  return typeof translated === 'string' && translated.trim().length > 0
    ? translated
    : defaultValue;
}

export function chatRuntimeReasonCodeMessage(
  reasonCode: string,
  t: TFunction,
  context?: ChatRuntimeErrorContext,
): string | null {
  reasonCode = reasonCode.trim().toUpperCase().replaceAll('-', '_');
  if (context?.localAgent && localAgentConfigurationFailure(reasonCode)) {
    return reasonCode === 'AI_TEXT_BEHAVIOR_UNSUPPORTED'
      ? translateMessage(t, 'Chat.agentIntegrationUnsupported', 'This configuration and integration cannot handle this request yet. Open Agent Center to choose another model configuration.')
      : translateMessage(t, 'Chat.agentConfigurationUnavailable', 'The current model configuration cannot run this request. Check Models and Diagnostics in Agent Center, then try again.');
  }
  if (reasonCode === 'AI_LOCAL_CONFIGURATION_NOT_CONFIGURED') {
    return translateMessage(t, 'Chat.localConfigurationRequired', 'This task has no ready local model. Open AI Capabilities to finish its setup, then try again.');
  }
  if (reasonCode === 'AI_TEXT_BEHAVIOR_UNSUPPORTED') {
    return translateMessage(t, 'Chat.textBehaviorUnsupported', 'This configuration and integration cannot handle this request yet. Choose another configuration in AI Capabilities, then try again.');
  }
  if (reasonCode === 'AGENT_BUSY' || reasonCode === 'agent-busy') {
    return translateMessage(t, 'Chat.agentBusyRetry', 'This partner is busy with another request. Your input is saved here; try sending again shortly.');
  }
  if (reasonCode === 'AI_REMOTE_MODEL_CATALOG_STALE') {
    return translateMessage(t, 'Chat.nimiCatalogStale', 'The saved cloud model changed. Choose it again in AI Capabilities, then send your message.');
  }
  if (reasonCode === 'CAPABILITY_CATALOG_MISMATCH') {
    return translateMessage(t, 'Chat.nimiCatalogMismatch', 'This model lacks verified details needed to run. Choose another model in AI Capabilities, then send your message.');
  }
  if (reasonCode === 'AI_CONFIG_INVALID') {
    return translateMessage(t, 'Chat.nimiConfigInvalid', 'The selected model cannot run. Choose another model in AI Capabilities, then send your message.');
  }
  const entry = getNimiRuntimeReasonCodeMessage(reasonCode);
  if (!entry) {
    return null;
  }
  return translateMessage(t, `BridgeErrors.codes.${entry.reasonCode}`, entry.defaultMessage);
}

export type ChatRuntimeErrorContext = {
  readonly localAgent?: boolean;
  /** The failed call ran on the committed ChatGPT plan Cloud route. */
  readonly chatGPTPlanRoute?: boolean;
};

export function localAgentConfigurationFailure(reasonCode: string): boolean {
  return ['AI_LOCAL_CONFIGURATION_NOT_CONFIGURED', 'AI_TEXT_BEHAVIOR_UNSUPPORTED',
    'AI_REMOTE_MODEL_CATALOG_STALE', 'CAPABILITY_CATALOG_MISMATCH', 'AI_CONFIG_INVALID']
    .includes(reasonCode.trim().toUpperCase().replaceAll('-', '_'));
}

export type ChatUserFacingRuntimeError = {
  code: string;
  message: string;
  /** The signed-in ChatGPT plan reached its usage limit for Nimi. */
  chatGPTPlanUsageLimited?: true;
};

// App carriers deliver the Runtime reason code but not its action hint, so a
// ChatGPT plan failure is recognized from the hint when present, or from the
// reason code on the committed ChatGPT plan route.
function chatGPTPlanFailure(
  reasonCode: string | undefined,
  actionHint: string | undefined,
  context: ChatRuntimeErrorContext | undefined,
): 'usage-limited' | 'sign-in-ended' | 'model-unavailable' | null {
  if (actionHint === NIMI_CHATGPT_PLAN_MANAGE_USAGE_ACTION_HINT) return 'usage-limited';
  if (actionHint === NIMI_CHATGPT_PLAN_REAUTHORIZE_ACTION_HINT) return 'sign-in-ended';
  if (!context?.chatGPTPlanRoute) return null;
  const reason = String(reasonCode || '').trim().toUpperCase().replaceAll('-', '_');
  if (reason === 'AI_PROVIDER_RATE_LIMITED') return 'usage-limited';
  if (reason === 'AI_CONNECTOR_CREDENTIAL_MISSING') return 'sign-in-ended';
  if (reason === 'AI_MODEL_NOT_FOUND') return 'model-unavailable';
  return null;
}

export function toChatUserFacingRuntimeError(
  error: unknown,
  fallbackMessage: string,
  t: TFunction,
  context?: ChatRuntimeErrorContext,
): ChatUserFacingRuntimeError {
  const { reasonCode: reason, actionHint } = extractNimiErrorFields(error);
  const reportedReason = reason || extractNimiRuntimeReasonCodeFromError(error);
  const normalizedReason = reportedReason?.toUpperCase().replaceAll('-', '_');
  if ((context?.localAgent && normalizedReason && localAgentConfigurationFailure(normalizedReason)) || normalizedReason === 'AI_LOCAL_CONFIGURATION_NOT_CONFIGURED' || normalizedReason === 'AI_TEXT_BEHAVIOR_UNSUPPORTED') {
    return { code: reportedReason!, message: chatRuntimeReasonCodeMessage(normalizedReason, t, context)! };
  }
  if (reason === 'AGENT_BUSY' || reason === 'agent-busy') {
    return { code: reason, message: chatRuntimeReasonCodeMessage(reason, t)! };
  }
  const chatGPTPlan = chatGPTPlanFailure(reason, actionHint, context);
  if (chatGPTPlan === 'usage-limited') {
    return {
      code: reason || 'AI_PROVIDER_RATE_LIMITED',
      message: translateMessage(t, 'Chat.chatgptPlanUsageLimited', 'Your ChatGPT plan has reached its usage limit for Nimi. Manage usage in ChatGPT, or choose another model in AI Capabilities.'),
      chatGPTPlanUsageLimited: true,
    };
  }
  if (chatGPTPlan === 'model-unavailable') {
    return {
      code: reason || 'AI_MODEL_NOT_FOUND',
      message: translateMessage(t, 'Chat.chatgptPlanModelUnavailable', "This ChatGPT account doesn't offer the selected model. Choose another model in AI Capabilities, then send your message."),
    };
  }
  if (chatGPTPlan === 'sign-in-ended') {
    return {
      code: reason || 'AI_CONNECTOR_CREDENTIAL_MISSING',
      message: translateMessage(t, 'Chat.chatgptPlanSignInEnded', 'ChatGPT sign-in has ended. Sign in to ChatGPT again in Cloud Services, then send your message.'),
    };
  }
  return toNimiRuntimeUserFacingError(error, {
    fallbackMessage,
    resolveReasonCodeMessage: (reasonCode) => chatRuntimeReasonCodeMessage(reasonCode, t, context),
  });
}
