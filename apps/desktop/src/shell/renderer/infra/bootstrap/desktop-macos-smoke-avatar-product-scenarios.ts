import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { type DesktopMacosSmokeDriverDeps, type JsonObject, SMOKE_STEP_TIMEOUT_MS } from './desktop-macos-smoke-shared';
import type { NimiRuntimeAgentSmokeProductPathEvidence } from '@nimiplatform/sdk/runtime';
import {
  waitForAvatarCarrierEvidence,
  waitForAvatarLocalAssetDegradedEvidence,
  waitForAvatarLive2dInteractionEvidence,
} from './desktop-macos-smoke-avatar-evidence';

const E2E_PRIMARY_REALM_AGENT_ID = 'agent-e2e-alpha';
const E2E_PRIMARY_OWNER_USER_ID = 'user-e2e-primary';
const E2E_PRIMARY_LOCAL_AGENT_REF = 'local-agent:desktop-e2e-alpha';
const E2E_PRIMARY_AGENT_TARGET_ID = E2E_IDS.chatTarget(E2E_PRIMARY_LOCAL_AGENT_REF);
const AVATAR_PRODUCT_LIVE_INSTANCE_TIMEOUT_MS = 45_000;

type SmokeStepRecorder = (step: string) => void;

async function waitForAvatarLiveInstance(
  deps: DesktopMacosSmokeDriverDeps,
  runtimeSourceRef: string,
  localAgentRef: string,
  _expectedConversationAnchorId: string | null = null,
  timeoutMs = SMOKE_STEP_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  let lastCount = 0;
  while (Date.now() < deadline) {
    const instances = await deps.listAvatarLiveInstances(localAgentRef);
    lastCount = instances.length;
    const current = instances.find((instance) => (
      instance.runtimeSourceRef === runtimeSourceRef
      && instance.localAgentRef === localAgentRef
    ));
    if (current) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `missing same-anchor Avatar live instance for ${runtimeSourceRef}`
    + `; observed ${lastCount} instance(s)`,
  );
}

async function waitForAgentConversationAnchorBinding(
  deps: DesktopMacosSmokeDriverDeps,
  input: {
    runtimeSourceRef: string;
    localAgentRef: string;
  },
  notBeforeMs = 0,
  timeoutMs = 20_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastBinding: Awaited<ReturnType<DesktopMacosSmokeDriverDeps['readAgentConversationAnchorBinding']>> = null;
  while (Date.now() < deadline) {
    const binding = await deps.readAgentConversationAnchorBinding(input.localAgentRef);
    lastBinding = binding;
    const anchor = binding?.conversationAnchorId?.trim() || '';
    if (
      binding
      && binding.localAgentRef === input.localAgentRef
      && binding.runtimeSourceRef === input.runtimeSourceRef
      && anchor
      && binding.updatedAtMs >= notBeforeMs
    ) {
      await deps.verifyRuntimeConversationAnchor({
        localAgentRef: input.localAgentRef,
        ownerUserId: E2E_PRIMARY_OWNER_USER_ID,
        runtimeSourceRef: input.runtimeSourceRef,
        conversationAnchorId: anchor,
      });
      return anchor;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `missing explicit conversation anchor binding for ${input.localAgentRef}`
    + `; binding=${lastBinding ? JSON.stringify(lastBinding) : 'empty'}`,
  );
}

async function waitForRuntimeProductPathEvidence(
  deps: DesktopMacosSmokeDriverDeps,
  input: {
    localAgentRef: string;
    ownerUserId: string;
    runtimeSourceRef: string;
    conversationAnchorId: string;
  },
  timeoutMs = 25_000,
): Promise<NimiRuntimeAgentSmokeProductPathEvidence> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const evidence = await deps.readRuntimeProductPathEvidence(input);
      if (evidence.same_anchor !== true) {
        throw new Error('Runtime product evidence did not confirm same anchor');
      }
      if (evidence.runtime_authenticated !== true) {
        throw new Error('Runtime product evidence did not confirm authenticated Runtime access');
      }
      if (evidence.has_runtime_turn !== true) {
        throw new Error('Runtime product evidence has no Runtime turn identity yet');
      }
      return evidence;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error || 'unknown Runtime product evidence error');
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`missing Runtime-authenticated same-anchor turn evidence: ${lastError}`);
}

export async function runChatLive2dAvatarProductSmokeScenario(
  scenarioId: 'chat.live2d-avatar-product-smoke' | 'chat.live2d-avatar-local-asset-missing-smoke',
  deps: DesktopMacosSmokeDriverDeps,
  record: SmokeStepRecorder,
  steps: string[],
): Promise<void> {
  record('verify-runtime-account-projection');
  await deps.verifyRuntimeAccountProjection();
  record('wait-chat-panel');
  await deps.waitForTestId(E2E_IDS.panel('chat'));
  record('clear-stale-anchor-bindings');
  await deps.clearAgentConversationAnchorBindings();
  record('select-agent-target');
  await deps.clickByTestId(E2E_PRIMARY_AGENT_TARGET_ID);
  record('wait-agent-target-selected');
  await new Promise((resolve) => setTimeout(resolve, 750));
  record('configure-runtime-text-route');
  await deps.configureRuntimeTextRoute();

  const anchorWriteNotBeforeMs = Date.now();
  const anchorMessage = scenarioId === 'chat.live2d-avatar-product-smoke'
    ? 'Wave 2 product smoke anchor turn.'
    : 'Wave 2 local asset missing degraded turn.';
  record('submit-anchor-turn');
  await deps.setValueBySelector('[data-chat-composer-textarea="true"]', anchorMessage);
  record('wait-anchor-send-ready');
  await deps.waitForSelectorEnabled('[data-chat-composer-send="true"]');
  await deps.clickSelector('[data-chat-composer-send="true"]');
  record('wait-runtime-anchor-binding');
  const conversationAnchorId = await waitForAgentConversationAnchorBinding(
    deps,
    {
      runtimeSourceRef: E2E_PRIMARY_REALM_AGENT_ID,
      localAgentRef: E2E_PRIMARY_LOCAL_AGENT_REF,
    },
    anchorWriteNotBeforeMs,
  );
  record('wait-runtime-product-path-evidence');
  const runtimeProductEvidence = await waitForRuntimeProductPathEvidence(deps, {
    localAgentRef: E2E_PRIMARY_LOCAL_AGENT_REF,
    ownerUserId: E2E_PRIMARY_OWNER_USER_ID,
    runtimeSourceRef: E2E_PRIMARY_REALM_AGENT_ID,
    conversationAnchorId,
  });
  record('wait-avatar-composer-ready');
  await deps.waitForSelector('[data-agent-composer-avatar="ready_stopped"]');

  if (scenarioId === 'chat.live2d-avatar-local-asset-missing-smoke') {
    record('apply-avatar-local-asset-fault');
    const localAssetFault = await deps.applyAvatarProductLocalAssetFault('missing_entry_file');
    record('launch-avatar-current-anchor');
    await deps.clickSelector('[data-agent-composer-avatar="ready_stopped"]');
    record('wait-avatar-same-anchor-registry');
    const liveInstance = await waitForAvatarLiveInstance(
      deps,
      E2E_PRIMARY_REALM_AGENT_ID,
      E2E_PRIMARY_LOCAL_AGENT_REF,
      conversationAnchorId,
      AVATAR_PRODUCT_LIVE_INSTANCE_TIMEOUT_MS,
    );
    record('wait-avatar-local-asset-degraded-evidence');
    const degradedEvidence = await waitForAvatarLocalAssetDegradedEvidence(
      deps,
      liveInstance.avatarInstanceId,
      conversationAnchorId,
    );
    record('write-pass-report');
    await deps.writeReport({
      ok: true,
      steps,
      route: deps.currentRoute(),
      htmlSnapshot: deps.currentHtml(),
      details: {
        avatarProductDegradedPath: {
          conversationAnchorId,
          runtime: runtimeProductEvidence,
          liveInstance,
          localAssetFault,
          evidencePath: degradedEvidence.evidencePath,
          bindFailure: degradedEvidence.bindFailure,
          degradedTransition: degradedEvidence.degradedTransition,
          degradedSurface: degradedEvidence.degradedSurface,
        },
      } as unknown as JsonObject,
    });
    return;
  }

  record('launch-avatar-current-anchor');
  await deps.clickSelector('[data-agent-composer-avatar="ready_stopped"]');
  record('wait-avatar-same-anchor-registry');
  const liveInstance = await waitForAvatarLiveInstance(
    deps,
    E2E_PRIMARY_REALM_AGENT_ID,
    E2E_PRIMARY_LOCAL_AGENT_REF,
    conversationAnchorId,
    AVATAR_PRODUCT_LIVE_INSTANCE_TIMEOUT_MS,
  );
  record('wait-avatar-carrier-evidence');
  const carrierEvidence = await waitForAvatarCarrierEvidence(
    deps,
    liveInstance.avatarInstanceId,
    conversationAnchorId,
    Number.isFinite(deps.avatarCarrierEvidenceTimeoutMs)
      ? Math.max(1, Number(deps.avatarCarrierEvidenceTimeoutMs))
      : undefined,
  );
  record('wait-avatar-interaction-composer-ready');
  await deps.waitForSelectorEnabled('[data-chat-composer-textarea="true"]', 60_000);
  record('submit-avatar-interaction-turn');
  await deps.setValueBySelector('[data-chat-composer-textarea="true"]', 'Wave 2 product smoke interaction turn.');
  record('wait-avatar-interaction-send-ready');
  await deps.waitForSelectorEnabled('[data-chat-composer-send="true"]');
  await deps.clickSelector('[data-chat-composer-send="true"]');
  record('wait-avatar-live2d-interaction-evidence');
  const interactionEvidence = await waitForAvatarLive2dInteractionEvidence(
    deps,
    liveInstance.avatarInstanceId,
    conversationAnchorId,
  );
  record('write-pass-report');
  await deps.writeReport({
    ok: true,
    steps,
    route: deps.currentRoute(),
    htmlSnapshot: deps.currentHtml(),
      details: {
        avatarProductPath: {
        conversationAnchorId,
        runtime: runtimeProductEvidence,
        liveInstance,
        evidencePath: carrierEvidence.evidencePath,
        startup: carrierEvidence.startup,
        consumeReady: carrierEvidence.consumeReady,
        localAssetResolved: carrierEvidence.localAssetResolved,
        modelLoad: carrierEvidence.modelLoad,
        lifecycleMounted: carrierEvidence.lifecycleMounted,
        visual: carrierEvidence.visual,
        interaction: interactionEvidence.interaction,
        },
      } as unknown as JsonObject,
  });
}
