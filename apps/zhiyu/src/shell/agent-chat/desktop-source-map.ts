export type ZhiyuDesktopAgentChatMigrationStatus = 'migrated' | 'adapted' | 'deferred';

export interface ZhiyuDesktopAgentChatSourceMapEntry {
  readonly desktopSource: string;
  readonly zhiyuTarget: string;
  readonly status: ZhiyuDesktopAgentChatMigrationStatus;
  readonly note: string;
}

const surfaceTarget = 'apps/zhiyu/src/shell/agent-chat/ZhiyuAgentChatSurface.tsx';
const panelTarget = 'apps/zhiyu/src/shell/agent-chat/ZhiyuAgentPanel.tsx';
const stateTarget = 'apps/zhiyu/src/shell/agent-chat/agent-conversation-state.ts';
const routeTarget = 'apps/zhiyu/src/shell/agent-chat/agent-route-readiness.ts';
const turnTarget = 'apps/zhiyu/src/shell/agent-chat/runtime-agent-turn-adapter.ts';
const anchorBindingTarget = 'apps/zhiyu/src/shell/agent/conversation-anchor-binding-storage.ts';

export const ZHIYU_DESKTOP_AGENT_CHAT_SOURCE_MAP: readonly ZhiyuDesktopAgentChatSourceMapEntry[] = [
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-adapter.tsx',
    zhiyuTarget: surfaceTarget,
    status: 'adapted',
    note: 'Primary shell composition and selected target wiring over Zhiyu Runtime/SDK evidence.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-mode-content.tsx',
    zhiyuTarget: surfaceTarget,
    status: 'adapted',
    note: 'Agent mode host framing is adapted into the Zhiyu conversation-first shell.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-canonical-mode-frame.tsx',
    zhiyuTarget: surfaceTarget,
    status: 'adapted',
    note: 'Canonical rail/transcript/composer/panel frame is adapted through Kit chat primitives.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-presentation.tsx',
    zhiyuTarget: surfaceTarget,
    status: 'adapted',
    note: 'Presentation state, transcript, composer, stream footer, and side-panel slots.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-presentation-types.ts',
    zhiyuTarget: surfaceTarget,
    status: 'adapted',
    note: 'Presentation inputs are adapted to Zhiyu evidence and Runtime account surfaces.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-presentation-settings.tsx',
    zhiyuTarget: panelTarget,
    status: 'adapted',
    note: 'Agent Center tabs, model slot, avatar settings, cognition, and diagnostics panel composition.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-view-model.ts',
    zhiyuTarget: stateTarget,
    status: 'adapted',
    note: 'Selected target and current visible state are projected from Runtime-owned Zhiyu evidence.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-visible-state.ts',
    zhiyuTarget: stateTarget,
    status: 'adapted',
    note: 'Visible state, status cue, and runtime committed state are adapted without app-local truth.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-adapter-state.ts',
    zhiyuTarget: stateTarget,
    status: 'adapted',
    note: 'Adapter state is reduced to a presentation layer over Runtime session and evidence.',
  },
  {
    desktopSource: 'runtime.agent.state.SubscribeAgentEvents',
    zhiyuTarget: stateTarget,
    status: 'deferred',
    note: 'Reactive Runtime agent event subscription is surfaced as explicit deferred/stale projection until the SDK subscription is admitted for Zhiyu.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-diagnostics-view-model.ts',
    zhiyuTarget: panelTarget,
    status: 'adapted',
    note: 'Runtime diagnostics view model is adapted into Zhiyu diagnostics and advanced panel evidence.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-thread-model.ts',
    zhiyuTarget: stateTarget,
    status: 'adapted',
    note: 'Thread ordering and message projection are hydrated from Runtime snapshots and turn events.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-visible-projection-store.ts',
    zhiyuTarget: stateTarget,
    status: 'adapted',
    note: 'Visible projection store behavior is represented as non-durable Zhiyu presentation state.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-adapter-session-snapshot.ts',
    zhiyuTarget: stateTarget,
    status: 'adapted',
    note: 'Session snapshot binding is consumed through SDK snapshot hydration surfaces.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-session-hydration.ts',
    zhiyuTarget: stateTarget,
    status: 'adapted',
    note: 'Runtime snapshot hydration through public SDK transcript replay surfaces.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-shared-runtime-stream-ui.tsx',
    zhiyuTarget: surfaceTarget,
    status: 'adapted',
    note: 'Reasoning, text, failed, canceled, interrupted, and diagnostics rendering through Kit transcript/status slots.',
  },
  {
    desktopSource: 'kit/features/chat/src/components/canonical-transcript-view.tsx',
    zhiyuTarget: surfaceTarget,
    status: 'migrated',
    note: 'Zhiyu consumes Kit CanonicalTranscriptView directly.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-canonical-composer.tsx',
    zhiyuTarget: surfaceTarget,
    status: 'adapted',
    note: 'Composer behavior, disabled states, toolbar affordances, long text, and send interaction are hosted in the surface composer slot.',
  },
  {
    desktopSource: 'kit/features/chat/src/components/canonical-composer.tsx',
    zhiyuTarget: surfaceTarget,
    status: 'migrated',
    note: 'Zhiyu consumes Kit CanonicalComposer directly.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-submit-driver.ts',
    zhiyuTarget: turnTarget,
    status: 'adapted',
    note: 'Submit lifecycle and in-flight terminal state transitions.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-submit-session.ts',
    zhiyuTarget: stateTarget,
    status: 'adapted',
    note: 'Conversation session linkage and interrupted snapshot visibility.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/app-shell/providers/agent-conversation-anchor-binding-storage.ts',
    zhiyuTarget: anchorBindingTarget,
    status: 'adapted',
    note: 'Conversation anchor binding persistence is migrated into a Zhiyu-local shell binding store over public Runtime/SDK identity.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-host-actions-helpers.ts',
    zhiyuTarget: anchorBindingTarget,
    status: 'adapted',
    note: 'Desktop ensure/open/validate anchor binding behavior is adapted by Zhiyu conversation-home before Runtime turn submission.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-host-actions-submit.ts',
    zhiyuTarget: turnTarget,
    status: 'adapted',
    note: 'Host submit action sequence is adapted around Runtime binding, route refresh, and SDK turn streaming.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-host-actions-submit-helpers.ts',
    zhiyuTarget: turnTarget,
    status: 'adapted',
    note: 'Submit helper behavior is folded into the Zhiyu turn adapter and route readiness gate.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-host-actions-submit-run.ts',
    zhiyuTarget: turnTarget,
    status: 'adapted',
    note: 'Runtime stream event reduction and terminal outcome handling are adapted over public SDK event projection.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-submit-outcome.ts',
    zhiyuTarget: turnTarget,
    status: 'adapted',
    note: 'Completed, failed, canceled, and interrupted outcomes map to Zhiyu chat evidence.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/conversation-capability.ts',
    zhiyuTarget: routeTarget,
    status: 'adapted',
    note: 'Capability readiness resolves from Zhiyu AIConfig target refs without provider truth.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/conversation-capability-projection.ts',
    zhiyuTarget: routeTarget,
    status: 'adapted',
    note: 'Capability projection is adapted to the Zhiyu local partner route surface.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/conversation-submit-readiness.ts',
    zhiyuTarget: routeTarget,
    status: 'adapted',
    note: 'Submit-time route refresh, stale-route fail-closed behavior, and action hints.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-shared-settings-panel.tsx',
    zhiyuTarget: panelTarget,
    status: 'adapted',
    note: 'Model/settings content is embedded as a panel slot without duplicating provider/model truth.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-runtime-agent.ts',
    zhiyuTarget: turnTarget,
    status: 'adapted',
    note: 'Runtime Agent turn request and event parity over public SDK Runtime surfaces.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-runtime-provider.ts',
    zhiyuTarget: turnTarget,
    status: 'adapted',
    note: 'Provider wiring is consumed as Runtime/SDK semantics, not Desktop private import.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-adapter-attachments.ts',
    zhiyuTarget: surfaceTarget,
    status: 'deferred',
    note: 'Attachment UI fails closed until an admitted Runtime/SDK attachment pipeline exists.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-user-projection.ts',
    zhiyuTarget: stateTarget,
    status: 'adapted',
    note: 'User projection is limited to Runtime-owned local partner/account context.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-shared-thinking.ts',
    zhiyuTarget: surfaceTarget,
    status: 'deferred',
    note: 'Thinking preference is disabled/deferred unless the route exposes an admitted request surface.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-panel.tsx',
    zhiyuTarget: panelTarget,
    status: 'adapted',
    note: 'Agent Center overview, appearance, behavior, model, cognition, and advanced tabs.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-shared-side-sheet.tsx',
    zhiyuTarget: panelTarget,
    status: 'adapted',
    note: 'Agent Center eyebrow, localAgentRef handle, avatar, and world chip header metadata are mirrored in Zhiyu.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-panel-components.tsx',
    zhiyuTarget: panelTarget,
    status: 'adapted',
    note: 'Agent Center rows, pills, mode picker, state cards, and warning patterns.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-cognition-panel.tsx',
    zhiyuTarget: panelTarget,
    status: 'adapted',
    note: 'Cognition panel source details and memory status are read-only Runtime/SDK projections.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-avatar-settings-content.tsx',
    zhiyuTarget: panelTarget,
    status: 'adapted',
    note: 'Avatar resource/import/evidence/workbench structure is migrated with fail-closed actions.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-avatar-config-types.ts',
    zhiyuTarget: panelTarget,
    status: 'adapted',
    note: 'Avatar asset module, policy, backend, and workbench shape are represented as Zhiyu read-only/deferred config projection.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-local-config.ts',
    zhiyuTarget: panelTarget,
    status: 'deferred',
    note: 'Desktop local config state model is visible as deferred Zhiyu appearance configuration until Electron local config ownership is admitted.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-avatar-config-mutation.ts',
    zhiyuTarget: panelTarget,
    status: 'deferred',
    note: 'Avatar config mutation remains disabled; Zhiyu must not mutate local avatar resources without an admitted Electron config bridge.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-avatar-config-validation.ts',
    zhiyuTarget: panelTarget,
    status: 'adapted',
    note: 'Validation/evidence rows are projected in the appearance panel without claiming local asset validation success.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-live2d-calibration-workbench.tsx',
    zhiyuTarget: panelTarget,
    status: 'adapted',
    note: 'Live2D calibration workbench structure is migrated as a deferred evidence checklist.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-live2d-calibration-workbench-model.ts',
    zhiyuTarget: panelTarget,
    status: 'adapted',
    note: 'Preview, framing, render policy, expression inventory, and adapter manifest review items are represented explicitly.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-avatar-debug-workbench.tsx',
    zhiyuTarget: panelTarget,
    status: 'adapted',
    note: 'Avatar debug probe shortcuts are surfaced as disabled/deferred controls with concrete Electron bridge reason.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-center-avatar-debug-workbench-model.ts',
    zhiyuTarget: panelTarget,
    status: 'adapted',
    note: 'Backend/profile/routes/motion/emotion/speech/window probe taxonomy is preserved as read-only Zhiyu diagnostics.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-avatar-asset-diagnostics.ts',
    zhiyuTarget: panelTarget,
    status: 'adapted',
    note: 'Avatar asset diagnostics are mapped to resource, validation, capability, and adapter manifest evidence rows.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/bridge/runtime-bridge/chat-agent-center-local-config-store.ts',
    zhiyuTarget: panelTarget,
    status: 'deferred',
    note: 'Desktop Tauri local config store is not available in Zhiyu Electron; all dependent import/mutation actions fail closed.',
  },
  {
    desktopSource: 'apps/desktop/src-tauri/src/desktop_agent_center_store/resources_avatar_import.rs',
    zhiyuTarget: panelTarget,
    status: 'deferred',
    note: 'Avatar resource import backend is Desktop/Tauri-owned and must not be faked in Zhiyu Electron.',
  },
  {
    desktopSource: 'apps/desktop/src-tauri/src/desktop_agent_center_store/resources_background_import.rs',
    zhiyuTarget: panelTarget,
    status: 'deferred',
    note: 'Background image import backend is Desktop/Tauri-owned and remains an explicit deferred Zhiyu surface.',
  },
  {
    desktopSource: 'apps/desktop/src-tauri/src/desktop_agent_center_store/resources_live2d_adapter_import.rs',
    zhiyuTarget: panelTarget,
    status: 'deferred',
    note: 'Live2D adapter sidecar import backend is Desktop/Tauri-owned and remains disabled until a Zhiyu Electron bridge is admitted.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-local-avatar-launch-controls.ts',
    zhiyuTarget: panelTarget,
    status: 'deferred',
    note: 'Avatar launch stays disabled unless public handoff and Zhiyu avatar spec gate are admitted.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-local-avatar-controls.ts',
    zhiyuTarget: panelTarget,
    status: 'deferred',
    note: 'Avatar local asset ownership and background import handoff remain disabled/deferred in Zhiyu.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-background-settings-content.tsx',
    zhiyuTarget: panelTarget,
    status: 'adapted',
    note: 'Background configuration is visible but fail-closed until an admitted Avatar/Kit handoff exists.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-avatar-live2d-viewport.tsx',
    zhiyuTarget: panelTarget,
    status: 'deferred',
    note: 'Live2D render viewport and canvas pixel proof are deferred until public Avatar render handoff is admitted.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-avatar-vrm-viewport.tsx',
    zhiyuTarget: panelTarget,
    status: 'deferred',
    note: 'VRM render viewport and pixel proof are deferred until public Avatar render handoff is admitted.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-avatar-live2d-diagnostics.ts',
    zhiyuTarget: panelTarget,
    status: 'deferred',
    note: 'Live2D diagnostics remain visible as deferred workbench proof, not as ready render truth.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-avatar-vrm-diagnostics.ts',
    zhiyuTarget: panelTarget,
    status: 'deferred',
    note: 'VRM diagnostics remain deferred with disabled render semantics.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-voice-capture.ts',
    zhiyuTarget: surfaceTarget,
    status: 'deferred',
    note: 'Voice capture is disabled/deferred unless Runtime/SDK voice ingress is admitted for Zhiyu.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-adapter-voice.ts',
    zhiyuTarget: surfaceTarget,
    status: 'deferred',
    note: 'Voice adapter behavior is not presented as live without admitted Runtime/SDK voice surfaces.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-voice-transcribe-runtime.ts',
    zhiyuTarget: surfaceTarget,
    status: 'deferred',
    note: 'Voice transcription is deferred and must not insert draft text without Runtime evidence.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-manual-voice-playback-button.tsx',
    zhiyuTarget: surfaceTarget,
    status: 'deferred',
    note: 'Manual voice playback is disabled/deferred until public Runtime playback evidence exists.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-manual-voice-request.ts',
    zhiyuTarget: turnTarget,
    status: 'deferred',
    note: 'Manual playback requests are not dispatched from Zhiyu without an admitted Runtime voice request surface.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-diagnostics.tsx',
    zhiyuTarget: panelTarget,
    status: 'adapted',
    note: 'Diagnostics are panel-accessible evidence, not primary transcript/composer copy.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-diagnostics-content.tsx',
    zhiyuTarget: panelTarget,
    status: 'adapted',
    note: 'Diagnostics content is adapted into Zhiyu advanced panel and diagnostic drawer evidence.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts',
    zhiyuTarget: 'apps/zhiyu/src/shell/runtime/runtime-status.ts',
    status: 'adapted',
    note: 'Runtime unavailable/degraded shell semantics are projected as fail-closed Zhiyu runtime status.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/app-shell/layouts/main-layout-topbar.tsx',
    zhiyuTarget: panelTarget,
    status: 'adapted',
    note: 'Authenticated shell notification and account triggers are migrated into Zhiyu chat chrome with fail-closed local popovers.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/app-shell/layouts/main-layout-settings-menu.tsx',
    zhiyuTarget: panelTarget,
    status: 'adapted',
    note: 'Desktop account-menu affordance is adapted to Zhiyu account/settings popover without owning Desktop global settings.',
  },
  {
    desktopSource: 'apps/desktop/src/shell/renderer/features/chat/chat-page.tsx',
    zhiyuTarget: surfaceTarget,
    status: 'adapted',
    note: 'Responsive chat page layout is adapted into the Zhiyu Electron shell with desktop and narrow captures.',
  },
] as const;
