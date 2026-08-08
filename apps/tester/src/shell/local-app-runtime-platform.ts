import { createNimiClient } from '@nimiplatform/sdk';
import type { NimiLocalAppTextCandidateInput } from '@nimiplatform/sdk/app';
import { createNimiLocalAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';

/**
 * The sole Tester entry point into the 0K local-app carrier. The SDK owns all
 * projection validation; the App never receives a registration handle,
 * Registered App Subject, session proof, or transport authority material.
 */
export function getTesterLocalAppClient() {
  const standardShell = createNimiLocalAppStandardShellSurface();
  const alignedShell = {
    ...standardShell,
    ai: {
      ...standardShell.ai,
      text: {
        generateCandidate: (input: NimiLocalAppTextCandidateInput) => (
          standardShell.ai.text.generateCandidate(requireKitTextBridgeInput(input))
        ),
        streamTurn: (input: NimiLocalAppTextCandidateInput) => (
          standardShell.ai.text.streamTurn(requireKitTextBridgeInput(input))
        ),
      },
    },
  };
  return createNimiClient({
    localApp: {
      // The installed Kit bridge declarations still predate Y1/Y2 optional
      // carrier fields across Scenario media specs. Runtime validation remains
      // SDK-owned; the explicit text adapter above fails closed for that known
      // unsupported bridge rather than inventing defaults or dropping fields.
      standardShell: alignedShell as never,
    },
  });
}

function requireKitTextBridgeInput(input: NimiLocalAppTextCandidateInput) {
  const unsupported = input.topK !== undefined
    || input.presencePenalty !== undefined
    || input.frequencyPenalty !== undefined
    || input.stop !== undefined
    || input.seed !== undefined;
  if (unsupported || input.temperature === undefined || input.topP === undefined || input.maxTokens === undefined) {
    throw Object.assign(new Error(
      'The installed Kit Local App text bridge has not adopted the presence-aware Y2 sampling carrier.',
    ), {
      reasonCode: 'TESTER_KIT_TEXT_PARAMETER_SURFACE_STALE',
      actionHint: 'update_kit_local_app_text_bridge',
    });
  }
  return {
    messages: input.messages,
    temperature: input.temperature,
    topP: input.topP,
    maxTokens: input.maxTokens,
  };
}
