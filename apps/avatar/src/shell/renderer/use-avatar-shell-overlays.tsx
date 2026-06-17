import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { AvatarDebugProbeKind } from '@nimiplatform/sdk/runtime/generated';
import type { BootstrapHandle } from './app-shell/app-bootstrap.js';
import type { AvatarAppState } from './app-shell/app-store.js';
import type { CompositionState } from './app-shell/composition-state.js';
import type { AvatarLaunchContext } from './bridge/launch-context.js';
import type {
  CompanionActiveTurnCue,
  CompanionAnchorBinding,
} from './companion-state.js';
import { recordAvatarEvidenceEventually } from './app-shell/avatar-evidence.js';
import { closeAvatarWindow, hideAvatarWindow } from './app-shell/tauri-commands.js';
import { isTauriRuntime } from './app-shell/tauri-lifecycle.js';
import { AVATAR_SCALE_DEFAULT } from './avatar-scale-state.js';
import { normalizeText, toErrorMessage } from './avatar-shell-utils.js';
import {
  AvatarActionRadial,
  type AvatarActionRadialAction,
  type AvatarActionRadialDismissReason,
} from './action-radial/avatar-action-radial.js';
import {
  AvatarAppearanceOverlay,
  type AvatarAppearanceOverlayDismissReason,
} from './appearance-overlay/avatar-appearance-overlay.js';
import {
  AvatarContextMenu,
  type AvatarContextMenuAction,
  type AvatarContextMenuDismissReason,
} from './context-menu/avatar-context-menu.js';
import {
  AvatarDebugOverlay,
  type AvatarDebugOverlayDismissReason,
} from './debug-overlay/avatar-debug-overlay.js';
import {
  AvatarSettingsOverlay,
  type AvatarSettingsOverlayDismissReason,
} from './settings-overlay/avatar-settings-overlay.js';
import {
  AvatarTransientComposer,
  type AvatarTransientComposerDismissReason,
} from './transient-composer/avatar-transient-composer.js';
import {
  writeAvatarShellSettings,
  type AvatarShellSettings,
} from './settings-state.js';
import type { AppOriginEvent } from './driver/types.js';
import { assertAcceptedCompanionParticipationProjection } from './companion-participation-projection.js';
import {
  appearanceSourceAuthority,
  applyLocalPresentation,
  type AvatarActionRadialState,
  type AvatarAppearanceOverlayState,
  type AvatarContextMenuState,
  type AvatarDebugOverlayState,
  type AvatarSettingsOverlayState,
  type AvatarTransientComposerState,
  avatarDebugProbeKindId,
  localClickActivity,
  radialActionActivity,
} from './avatar-shell-overlay-model.js';

export function useAvatarShellOverlays(input: {
  bootstrapHandle: BootstrapHandle | null;
  companionBinding: CompanionAnchorBinding | null;
  activeTurnCue: CompanionActiveTurnCue | null;
  consume: AvatarAppState['consume'];
  launchContext: AvatarLaunchContext | null;
  shellSettings: AvatarShellSettings;
  setShellSettings: Dispatch<SetStateAction<AvatarShellSettings>>;
  avatarScale: number;
  updateAvatarScale(nextScaleInput: number, source: 'wheel' | 'reset'): void;
  compositionState: CompositionState;
}) {
  const {
    bootstrapHandle,
    companionBinding,
    activeTurnCue,
    consume,
    launchContext,
    shellSettings,
    setShellSettings,
    avatarScale,
    updateAvatarScale,
    compositionState,
  } = input;
  const [contextMenu, setContextMenu] = useState<AvatarContextMenuState | null>(null);
  const [actionRadial, setActionRadial] = useState<AvatarActionRadialState | null>(null);
  const [transientComposer, setTransientComposer] = useState<AvatarTransientComposerState | null>(null);
  const [settingsOverlay, setSettingsOverlay] = useState<AvatarSettingsOverlayState | null>(null);
  const [appearanceOverlay, setAppearanceOverlay] = useState<AvatarAppearanceOverlayState | null>(null);
  const [debugOverlay, setDebugOverlay] = useState<AvatarDebugOverlayState | null>(null);

  const contextIdentity = useCallback(() => {
    return {
      avatar_instance_id: normalizeText(consume.avatarInstanceId)
        ?? normalizeText(launchContext?.avatarInstanceId)
        ?? 'unknown-avatar-instance',
      agent_id: normalizeText(consume.agentId)
        ?? normalizeText(launchContext?.agentId)
        ?? 'unknown-agent',
    };
  }, [
    consume.agentId,
    consume.avatarInstanceId,
    launchContext?.agentId,
    launchContext?.avatarInstanceId,
  ]);

  const composerIdentity = useCallback(() => {
    return {
      ...contextIdentity(),
      conversation_anchor_id: companionBinding?.conversationAnchorId ?? 'unknown-conversation-anchor',
    };
  }, [companionBinding?.conversationAnchorId, contextIdentity]);

  const dismissContextMenu = useCallback(
    (reason: AvatarContextMenuDismissReason): void => {
      setContextMenu((current) => {
        if (!current) return null;
        recordAvatarEvidenceEventually({
          kind: 'avatar.shell.context_menu.dismissed',
          detail: {
            ...contextIdentity(),
            reason,
            dismissed_at: new Date().toISOString(),
          },
        });
        return null;
      });
    },
    [contextIdentity],
  );

  const openContextMenu = useCallback(
    (event: AppOriginEvent): void => {
      const x = Number(event.detail['client_x']);
      const y = Number(event.detail['client_y']);
      const next = {
        x: Number.isFinite(x) ? x : 24,
        y: Number.isFinite(y) ? y : 24,
      };
      setContextMenu(next);
      recordAvatarEvidenceEventually({
        kind: 'avatar.shell.context_menu.opened',
        detail: {
          ...contextIdentity(),
          client_x: Math.round(next.x),
          client_y: Math.round(next.y),
          source_event: event.name,
          opened_at: new Date().toISOString(),
        },
      });
    },
    [contextIdentity],
  );

  const dismissActionRadial = useCallback(
    (reason: AvatarActionRadialDismissReason): void => {
      setActionRadial((current) => {
        if (!current) return null;
        recordAvatarEvidenceEventually({
          kind: 'avatar.shell.action_radial.dismissed',
          detail: {
            ...contextIdentity(),
            reason,
            dismissed_at: new Date().toISOString(),
          },
        });
        return null;
      });
    },
    [contextIdentity],
  );

  const openActionRadial = useCallback(
    (event: AppOriginEvent): void => {
      const x = Number(event.detail['client_x']);
      const y = Number(event.detail['client_y']);
      const next = {
        x: Number.isFinite(x) ? x : 24,
        y: Number.isFinite(y) ? y : 24,
      };
      setContextMenu(null);
      setActionRadial(next);
      recordAvatarEvidenceEventually({
        kind: 'avatar.shell.action_radial.opened',
        detail: {
          ...contextIdentity(),
          client_x: Math.round(next.x),
          client_y: Math.round(next.y),
          source_event: event.name,
          opened_at: new Date().toISOString(),
        },
      });
    },
    [contextIdentity],
  );

  const openTransientComposer = useCallback(
    (nextInput: { x: number; y: number; source: 'context_menu' | 'action_radial' }): void => {
      const x = Number.isFinite(nextInput.x) ? nextInput.x : 24;
      const y = Number.isFinite(nextInput.y) ? nextInput.y : 24;
      setTransientComposer((current) => ({
        x,
        y,
        draft: current?.draft ?? '',
        sendState: current?.sendState === 'sending' ? 'sending' : 'idle',
        sendError: null,
      }));
      recordAvatarEvidenceEventually({
        kind: 'avatar.shell.composer.opened',
        detail: {
          ...composerIdentity(),
          source: nextInput.source,
          client_x: Math.round(x),
          client_y: Math.round(y),
          opened_at: new Date().toISOString(),
        },
      });
    },
    [composerIdentity],
  );

  const dismissTransientComposer = useCallback(
    (reason: AvatarTransientComposerDismissReason): void => {
      setTransientComposer((current) => {
        if (!current) return null;
        recordAvatarEvidenceEventually({
          kind: 'avatar.shell.composer.dismissed',
          detail: {
            ...composerIdentity(),
            reason,
            dismissed_at: new Date().toISOString(),
          },
        });
        return null;
      });
    },
    [composerIdentity],
  );

  const dismissSettingsOverlay = useCallback(
    (_reason: AvatarSettingsOverlayDismissReason): void => {
      setSettingsOverlay((current) => {
        if (!current) return null;
        return null;
      });
    },
    [],
  );

  const dismissAppearanceOverlay = useCallback(
    (_reason: AvatarAppearanceOverlayDismissReason): void => {
      setAppearanceOverlay((current) => {
        if (!current) return null;
        return null;
      });
    },
    [],
  );

  const openAppearanceOverlay = useCallback(
    (nextInput: { x: number; y: number }): void => {
      const modelManifest = bootstrapHandle?.carrier?.model ?? null;
      if (!modelManifest) return;
      const x = Number.isFinite(nextInput.x) ? nextInput.x : 24;
      const y = Number.isFinite(nextInput.y) ? nextInput.y : 24;
      setAppearanceOverlay({ x, y });
      recordAvatarEvidenceEventually({
        kind: 'avatar.shell.appearance.opened',
        detail: {
          ...composerIdentity(),
          model_id: modelManifest.modelId,
          backend_kind: modelManifest.kind,
          source_authority: appearanceSourceAuthority(consume.authority),
          scale: avatarScale,
          opened_at: new Date().toISOString(),
        },
      });
    },
    [avatarScale, bootstrapHandle?.carrier?.model, composerIdentity, consume.authority],
  );

  const dismissDebugOverlay = useCallback(
    (_reason: AvatarDebugOverlayDismissReason): void => {
      setDebugOverlay((current) => {
        if (!current) return null;
        return null;
      });
    },
    [],
  );

  const openDebugOverlay = useCallback(
    (nextInput: { x: number; y: number }): void => {
      if (!bootstrapHandle?.avatarDebug || !companionBinding) return;
      const x = Number.isFinite(nextInput.x) ? nextInput.x : 24;
      const y = Number.isFinite(nextInput.y) ? nextInput.y : 24;
      setDebugOverlay({ x, y });
      recordAvatarEvidenceEventually({
        kind: 'avatar.shell.debug.opened',
        detail: {
          ...composerIdentity(),
          client_x: Math.round(x),
          client_y: Math.round(y),
          opened_at: new Date().toISOString(),
        },
      });
    },
    [bootstrapHandle?.avatarDebug, companionBinding, composerIdentity],
  );

  const recordDebugRequestFailed = useCallback(
    (failure: { probeKind: AvatarDebugProbeKind; reasonCode: string; error: string }): void => {
      recordAvatarEvidenceEventually({
        kind: 'avatar.shell.debug.request-failed',
        detail: {
          ...composerIdentity(),
          probe_kind: avatarDebugProbeKindId(failure.probeKind),
          reason_code: failure.reasonCode,
          error: failure.error,
          failed_at: new Date().toISOString(),
        },
      });
    },
    [composerIdentity],
  );

  const requestInterruptActiveTurn = useCallback(
    (source: 'context_menu'): void => {
      if (!bootstrapHandle || !companionBinding || !activeTurnCue) return;
      const requestedAt = new Date().toISOString();
      const detail = {
        ...composerIdentity(),
        active_turn_id: activeTurnCue.turnId,
        active_turn_phase: activeTurnCue.phase,
        source,
        reason: 'user_cancel',
        requested_at: requestedAt,
      };
      recordAvatarEvidenceEventually({
        kind: 'avatar.shell.interrupt.requested',
        detail,
      });
      void bootstrapHandle.interruptActiveTurn({
        agentId: companionBinding.agentId,
        conversationAnchorId: companionBinding.conversationAnchorId,
        turnId: activeTurnCue.turnId,
        reason: 'user_cancel',
      }).catch((error: unknown) => {
        recordAvatarEvidenceEventually({
          kind: 'avatar.shell.interrupt.failed',
          detail: {
            ...composerIdentity(),
            active_turn_id: activeTurnCue.turnId,
            reason_code: 'runtime_turn_interrupt_rejected',
            error: toErrorMessage(error),
            failed_at: new Date().toISOString(),
          },
        });
      });
    },
    [activeTurnCue, bootstrapHandle, companionBinding, composerIdentity],
  );

  const submitTransientComposer = useCallback(
    (): void => {
      if (!bootstrapHandle || !companionBinding) return;
      const text = normalizeText(transientComposer?.draft);
      if (!text || transientComposer?.sendState === 'sending') return;
      const submittedAt = new Date().toISOString();
      setTransientComposer((current) =>
        current
          ? {
            ...current,
            draft: '',
            sendState: 'sending',
            sendError: null,
          }
          : current,
      );
      recordAvatarEvidenceEventually({
        kind: 'avatar.shell.composer.submitted',
        detail: {
          ...composerIdentity(),
          text_length: text.length,
          submitted_at: submittedAt,
        },
      });
      void bootstrapHandle
        .requestCompanionParticipation({
          agentId: companionBinding.agentId,
          conversationAnchorId: companionBinding.conversationAnchorId,
          text,
        })
        .then((projection) => {
          assertAcceptedCompanionParticipationProjection(projection);
          setTransientComposer((current) =>
            current
              ? {
                ...current,
                sendState: 'idle',
                sendError: null,
              }
              : current,
          );
        })
        .catch((error: unknown) => {
          const message = toErrorMessage(error);
          setTransientComposer((current) =>
            current
              ? {
                ...current,
                draft: text,
                sendState: 'error',
                sendError: message,
              }
              : current,
          );
          recordAvatarEvidenceEventually({
            kind: 'avatar.shell.composer.send-failed',
            detail: {
              ...composerIdentity(),
              reason_code: 'runtime_companion_participation_rejected',
              error: message,
              failed_at: new Date().toISOString(),
            },
          });
        });
    },
    [bootstrapHandle, companionBinding, composerIdentity, transientComposer?.draft, transientComposer?.sendState],
  );

  const persistShellSettings = useCallback(
    (next: AvatarShellSettings, changedKey?: 'always_on_top' | 'show_voice_captions'): void => {
      setShellSettings(next);
      writeAvatarShellSettings(next);
      if (changedKey) {
        const value = changedKey === 'always_on_top'
          ? next.alwaysOnTop
          : next.showVoiceCaptions;
        recordAvatarEvidenceEventually({
          kind: 'avatar.shell.settings.changed',
          detail: {
            key: changedKey,
            value,
            changed_at: new Date().toISOString(),
          },
        });
      }
    },
    [setShellSettings],
  );

  const requestForegroundPriority = useCallback(
    (source: 'double_click' | 'context_menu'): void => {
      const detail = {
        ...contextIdentity(),
        source,
        requested_at: new Date().toISOString(),
      };
      const event: AppOriginEvent = {
        name: 'avatar.shell.foreground_priority.requested',
        detail,
      };
      bootstrapHandle?.driver?.emit(event);
      recordAvatarEvidenceEventually({
        kind: 'avatar.shell.foreground_priority.requested',
        detail,
      });
      applyLocalPresentation(bootstrapHandle, {
        resolvedActivityName: 'focused',
        intensity: 0.45,
      });
    },
    [bootstrapHandle, bootstrapHandle?.driver, contextIdentity],
  );

  const requestShellLifecycle = useCallback(
    (action: 'hide' | 'close'): void => {
      const detail = {
        ...contextIdentity(),
        source: 'context_menu',
        requested_at: new Date().toISOString(),
      };
      recordAvatarEvidenceEventually({
        kind: action === 'hide'
          ? 'avatar.shell.hide-requested'
          : 'avatar.shell.close-requested',
        detail,
      });
      const command = action === 'hide' ? hideAvatarWindow : closeAvatarWindow;
      void command().catch((error: unknown) => {
        console.warn(`[avatar:shell] ${action} window request failed: ${toErrorMessage(error)}`);
      });
    },
    [contextIdentity],
  );

  const handleContextMenuAction = useCallback(
    (action: AvatarContextMenuAction): void => {
      if (action === 'open_text_input') {
        openTransientComposer({
          x: contextMenu?.x ?? 24,
          y: contextMenu?.y ?? 24,
          source: 'context_menu',
        });
        dismissContextMenu('action');
        return;
      }
      if (action === 'wake_foreground') {
        requestForegroundPriority('context_menu');
        dismissContextMenu('action');
        return;
      }
      if (action === 'interrupt') {
        requestInterruptActiveTurn('context_menu');
        dismissContextMenu('action');
        return;
      }
      if (action === 'appearance') {
        openAppearanceOverlay({
          x: contextMenu?.x ?? 24,
          y: contextMenu?.y ?? 24,
        });
        dismissContextMenu('action');
        return;
      }
      if (action === 'reset_scale') {
        updateAvatarScale(AVATAR_SCALE_DEFAULT, 'reset');
        dismissContextMenu('action');
        return;
      }
      if (action === 'toggle_always_on_top') {
        persistShellSettings(
          { ...shellSettings, alwaysOnTop: !shellSettings.alwaysOnTop },
          'always_on_top',
        );
      }
      if (action === 'settings') {
        setSettingsOverlay({
          x: contextMenu?.x ?? 24,
          y: contextMenu?.y ?? 24,
        });
      }
      if (action === 'debug') {
        openDebugOverlay({
          x: contextMenu?.x ?? 24,
          y: contextMenu?.y ?? 24,
        });
      }
      if (action === 'hide') {
        requestShellLifecycle('hide');
      }
      if (action === 'close') {
        requestShellLifecycle('close');
      }
      dismissContextMenu('action');
    },
    [
      contextMenu?.x,
      contextMenu?.y,
      dismissContextMenu,
      openAppearanceOverlay,
      openDebugOverlay,
      openTransientComposer,
      persistShellSettings,
      requestForegroundPriority,
      requestInterruptActiveTurn,
      requestShellLifecycle,
      shellSettings,
      updateAvatarScale,
    ],
  );

  const handleActionRadialAction = useCallback(
    (action: AvatarActionRadialAction): void => {
      const presentation = radialActionActivity(action);
      recordAvatarEvidenceEventually({
        kind: 'avatar.shell.action_radial.selected',
        detail: {
          ...contextIdentity(),
          action,
          resolved_activity_name: presentation?.resolvedActivityName ?? null,
          selected_at: new Date().toISOString(),
        },
      });
      if (action === 'open_text_input') {
        openTransientComposer({
          x: actionRadial?.x ?? 24,
          y: actionRadial?.y ?? 24,
          source: 'action_radial',
        });
        dismissActionRadial('action');
        return;
      }
      applyLocalPresentation(bootstrapHandle, presentation);
      dismissActionRadial('action');
    },
    [
      actionRadial?.x,
      actionRadial?.y,
      bootstrapHandle,
      contextIdentity,
      dismissActionRadial,
      openTransientComposer,
    ],
  );

  const handleAvatarOriginEvent = useCallback(
    (event: AppOriginEvent): void => {
      bootstrapHandle?.driver?.emit(event);
      if (event.name === 'avatar.user.click') {
        applyLocalPresentation(bootstrapHandle, localClickActivity(event));
      }
      if (event.name === 'avatar.user.double_click') {
        requestForegroundPriority('double_click');
      }
      if (event.name === 'avatar.user.long_press') {
        openActionRadial(event);
      }
      if (event.name === 'avatar.user.right_click') {
        openContextMenu(event);
      }
    },
    [
      bootstrapHandle,
      bootstrapHandle?.driver,
      openActionRadial,
      openContextMenu,
      requestForegroundPriority,
    ],
  );

  const dismissTransientSurfaces = useCallback(
    (reason: 'composition_change'): void => {
      dismissContextMenu(reason);
      dismissActionRadial(reason);
      dismissTransientComposer(reason);
      dismissSettingsOverlay(reason);
      dismissAppearanceOverlay(reason);
      dismissDebugOverlay(reason);
    },
    [
      dismissActionRadial,
      dismissAppearanceOverlay,
      dismissContextMenu,
      dismissDebugOverlay,
      dismissSettingsOverlay,
      dismissTransientComposer,
    ],
  );

  const overlayNodes = useMemo(
    () => (
      <>
        {contextMenu ? (
          <AvatarContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            compositionState={compositionState}
            alwaysOnTop={shellSettings.alwaysOnTop}
            textInputEnabled={Boolean(bootstrapHandle && companionBinding)}
            foregroundPriorityEnabled={Boolean(bootstrapHandle && companionBinding)}
            interruptEnabled={Boolean(bootstrapHandle && companionBinding && activeTurnCue)}
            appearanceEnabled={Boolean(bootstrapHandle?.carrier?.model)}
            resetScaleEnabled={avatarScale !== AVATAR_SCALE_DEFAULT}
            settingsEnabled={true}
            debugEnabled={Boolean(bootstrapHandle?.avatarDebug && companionBinding)}
            shellLifecycleEnabled={isTauriRuntime()}
            onAction={handleContextMenuAction}
            onDismiss={dismissContextMenu}
          />
        ) : null}
        {settingsOverlay ? (
          <AvatarSettingsOverlay
            x={settingsOverlay.x}
            y={settingsOverlay.y}
            compositionState={compositionState}
            settings={shellSettings}
            onSettingsChange={persistShellSettings}
            onDismiss={dismissSettingsOverlay}
          />
        ) : null}
        {appearanceOverlay && bootstrapHandle?.carrier?.model ? (
          <AvatarAppearanceOverlay
            x={appearanceOverlay.x}
            y={appearanceOverlay.y}
            compositionState={compositionState}
            modelManifest={bootstrapHandle.carrier.model}
            sourceAuthority={appearanceSourceAuthority(consume.authority)}
            scale={avatarScale}
            onDismiss={dismissAppearanceOverlay}
          />
        ) : null}
        {debugOverlay && bootstrapHandle?.avatarDebug && companionBinding ? (
          <AvatarDebugOverlay
            x={debugOverlay.x}
            y={debugOverlay.y}
            compositionState={compositionState}
            agentId={companionBinding.agentId}
            conversationAnchorId={companionBinding.conversationAnchorId}
            avatarInstanceId={
              normalizeText(consume.avatarInstanceId)
              ?? normalizeText(launchContext?.avatarInstanceId)
              ?? null
            }
            avatarDebug={bootstrapHandle.avatarDebug}
            onRequestFailed={recordDebugRequestFailed}
            onDismiss={dismissDebugOverlay}
          />
        ) : null}
        {actionRadial ? (
          <AvatarActionRadial
            x={actionRadial.x}
            y={actionRadial.y}
            compositionState={compositionState}
            textInputEnabled={Boolean(bootstrapHandle && companionBinding)}
            onAction={handleActionRadialAction}
            onDismiss={dismissActionRadial}
          />
        ) : null}
        {transientComposer ? (
          <AvatarTransientComposer
            x={transientComposer.x}
            y={transientComposer.y}
            compositionState={compositionState}
            draft={transientComposer.draft}
            sendState={transientComposer.sendState}
            sendError={transientComposer.sendError}
            onDraftChange={(draft) => {
              setTransientComposer((current) =>
                current
                  ? {
                    ...current,
                    draft,
                    sendError: null,
                    sendState: current.sendState === 'sending' ? 'sending' : 'idle',
                  }
                  : current,
              );
            }}
            onSubmit={submitTransientComposer}
            onDismiss={dismissTransientComposer}
          />
        ) : null}
      </>
    ),
    [
      actionRadial,
      activeTurnCue,
      appearanceOverlay,
      avatarScale,
      bootstrapHandle,
      companionBinding,
      compositionState,
      consume.authority,
      consume.avatarInstanceId,
      contextMenu,
      debugOverlay,
      dismissActionRadial,
      dismissAppearanceOverlay,
      dismissContextMenu,
      dismissDebugOverlay,
      dismissSettingsOverlay,
      dismissTransientComposer,
      handleActionRadialAction,
      handleContextMenuAction,
      launchContext?.avatarInstanceId,
      persistShellSettings,
      recordDebugRequestFailed,
      settingsOverlay,
      shellSettings,
      submitTransientComposer,
      transientComposer,
    ],
  );

  return {
    handleAvatarOriginEvent,
    dismissTransientSurfaces,
    overlayNodes,
  };
}
