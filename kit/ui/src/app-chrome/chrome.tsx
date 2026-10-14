import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, ArrowRight, PanelLeft } from 'lucide-react';
import { createNimiAppCommandSet, NIMI_APP_COMMAND_IDS, NIMI_APP_COMMAND_LABELS, type NimiAppCommand, type NimiAppMetadata, type NimiAppSidebar, type NimiStandardAppCommandId } from '@nimiplatform/kit/core/app-commands';
import type { NimiDestination, NimiNavigationController, NimiNavigationResult } from '@nimiplatform/kit/core/navigation';
import type { NimiChromeNativeCommand, NimiChromeState } from '@nimiplatform/kit/shell/capabilities';
import { bindNimiAppChrome, updateNimiAppChromeState, executeNimiAppChromeCommand, unbindNimiAppChrome, subscribeNimiAppChromeCommands, subscribeNimiAppChromeState, hasShellHostInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { Button, IconButton } from '../components/button.js';
import { Tooltip } from '../components/tooltip.js';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/dialog.js';
import { createNimiChromeEditingOwner } from './editing.js';
import { NimiMenubar, type NimiMenubarCommand } from './menubar.js';
import { useOptionalNimiNavigation } from './navigation.js';

const noSubscription = () => () => undefined;
const noSnapshot = () => null;
const emptyCommands: readonly NimiAppCommand[] = [];
const nativeFor: Partial<Record<NimiStandardAppCommandId, NimiChromeNativeCommand>> = {
  'nimi.edit.undo': 'undo', 'nimi.edit.redo': 'redo', 'nimi.edit.cut': 'cut', 'nimi.edit.copy': 'copy', 'nimi.edit.paste': 'paste', 'nimi.edit.select-all': 'select-all',
  'nimi.view.zoom-in': 'zoom-in', 'nimi.view.zoom-out': 'zoom-out', 'nimi.view.zoom-reset': 'zoom-reset', 'nimi.view.fullscreen': 'toggle-fullscreen',
  'nimi.file.close': 'close-window', 'nimi.file.quit': 'quit-app',
};
const contentShortcuts: NimiChromeState['shortcuts'] = [
  { commandId: 'nimi.navigation.back', keys: 'Alt+Left', owner: 'renderer' },
  { commandId: 'nimi.navigation.forward', keys: 'Alt+Right', owner: 'renderer' },
  { commandId: 'nimi.sidebar.toggle', keys: 'Ctrl+B', owner: 'renderer' },
];
// Menu separators split the File panel into destination / window groups, the
// Edit panel into history / clipboard / selection groups, the View panel into
// panel / navigation / zoom / window groups, and the Help panel into
// learn / product groups; ungrouped commands keep the list seamless.
const menuGroup = (id: string): string | undefined => {
  if (id.startsWith('nimi.file.')) return 'window';
  if (id === 'nimi.edit.undo' || id === 'nimi.edit.redo') return 'history';
  if (id.startsWith('nimi.edit.')) return id === 'nimi.edit.select-all' ? 'selection' : 'clipboard';
  if (id === 'nimi.sidebar.toggle') return 'panel';
  if (id.startsWith('nimi.navigation.')) return 'navigation';
  if (id.startsWith('nimi.view.zoom-')) return 'zoom';
  if (id === 'nimi.view.fullscreen') return 'window';
  if (id === 'nimi.help.shortcuts') return 'learn';
  if (id === 'nimi.help.about') return 'product';
  return undefined;
};
// Within-menu presentation order; unset means the default middle rank.
const standardMenuOrder: Partial<Record<NimiStandardAppCommandId, number>> = {
  'nimi.file.close': 20, 'nimi.file.quit': 21,
  'nimi.edit.undo': 10, 'nimi.edit.redo': 20, 'nimi.edit.cut': 30, 'nimi.edit.copy': 40, 'nimi.edit.paste': 50, 'nimi.edit.select-all': 60,
  'nimi.sidebar.toggle': 10, 'nimi.navigation.back': 20, 'nimi.navigation.forward': 21,
  'nimi.view.zoom-in': 30, 'nimi.view.zoom-out': 31, 'nimi.view.zoom-reset': 32, 'nimi.view.fullscreen': 40,
  'nimi.help.shortcuts': 11, 'nimi.help.about': 90,
};
export type NimiAppChromeProps<D extends NimiDestination> = {
  readonly metadata: NimiAppMetadata;
  readonly navigation?: NimiNavigationController<D>;
  readonly navigationEnabled?: boolean;
  /** App-local generation only. It never leaves this UI. */
  readonly scopeKey?: string | number;
  readonly sidebar?: NimiAppSidebar;
  readonly locale?: 'en' | 'zh';
  readonly commands?: readonly NimiAppCommand[];
  readonly onError?: (error: unknown) => void;
};

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-app-chrome
export function NimiAppChrome<D extends NimiDestination>(props: NimiAppChromeProps<D>) {
  const context = useOptionalNimiNavigation();
  const navigation = props.navigation ?? context as unknown as NimiNavigationController<D> | undefined;
  const nav = useSyncExternalStore(navigation?.subscribe ?? noSubscription, navigation?.getSnapshot ?? noSnapshot, navigation?.getSnapshot ?? noSnapshot);
  const locale = props.locale ?? 'en';
  const needsHost = hasShellHostInvoke();
  const [host, setHost] = useState<NimiChromeState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  const [, refresh] = useState(0);
  const [dialog, setDialog] = useState<'about' | 'shortcuts' | null>(null);
  const [compact, setCompact] = useState(false);
  const header = useRef<HTMLElement>(null);
  const foldButton = useRef<HTMLButtonElement>(null);
  const editing = useMemo(() => createNimiChromeEditingOwner(document), []);
  const lastEdit = useRef<NimiChromeNativeCommand>('select-all');
  const scope = useMemo(() => ({}), [navigation, nav?.generation, props.scopeKey, retry]);
  const desired = useRef(scope); desired.current = scope;
  const active = useRef<{ scope: object; state: NimiChromeState } | null>(null);
  const bindingQueue = useRef(Promise.resolve());
  const latest = useRef(props); latest.current = props;
  const dispatchRef = useRef<(id: string) => void>(() => undefined);
  const altAlone = useRef(false);
  const ready = !needsHost || active.current?.scope === scope && host?.generation === active.current.state.generation;
  const capabilities = active.current?.scope === scope ? host : null;
  const report = (value: unknown) => { setError(value); latest.current.onError?.(value); };

  // Scope equality fences callbacks immediately during render, before effect cleanup.
  useEffect(() => {
    let retired = false;
    const cleanups: (() => void)[] = [];
    active.current = null; setHost(null); setDialog(null); setError(null); editing.invalidate();
    if (!needsHost) return () => { retired = true; };
    bindingQueue.current = bindingQueue.current.then(async () => {
      if (retired || desired.current !== scope) return;
      cleanups.push(await subscribeNimiAppChromeCommands(event => {
        const binding = active.current;
        if (!retired && desired.current === scope && binding?.scope === scope && event.generation === binding.state.generation) dispatchRef.current(event.commandId);
      }));
      cleanups.push(await subscribeNimiAppChromeState(state => {
        const binding = active.current;
        if (!retired && desired.current === scope && binding?.scope === scope && state.generation === binding.state.generation) {
          active.current = { scope, state }; setHost(state);
        }
      }));
      const state = await bindNimiAppChrome({ locale: latest.current.locale ?? 'en' });
      if (retired || desired.current !== scope) {
        await unbindNimiAppChrome({ generation: state.generation });
        for (const cleanup of cleanups.splice(0)) cleanup();
        return;
      }
      active.current = { scope, state }; setHost(state);
    }).catch(value => {
      for (const cleanup of cleanups.splice(0)) cleanup();
      if (!retired && desired.current === scope) report(value);
    });
    return () => {
      retired = true;
      for (const cleanup of cleanups.splice(0)) cleanup();
      const previous = active.current;
      if (previous?.scope === scope) {
        active.current = null;
        // Serialized with the next bind; an old release cannot retire a fresh binding.
        bindingQueue.current = bindingQueue.current.then(() => unbindNimiAppChrome({ generation: previous.state.generation })).catch(() => undefined);
      }
    };
  }, [scope, needsHost, editing]);

  useLayoutEffect(() => { editing.invalidate(); editing.capture(); }, [editing, nav?.current.key]);
  useEffect(() => {
    const capture = () => { editing.capture(); refresh(value => value + 1); };
    document.addEventListener('selectionchange', capture); document.addEventListener('focusin', capture); document.addEventListener('input', capture);
    return () => { document.removeEventListener('selectionchange', capture); document.removeEventListener('focusin', capture); document.removeEventListener('input', capture); editing.invalidate(); };
  }, [editing]);
  useEffect(() => {
    if (!header.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => setCompact((entries[0]?.contentRect.width ?? 1000) < 520));
    observer.observe(header.current); return () => observer.disconnect();
  }, []);
  const appCommands = props.commands ?? emptyCommands;
  const appSignature = JSON.stringify(appCommands.map(c => [c.id, c.label, c.menu, c.shortcut, c.order, c.group]));
  const shortcutSignature = JSON.stringify(capabilities?.shortcuts ?? contentShortcuts);
  const commandSet = useMemo(() => {
    const label = (id: NimiStandardAppCommandId) => {
      if (id === 'nimi.help.about') return `${locale === 'zh' ? '关于' : 'About'} ${props.metadata.name}`;
      if (id === 'nimi.file.quit') return `${locale === 'zh' ? '退出' : 'Quit'} ${props.metadata.name}`;
      return NIMI_APP_COMMAND_LABELS[id][locale === 'zh' ? 1 : 0];
    };
    const nativeCommand = async (id: NimiStandardAppCommandId) => {
      const binding = active.current;
      if (!binding || binding.scope !== desired.current) throw new Error('Window chrome is not bound to this scope.');
      const command = nativeFor[id]!;
      if (id.startsWith('nimi.edit.')) { lastEdit.current = command; editing.restore(command); }
      await executeNimiAppChromeCommand({ generation: binding.state.generation, command });
    };
    const handleNavigationResult = (result: NimiNavigationResult) => { if (result.status === 'failed' || result.status === 'invalid') throw result.error; };
    const standard = NIMI_APP_COMMAND_IDS.map((id): NimiAppCommand => ({
      id, label: label(id), menu: id.includes('.edit.') ? 'edit' : id.includes('.file.') ? 'file' : id.includes('.help.') ? 'help' : 'view',
      order: standardMenuOrder[id],
      shortcut: (capabilities?.shortcuts ?? contentShortcuts).find(shortcut => shortcut.commandId === id)?.keys,
      state: () => {
        const binding = active.current;
        const currentReady = !needsHost || binding?.scope === desired.current;
        const position = navigation?.getSnapshot();
        const common = { enabled: currentReady, visible: true };
        if (id.startsWith('nimi.navigation.')) return { ...common, visible: Boolean(navigation), enabled: currentReady && latest.current.navigationEnabled !== false && position?.transitionState === 'idle' && (id.endsWith('back') ? Boolean(position.canGoBack) : Boolean(position.canGoForward)) };
        if (id === 'nimi.sidebar.toggle') return { ...common, visible: Boolean(latest.current.sidebar), enabled: currentReady && latest.current.sidebar?.enabled !== false, checked: latest.current.sidebar?.visible ?? false, reason: latest.current.sidebar?.reason };
        const native = nativeFor[id];
        if (native) return { ...common, visible: Boolean(binding?.state.nativeCommands.includes(native)), enabled: currentReady && Boolean(binding?.state.nativeCommands.includes(native)) && (!id.startsWith('nimi.edit.') || editing.canExecute(native)), ...(id === 'nimi.view.fullscreen' ? { checked: binding?.state.fullscreen } : {}) };
        return { enabled: true, visible: true };
      },
      execute: async () => {
        if (id === 'nimi.navigation.back') handleNavigationResult(await navigation!.back());
        else if (id === 'nimi.navigation.forward') handleNavigationResult(await navigation!.forward());
        else if (id === 'nimi.sidebar.toggle') {
          const sidebar = latest.current.sidebar;
          if (sidebar?.visible) foldButton.current?.focus({ preventScroll: true });
          sidebar?.onVisibleChange(!sidebar.visible);
        } else if (id === 'nimi.help.about') setDialog('about');
        else if (id === 'nimi.help.shortcuts') setDialog('shortcuts');
        else await nativeCommand(id);
      },
    }));
    const declared = appCommands.map(command => ({ ...command, state: () => {
      const current = latest.current.commands?.find(c => c.id === command.id);
      const state = current?.state();
      return state ? { ...state, enabled: state.enabled && (!needsHost || active.current?.scope === desired.current) } : { visible: false, enabled: false };
    }, execute: () => latest.current.commands?.find(c => c.id === command.id)?.execute() }));
    return createNimiAppCommandSet(standard, declared);
  }, [scope, locale, appSignature, navigation, needsHost, editing, shortcutSignature, props.metadata.name]);
  useEffect(() => () => commandSet.dispose(), [commandSet]);
  const dispatch = (id: string) => {
    try {
      const pending = commandSet.execute(id);
      refresh(value => value + 1);
      void pending.catch(report).finally(() => refresh(value => value + 1));
    } catch (value) { report(value); }
  };
  dispatchRef.current = dispatch;
  const shortcuts = capabilities?.shortcuts ?? (needsHost ? [] : contentShortcuts);
  const menuCommands: NimiMenubarCommand[] = commandSet.commands.map(command => ({
    id: command.id, label: command.label, menu: command.menu, order: command.order, group: menuGroup(command.id) ?? command.group,
    shortcut: shortcuts.find(s => s.commandId === command.id)?.keys ?? command.shortcut,
    state: commandSet.state(command.id),
  }));
  const projection = JSON.stringify(menuCommands.map(command => ({ id: command.id, enabled: command.state.enabled && !command.state.busy, visible: command.state.visible, checked: command.state.checked ?? false })));
  const suppress = editing.isEditing();
  useEffect(() => {
    const binding = active.current;
    if (!binding || binding.scope !== scope) return;
    void updateNimiAppChromeState({ generation: binding.state.generation, locale, commands: JSON.parse(projection), suppressMenuShortcuts: suppress }).catch(value => {
      if (desired.current === scope && active.current?.state.generation === binding.state.generation) report(value);
    });
  }, [scope, host?.generation, locale, projection, suppress]);
  useEffect(() => {
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat) return;
      if (event.key === 'Alt') { altAlone.current = !event.ctrlKey && !event.metaKey && !event.shiftKey; return; }
      altAlone.current = false;
      if (capabilities?.menuPlacement !== 'system' && event.key === 'F10' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        const trigger = header.current?.querySelector<HTMLButtonElement>('[data-nimi-menu-trigger]');
        if (trigger) { event.preventDefault(); editing.capture(); trigger.focus(); } return;
      }
      const shortcut = shortcuts.find(s => s.owner === 'renderer' && matchesShortcut(s.keys, event));
      if (!shortcut || !ready) return;
      if (editing.isEditing() && !nativeFor[shortcut.commandId as NimiStandardAppCommandId]) return;
      const command = menuCommands.find(c => c.id === shortcut.commandId);
      if (!command?.state.visible || !command.state.enabled || command.state.busy) return;
      event.preventDefault(); dispatch(shortcut.commandId);
    };
    const keyup = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Alt') return;
      const alone = altAlone.current; altAlone.current = false;
      if (!alone || event.isComposing || event.defaultPrevented || capabilities?.menuPlacement === 'system') return;
      const trigger = header.current?.querySelector<HTMLButtonElement>('[data-nimi-menu-trigger]');
      if (trigger) { event.preventDefault(); editing.capture(); trigger.focus(); }
    };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); };
  });

  const toolbar = (id: 'nimi.navigation.back' | 'nimi.navigation.forward' | 'nimi.sidebar.toggle', icon: React.ReactNode) => {
    const command = menuCommands.find(c => c.id === id)!;
    if (!command.state.visible) return null;
    const label = id === 'nimi.sidebar.toggle' ? props.sidebar?.visible ? locale === 'zh' ? '隐藏侧栏' : 'Hide sidebar' : locale === 'zh' ? '显示侧栏' : 'Show sidebar' : command.label;
    return <Tooltip content={command.state.reason ?? `${label}${command.shortcut ? ` (${command.shortcut})` : ''}`} placement="bottom">
      <IconButton ref={id === 'nimi.sidebar.toggle' ? foldButton : undefined} size="sm" icon={icon} aria-label={label} aria-pressed={id === 'nimi.sidebar.toggle' ? command.state.checked : undefined}
        className="text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-secondary)]"
        disabled={!command.state.enabled || command.state.busy} onClick={() => dispatch(id)} style={{ cursor: 'default' }} />
    </Tooltip>;
  };
  return <>
    <header ref={header} className={`nimi-app-chrome flex h-[var(--nimi-space-9)] min-w-0 shrink-0 items-center gap-[var(--nimi-space-2)] border-b border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-[var(--nimi-space-3)] text-[var(--nimi-text-muted)]${capabilities?.windowDrag ? ' nimi-app-chrome--drag [-webkit-app-region:drag]' : ''}`} aria-label={props.metadata.name}
      style={capabilities?.windowDrag ? { marginLeft: `env(titlebar-area-x, ${capabilities.geometry.left}px)`, width: `env(titlebar-area-width, calc(100% - ${capabilities.geometry.left + capabilities.geometry.right}px))`, height: `env(titlebar-area-height, ${capabilities.geometry.height}px)` } : undefined}>
      <div className="nimi-app-chrome__controls flex items-center gap-[var(--nimi-space-2)] [-webkit-app-region:no-drag]">
        {toolbar('nimi.navigation.back', <ArrowLeft size={16} />)}{toolbar('nimi.navigation.forward', <ArrowRight size={16} />)}
        {toolbar('nimi.sidebar.toggle', <PanelLeft size={16} />)}
      </div>
      {capabilities?.menuPlacement !== 'system' ? <NimiMenubar key={`${nav?.generation ?? 0}:${props.scopeKey ?? ''}`} commands={menuCommands} locale={locale} compact={compact} onExecute={dispatch} onCaptureSelection={() => editing.capture()}
        onRestoreEditFocus={() => { try { editing.restore(lastEdit.current); } catch { /* The command path already surfaced a stale target. */ } }} /> : null}
    </header>
    {error ? <div role="alert" className="px-3 py-1 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-danger)]">
      {locale === 'zh' ? '窗口操作未完成：' : 'Window action failed: '}{error instanceof Error ? error.message : String(error)}
      <Button size="sm" tone="ghost" onClick={() => setRetry(value => value + 1)}>{locale === 'zh' ? '重新连接' : 'Reconnect'}</Button>
    </div> : null}
    <Dialog open={dialog !== null} onOpenChange={open => { if (!open) setDialog(null); }}>
      <DialogContent onClose={() => setDialog(null)}>
        <DialogHeader><DialogTitle>{dialog === 'about' ? `${locale === 'zh' ? '关于' : 'About'} ${props.metadata.name}` : locale === 'zh' ? '快捷键说明' : 'Keyboard shortcuts'}</DialogTitle></DialogHeader>
        <DialogBody><DialogDescription asChild><div>
          {dialog === 'about' ? <><p>{props.metadata.name} {props.metadata.version}</p>{props.metadata.license ? <p>{props.metadata.license}</p> : null}</>
            : <dl>{menuCommands.filter(c => c.state.visible && c.state.enabled && c.shortcut).map(c => <div key={c.id} className="flex justify-between gap-6 py-1"><dt>{c.label}</dt><dd>{c.shortcut}</dd></div>)}</dl>}
        </div></DialogDescription></DialogBody>
        <DialogFooter><Button onClick={() => setDialog(null)}>{locale === 'zh' ? '关闭' : 'Close'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

function matchesShortcut(keys: string, event: globalThis.KeyboardEvent): boolean {
  const parts = keys.toLowerCase().split('+');
  const key = parts.pop();
  const aliases: Record<string, string> = { left: 'arrowleft', right: 'arrowright', plus: '+', minus: '-' };
  return event.key.toLowerCase() === (aliases[key!] ?? key)
    && event.ctrlKey === parts.includes('ctrl') && event.metaKey === parts.includes('cmd') && event.altKey === parts.includes('alt')
    && (key === 'plus' || event.shiftKey === parts.includes('shift'));
}
