import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { BootstrapHandle } from './app-shell/app-bootstrap.js';
import type { AvatarAppState } from './app-shell/app-store.js';
import type { CompanionAnchorBinding } from './companion-state.js';
import {
  closeAvatarWindow,
  hideAvatarWindow,
  quitAvatarApp,
} from './app-shell/avatar-window-commands.js';
import { hasAvatarHostRuntime } from './app-shell/avatar-host-bridge.js';
import { AVATAR_SCALE_DEFAULT } from './avatar-scale-state.js';
import { normalizeText, toErrorMessage } from './avatar-shell-utils.js';
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
  type AvatarSettingsOverlayChangeKey,
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
  type AvatarAppearanceOverlayState,
  type AvatarContextMenuState,
  type AvatarSettingsOverlayState,
  type AvatarTransientComposerState,
  localClickActivity,
} from './avatar-shell-overlay-model.js';
import { AVATAR_SCALE_MAX, AVATAR_SCALE_MIN, AVATAR_SCALE_WHEEL_STEP } from './avatar-scale-state.js';

// @nimi-authority: rule.nimi.avatar.embodiment.r078

export function useAvatarShellOverlays(input: {
  bootstrapHandle: BootstrapHandle | null;
  companionBinding: CompanionAnchorBinding | null;
  consume: AvatarAppState['consume'];
  shellSettings: AvatarShellSettings;
  setShellSettings: Dispatch<SetStateAction<AvatarShellSettings>>;
  avatarScale: number;
  updateAvatarScale(nextScaleInput: number, source: 'wheel' | 'reset'): void;
  quietLatched: boolean;
  onOpenCapsule(): void;
  onReengage(): void;
  onQuiet(): void;
}) {
  const {
    bootstrapHandle,
    companionBinding,
    consume,
    shellSettings,
    setShellSettings,
    avatarScale,
    updateAvatarScale,
    quietLatched,
    onOpenCapsule,
    onReengage,
    onQuiet,
  } = input;
  const [contextMenu, setContextMenu] = useState<AvatarContextMenuState | null>(null);
  const [transientComposer, setTransientComposer] = useState<AvatarTransientComposerState | null>(null);
  const [settingsOverlay, setSettingsOverlay] = useState<AvatarSettingsOverlayState | null>(null);
  const [appearanceOverlay, setAppearanceOverlay] = useState<AvatarAppearanceOverlayState | null>(null);
  // Last draft lost to an accidental focus-switch dismissal (e.g. right-click
  // opening the context menu while typing). Intentional closes clear it.
  const composerDraftRef = useRef('');

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

  const openTransientComposer = useCallback(
    (nextInput: { x: number; y: number; source: 'context_menu' | 'capsule' }): void => {
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
          composerDraftRef.current = '';
          setTransientComposer(null);
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
    (next: AvatarShellSettings, _changedKey?: AvatarSettingsOverlayChangeKey): void => {
      setShellSettings(next);
      writeAvatarShellSettings(next);
    },
    [setShellSettings],
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
        onReengage();
        openTransientComposer({
          x: contextMenu?.x ?? 24,
          y: contextMenu?.y ?? 24,
          source: 'context_menu',
        });
        dismissContextMenu('action');
        return;
      }
      if (action === 'open_capsule') {
        onOpenCapsule();
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
      if (action === 'zoom_in') {
        updateAvatarScale(avatarScale + AVATAR_SCALE_WHEEL_STEP, 'wheel');
        dismissContextMenu('action');
        return;
      }
      if (action === 'zoom_out') {
        updateAvatarScale(avatarScale - AVATAR_SCALE_WHEEL_STEP, 'wheel');
        dismissContextMenu('action');
        return;
      }
      if (action === 'quiet') {
        onQuiet();
        dismissContextMenu('action');
        dismissTransientComposer('composition_change');
        dismissSettingsOverlay('composition_change');
        dismissAppearanceOverlay('composition_change');
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
        onQuiet();
        dismissTransientComposer('composition_change');
        dismissSettingsOverlay('composition_change');
        dismissAppearanceOverlay('composition_change');
        requestShellLifecycle('hide');
      }
      if (action === 'close') {
        requestShellLifecycle('close');
      }
      if (action === 'quit_app') {
        void quitAvatarApp().catch((error: unknown) => {
          console.warn(`[avatar:shell] quit app request failed: ${toErrorMessage(error)}`);
        });
      }
      dismissContextMenu('action');
    },
    [
      contextMenu?.x,
      contextMenu?.y,
      dismissContextMenu,
      openAppearanceOverlay,
      openTransientComposer,
      onOpenCapsule,
      onReengage,
      onQuiet,
      persistShellSettings,
      requestShellLifecycle,
      shellSettings,
      avatarScale,
      updateAvatarScale,
    ],
  );

  const handleAvatarOriginEvent = useCallback(
    (event: AppOriginEvent): void => {
      if (!(quietLatched && event.name === 'avatar.user.click')) {
        bootstrapHandle?.driver?.emit(event);
      }
      if (event.name === 'avatar.user.click' && !quietLatched) {
        applyLocalPresentation(bootstrapHandle, localClickActivity(event));
      }
      if (event.name === 'avatar.user.double_click') {
        onOpenCapsule();
      }
      if (event.name === 'avatar.user.long_press') {
        openContextMenu(event);
      }
      if (event.name === 'avatar.user.right_click') {
        openContextMenu(event);
      }
    },
    [
      bootstrapHandle,
      bootstrapHandle?.driver,
      openContextMenu,
      onOpenCapsule,
      quietLatched,
    ],
  );

  const dismissTransientSurfaces = useCallback(
    (reason: 'composition_change'): void => {
      dismissContextMenu(reason);
      dismissTransientComposer(reason);
      dismissSettingsOverlay(reason);
      dismissAppearanceOverlay(reason);
    },
    [
      dismissAppearanceOverlay,
      dismissContextMenu,
      dismissSettingsOverlay,
      dismissTransientComposer,
    ],
  );

  useEffect(() => {
    if (quietLatched) dismissTransientSurfaces('composition_change');
  }, [dismissTransientSurfaces, quietLatched]);

  const overlayNodes = useMemo(
    () => (
      <>
        {contextMenu ? (
          <AvatarContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            alwaysOnTop={shellSettings.alwaysOnTop}
            textInputEnabled={Boolean(bootstrapHandle && companionBinding)}
            capsuleEnabled={Boolean(bootstrapHandle && companionBinding)}
            appearanceEnabled={Boolean(bootstrapHandle?.carrier?.model)}
            resetScaleEnabled={avatarScale !== AVATAR_SCALE_DEFAULT}
            zoomInEnabled={avatarScale < AVATAR_SCALE_MAX}
            zoomOutEnabled={avatarScale > AVATAR_SCALE_MIN}
            quietActive={quietLatched}
            settingsEnabled={true}
            shellLifecycleEnabled={hasAvatarHostRuntime()}
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
      appearanceOverlay,
      avatarScale,
      bootstrapHandle,
      companionBinding,
      consume.authority,
      contextMenu,
      dismissAppearanceOverlay,
      dismissContextMenu,
      dismissSettingsOverlay,
      dismissTransientComposer,
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
    openTextInputFromCapsule: () => {
      onOpenCapsule();
      openTransientComposer({
        x: typeof window === 'undefined' ? 24 : Math.max(24, window.innerWidth - 360),
        y: typeof window === 'undefined' ? 24 : Math.max(24, window.innerHeight - 150),
        source: 'capsule',
      });
    },
    overlayNodes,
  };
}
