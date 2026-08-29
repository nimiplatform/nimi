import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { BootstrapHandle } from './app-shell/app-bootstrap.js';
import type { AvatarAppState } from './app-shell/app-store.js';
import type { AvatarLaunchContext } from './bridge/launch-context.js';
import type {
  CompanionActiveTurnCue,
  CompanionAnchorBinding,
} from './companion-state.js';
import { closeAvatarWindow, hideAvatarWindow } from './app-shell/avatar-window-commands.js';
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
import {
  appearanceSourceAuthority,
  applyLocalPresentation,
  type AvatarActionRadialState,
  type AvatarAppearanceOverlayState,
  type AvatarContextMenuState,
  type AvatarSettingsOverlayState,
  type AvatarTransientComposerState,
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
  } = input;
  const [contextMenu, setContextMenu] = useState<AvatarContextMenuState | null>(null);
  const [actionRadial, setActionRadial] = useState<AvatarActionRadialState | null>(null);
  const [transientComposer, setTransientComposer] = useState<AvatarTransientComposerState | null>(null);
  const [settingsOverlay, setSettingsOverlay] = useState<AvatarSettingsOverlayState | null>(null);
  const [appearanceOverlay, setAppearanceOverlay] = useState<AvatarAppearanceOverlayState | null>(null);
  // Last draft lost to an accidental focus-switch dismissal (e.g. right-click
  // opening the context menu while typing). Intentional closes clear it.
  const composerDraftRef = useRef('');

  const contextIdentity = useCallback(() => {
    return {
      avatar_instance_id: normalizeText(consume.avatarInstanceId)
        ?? normalizeText(launchContext?.avatarInstanceId)
        ?? 'unknown-avatar-instance',
      agent_handle: normalizeText(consume.agentHandle)
        ?? normalizeText(launchContext?.agentHandle)
        ?? 'unknown-agent',
    };
  }, [
    consume.agentHandle,
    consume.avatarInstanceId,
    launchContext?.agentHandle,
    launchContext?.avatarInstanceId,
  ]);

  const dismissContextMenu = useCallback(
    (_reason: AvatarContextMenuDismissReason): void => {
      setContextMenu((current) => {
        if (!current) return null;
        return null;
      });
    },
    [],
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
    },
    [],
  );

  const dismissActionRadial = useCallback(
    (_reason: AvatarActionRadialDismissReason): void => {
      setActionRadial((current) => {
        if (!current) return null;
        return null;
      });
    },
    [],
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
    },
    [],
  );

  const openTransientComposer = useCallback(
    (nextInput: { x: number; y: number; source: 'context_menu' | 'action_radial' }): void => {
      const x = Number.isFinite(nextInput.x) ? nextInput.x : 24;
      const y = Number.isFinite(nextInput.y) ? nextInput.y : 24;
      setTransientComposer((current) => ({
        x,
        y,
        draft: current?.draft ?? composerDraftRef.current,
        sendState: current?.sendState === 'sending' ? 'sending' : 'idle',
        sendError: null,
      }));
    },
    [],
  );

  const dismissTransientComposer = useCallback(
    (reason: AvatarTransientComposerDismissReason): void => {
      setTransientComposer((current) => {
        if (!current) return null;
        // Accidental focus loss (opening another overlay, Alt-Tab) keeps the
        // draft for the next open; intentional closes and composition changes
        // discard it.
        composerDraftRef.current = reason === 'focus_switch' ? current.draft : '';
        return null;
      });
    },
    [],
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
    },
    [bootstrapHandle?.carrier?.model],
  );

  const requestInterruptActiveTurn = useCallback(
    (source: 'context_menu'): void => {
      if (!bootstrapHandle || !companionBinding || !activeTurnCue) return;
      void bootstrapHandle.interruptConversationTurn({
        agentHandle: companionBinding.agentHandle,
        conversationAnchorId: companionBinding.conversationAnchorId,
        turnId: activeTurnCue.turnId,
        reason: 'user_cancel',
      }).catch((error: unknown) => {
        console.warn(
          `[avatar:shell] interrupt request from ${source} failed for turn ${activeTurnCue.turnId}: ${toErrorMessage(error)}`,
        );
      });
    },
    [activeTurnCue, bootstrapHandle, companionBinding],
  );

  const submitTransientComposer = useCallback(
    (): void => {
      if (!bootstrapHandle || !companionBinding) return;
      const text = normalizeText(transientComposer?.draft);
      if (!text || transientComposer?.sendState === 'sending') return;
      composerDraftRef.current = '';
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
      void bootstrapHandle
        .sendConversationText({
          agentHandle: companionBinding.agentHandle,
          conversationAnchorId: companionBinding.conversationAnchorId,
          text,
        })
        .then(() => {
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
        });
    },
    [bootstrapHandle, companionBinding, transientComposer?.draft, transientComposer?.sendState],
  );

  const persistShellSettings = useCallback(
    (next: AvatarShellSettings, _changedKey?: 'always_on_top' | 'show_voice_captions'): void => {
      setShellSettings(next);
      writeAvatarShellSettings(next);
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
      applyLocalPresentation(bootstrapHandle, {
        resolvedActivityName: 'focused',
        intensity: 0.45,
      });
    },
    [bootstrapHandle, bootstrapHandle?.driver, contextIdentity],
  );

  const requestShellLifecycle = useCallback(
    (action: 'hide' | 'close'): void => {
      const command = action === 'hide' ? hideAvatarWindow : closeAvatarWindow;
      void command().catch((error: unknown) => {
        console.warn(`[avatar:shell] ${action} window request failed: ${toErrorMessage(error)}`);
      });
    },
    [],
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
    },
    [
      dismissActionRadial,
      dismissAppearanceOverlay,
      dismissContextMenu,
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
            alwaysOnTop={shellSettings.alwaysOnTop}
            textInputEnabled={Boolean(bootstrapHandle && companionBinding)}
            foregroundPriorityEnabled={Boolean(bootstrapHandle && companionBinding)}
            interruptEnabled={Boolean(bootstrapHandle && companionBinding && activeTurnCue)}
            appearanceEnabled={Boolean(bootstrapHandle?.carrier?.model)}
            resetScaleEnabled={avatarScale !== AVATAR_SCALE_DEFAULT}
            settingsEnabled={true}
            shellLifecycleEnabled={isTauriRuntime()}
            onAction={handleContextMenuAction}
            onDismiss={dismissContextMenu}
          />
        ) : null}
        {settingsOverlay ? (
          <AvatarSettingsOverlay
            x={settingsOverlay.x}
            y={settingsOverlay.y}
            settings={shellSettings}
            onSettingsChange={persistShellSettings}
            onDismiss={dismissSettingsOverlay}
          />
        ) : null}
        {appearanceOverlay && bootstrapHandle?.carrier?.model ? (
          <AvatarAppearanceOverlay
            x={appearanceOverlay.x}
            y={appearanceOverlay.y}
            modelManifest={bootstrapHandle.carrier.model}
            sourceAuthority={appearanceSourceAuthority(consume.authority)}
            scale={avatarScale}
            onDismiss={dismissAppearanceOverlay}
          />
        ) : null}
        {actionRadial ? (
          <AvatarActionRadial
            x={actionRadial.x}
            y={actionRadial.y}
            textInputEnabled={Boolean(bootstrapHandle && companionBinding)}
            onAction={handleActionRadialAction}
            onDismiss={dismissActionRadial}
          />
        ) : null}
        {transientComposer ? (
          <AvatarTransientComposer
            x={transientComposer.x}
            y={transientComposer.y}
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
      consume.authority,
      contextMenu,
      dismissActionRadial,
      dismissAppearanceOverlay,
      dismissContextMenu,
      dismissSettingsOverlay,
      dismissTransientComposer,
      handleActionRadialAction,
      handleContextMenuAction,
      persistShellSettings,
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
