import type { BrowserWindow, Menu, MenuItemConstructorOptions, NativeImage, Tray } from 'electron';
import type { DesktopQuitPhase } from './system-entry-quit-coordinator.js';
import {
  SYSTEM_ENTRY_LIVENESS_MS,
  isSystemEntryActionOffered,
  parseSystemEntryActionRequest,
  parseSystemEntryHeartbeat,
  parseSystemEntryProjection,
  type SystemEntryAction,
  type SystemEntryActionContext,
  type SystemEntryActionRequest,
  type SystemEntryAdmission,
  type SystemEntryContext,
  type SystemEntryLocale,
  type SystemEntryProjection,
  type SystemEntrySnapshot,
} from '../src/shell/shared/system-entry-types.js';
import {
  createSystemEntryPopupHost,
  type CreateSystemEntryPopupHostInput,
  type SystemEntryPopupHost,
} from './system-entry-popup-host.js';

export type DesktopSystemEntryHost = {
  readonly enabled: boolean;
  initialize(): Promise<void>;
  dispose(): void;
  context(): Promise<SystemEntryContext>;
  snapshot(): Promise<SystemEntrySnapshot>;
  publish(value: unknown): Promise<void>;
  heartbeat(value: unknown): Promise<void>;
  invalidate(reason?: string): void;
  act(value: unknown): Promise<void>;
  setLocale(locale: SystemEntryLocale): void;
  setHomeVisibility(visible: boolean): void;
  setQuitPhase(phase: DesktopQuitPhase): void;
  hideHomeWindowOnClose(): boolean;
  hasRecoverableEntry(): boolean;
  openOverview(): Promise<void>;
  openMenu(): void;
  popupWebContents(): BrowserWindow['webContents'] | undefined;
};

export type CreateDesktopSystemEntryHostInput = {
  electron: CreateSystemEntryPopupHostInput['electron'] & {
    Tray: new (image: NativeImage | string) => Tray;
    Menu: Pick<typeof Menu, 'buildFromTemplate'>;
  };
  icon: NativeImage | string;
  popup: Readonly<{ url: string; preloadPath: string }>;
  configurePopup(window: BrowserWindow): void;
  getAdmission(): SystemEntryAdmission | Promise<SystemEntryAdmission>;
  executeAction(action: SystemEntryAction, context: SystemEntryActionContext): Promise<void>;
  ensureHomeWindow(): Promise<void> | void;
  hideHomeWindow(): void;
  requestQuit(): Promise<unknown> | void;
  reportError(operation: string, error: unknown): void;
  locale?: SystemEntryLocale;
  platform?: NodeJS.Platform;
  /** Monotonic milliseconds for transport liveness, independent of observedAt. */
  now?: () => number;
  admissionTimeoutMs?: number;
};

const RECOVERY_ACTIONS = new Set<SystemEntryAction['kind']>(['home', 'support', 'refresh', 'quit']);
const ADMISSION_STATES = new Set<SystemEntryAdmission['state']>(['ready', 'login-required', 'recovery-required', 'unknown', 'locked']);

// @nimi-authority: rule.nimi.desktop.shell-ui.r062
// @nimi-authority: rule.nimi.desktop.shell-ui.system-entry-projection
// @nimi-authority: rule.nimi.desktop.bridge-ipc.system-entry-isolation
export function createDesktopSystemEntryHost(input: CreateDesktopSystemEntryHostInput): DesktopSystemEntryHost {
  const platform = input.platform ?? process.platform;
  const enabled = platform === 'darwin' || platform === 'win32';
  const now = input.now ?? (() => performance.now());
  let tray: Tray | undefined;
  let popup: SystemEntryPopupHost | undefined;
  let menu: Menu | undefined;
  let initialized = false;
  let disposed = false;
  let quitPending = false;
  let observationStopped = false;
  let homeVisible = true;
  let locale: SystemEntryLocale = input.locale ?? 'en';
  let colorScheme: SystemEntrySnapshot['colorScheme'] = null;
  let admission: SystemEntryAdmission = { generation: 'unavailable', state: 'unknown' };
  let projection: SystemEntryProjection | null = null;
  let revision = -1;
  let observation: SystemEntrySnapshot['observation'] = 'waiting';
  let actionError: string | null = null;
  let receivedAt: number | null = null;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let singleClick: ReturnType<typeof setTimeout> | undefined;
  let invalidation = 0;
  let admissionRequest = 0;
  let settledAdmissionRequest = 0;
  let lastDoubleClick = Number.NEGATIVE_INFINITY;

  const currentSnapshot = (): SystemEntrySnapshot => ({
    admission: { ...admission }, revision: Math.max(0, revision), locale, colorScheme,
    observation, homeVisible,
    projection: admission.state === 'ready' && observation === 'current' ? projection : null,
    actionError,
  });
  const notify = (): void => { popup?.publish(currentSnapshot()); };
  const closeMenu = (): void => {
    const current = menu;
    menu = undefined;
    try { tray?.closeContextMenu(); }
    catch (error) { input.reportError('system-entry-close-menu', error); }
    try { current?.closePopup(); }
    catch (error) { input.reportError('system-entry-close-menu', error); }
  };
  const updateTooltip = (): void => {
    if (!tray || tray.isDestroyed()) return;
    const copy = menuCopy(locale);
    const description = admission.state === 'ready' && observation === 'current' && projection
      ? serviceLabel(projection.service, locale)
      : admission.state === 'login-required' ? copy.loginRequired
        : admission.state === 'recovery-required' ? copy.recoveryRequired
          : admission.state === 'locked' ? copy.locked : copy.observationUnavailable;
    tray.setToolTip(`Nimi · ${description}`);
  };
  const clearObservation = (): void => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = undefined;
    receivedAt = null;
    projection = null;
    observation = 'unavailable';
    closeMenu();
    updateTooltip();
    notify();
  };
  const expireObservation = (): void => {
    if (receivedAt !== null && now() - receivedAt >= SYSTEM_ENTRY_LIVENESS_MS) clearObservation();
  };
  const scheduleWatchdog = (): void => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      watchdog = undefined;
      expireObservation();
      if (receivedAt !== null) scheduleWatchdog();
    }, Math.max(1, SYSTEM_ENTRY_LIVENESS_MS - (receivedAt === null ? 0 : now() - receivedAt)));
    watchdog.unref?.();
  };
  const invalidate = (reason?: string): void => {
    invalidation += 1;
    actionError = reason === 'renderer-unresponsive' ? 'system-entry-observation-unavailable' : null;
    clearObservation();
    popup?.hide('invalidate');
  };

  const readAdmission = async (): Promise<SystemEntryAdmission> => {
    if (observationStopped) throw new Error('system-entry-observation-stopped');
    const request = ++admissionRequest;
    const capturedInvalidation = invalidation;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => input.getAdmission()),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('system-entry-admission-unavailable')), input.admissionTimeoutMs ?? 2_000);
          timer.unref?.();
        }),
      ]);
      if (observationStopped) throw new Error('system-entry-observation-stopped');
      if (disposed || capturedInvalidation !== invalidation) throw new Error('system-entry-view-stale');
      if (typeof result?.generation !== 'string' || !result.generation || result.generation.length > 128 || !ADMISSION_STATES.has(result.state)) {
        throw new Error('system-entry-admission-invalid');
      }
      if (request < settledAdmissionRequest) return admission;
      settledAdmissionRequest = request;
      const changedGeneration = admission.generation !== result.generation;
      const changedState = admission.state !== result.state;
      if (changedGeneration || changedState) {
        clearObservation();
        if (changedGeneration) revision = -1;
      }
      admission = { generation: result.generation, state: result.state };
      if (admission.state !== 'ready') projection = null;
      updateTooltip();
      if (changedGeneration || changedState) notify();
      return admission;
    } catch (error) {
      // Teardown may remove the account observer while this read is pending.
      // Its result belongs to the stopped observation, not a new Runtime fault.
      if (observationStopped) throw new Error('system-entry-observation-stopped');
      if (disposed || capturedInvalidation !== invalidation) throw new Error('system-entry-view-stale');
      if (request < settledAdmissionRequest) return admission;
      if (!disposed && capturedInvalidation === invalidation) {
        settledAdmissionRequest = request;
        admission = { generation: admission.generation, state: 'unknown' };
        clearObservation();
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const snapshot = async (): Promise<SystemEntrySnapshot> => {
    if (observationStopped) return currentSnapshot();
    try { await readAdmission(); }
    catch (error) {
      // Native recovery remains available even when formal reads fail. A
      // failed query grants no ordinary access and preserves no private UI.
      input.reportError('system-entry-admission', error);
    }
    expireObservation();
    return currentSnapshot();
  };

  const entryReady = (): boolean => {
    if (!initialized || disposed || !tray || tray.isDestroyed()) return false;
    try {
      const bounds = tray.getBounds();
      return [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
        && bounds.width > 0 && bounds.height > 0;
    } catch { return false; }
  };
  const restoreEntryFocus = (): void => {
    // Only Windows exposes Tray.focus. macOS uses native panel dismissal;
    // its accessibility focus must be checked in native acceptance.
    if (platform === 'win32' && entryReady()) tray?.focus();
  };

  const act = async (raw: unknown): Promise<void> => {
    const request = parseSystemEntryActionRequest(raw);
    if (disposed) throw new Error('system-entry-disposed');
    try {
      if (RECOVERY_ACTIONS.has(request.action.kind)) {
        if (request.action.kind === 'quit') await input.requestQuit();
        else if (request.action.kind === 'home') await input.ensureHomeWindow();
        else await input.executeAction(request.action, { generation: admission.generation, revision: Math.max(0, revision) });
      } else {
        if (quitPending) throw new Error('system-entry-quit-in-progress');
        const current = await readAdmission();
        expireObservation();
        if (current.state !== 'ready') throw new Error('system-entry-admission-required');
        if (request.generation !== current.generation || request.revision !== revision) throw new Error('system-entry-view-stale');
        if (observation !== 'current' || !projection) throw new Error('system-entry-observation-unavailable');
        if (!isSystemEntryActionOffered(projection, request.action)) throw new Error('system-entry-action-unavailable');
        await input.executeAction(request.action, { generation: current.generation, revision });
      }
      actionError = null;
      if (!['pause-notifications', 'resume-notifications', 'refresh'].includes(request.action.kind)) popup?.hide('destination');
      notify();
    } catch (error) {
      actionError = safeActionError(error);
      notify();
      throw error;
    }
  };
  const reportActionFailure = (error: unknown): void => {
    input.reportError('system-entry-action', error);
    if (admission.state !== 'locked') void popup?.show().catch((failure) => input.reportError('system-entry-popup', failure));
  };
  const openOverview = async (): Promise<void> => {
    if (!initialized || disposed || !popup) throw new Error('system-entry-unavailable');
    closeMenu();
    try { await popup.show(); }
    catch (error) {
      input.reportError('system-entry-popup', error);
      await input.ensureHomeWindow();
      throw error;
    }
  };

  const openMenu = (): void => {
    if (!initialized || disposed || !tray || tray.isDestroyed()) return;
    if (singleClick) clearTimeout(singleClick);
    singleClick = undefined;
    expireObservation();
    closeMenu();
    popup?.hide('menu');
    const view = currentSnapshot();
    const copy = menuCopy(locale);
    const context: SystemEntryActionContext = { generation: view.admission.generation, revision: view.revision };
    const ready = !quitPending && view.admission.state === 'ready' && view.observation === 'current' && view.projection !== null;
    const action = (value: SystemEntryAction): (() => void) => () => { void act({ ...context, action: value }).catch(reportActionFailure); };
    const rows = (source: SystemEntryProjection['recent'] | undefined, fallback: SystemEntryAction): MenuItemConstructorOptions[] => [
      ...(ready && source && !['unavailable', 'loading'].includes(source.status)
        ? source.items.filter((item) => item.action).map((item) => ({ label: menuLabel(item.title), click: action(item.action!) })) : []),
      { label: copy.showAll, enabled: ready, click: action(fallback) },
    ];
    const template: MenuItemConstructorOptions[] = [
      { label: actionError ? copy.actionFailed : ready ? serviceLabel(view.projection!.service, locale) : copy.observationUnavailable, enabled: false },
      { type: 'separator' },
      { id: 'system-entry-overview', label: copy.overview, click: () => { void openOverview().catch((error) => input.reportError('system-entry-overview', error)); } },
      { id: 'system-entry-home', label: copy.home, click: action({ kind: 'home' }) },
      { id: 'system-entry-chat', label: copy.chat, enabled: ready, submenu: rows(view.projection?.recent, { kind: 'chat' }) },
      { id: 'system-entry-apps', label: copy.apps, enabled: ready, submenu: rows(view.projection?.apps, { kind: 'apps' }) },
      { id: 'system-entry-downloads', label: copy.downloads, enabled: ready, click: action({ kind: 'downloads' }) },
      { id: 'system-entry-capabilities', label: copy.capabilities, enabled: ready, click: action({ kind: 'ai-capabilities' }) },
      { id: 'system-entry-usage', label: copy.usage, enabled: ready, click: action({ kind: 'usage' }) },
      { id: 'system-entry-notifications', label: view.projection?.notificationsEnabled === false ? copy.notificationSettings
        : view.projection && view.projection.notificationsPausedUntil > Date.now() ? copy.resumeNotifications : copy.pauseNotifications,
        enabled: ready,
        click: action({ kind: view.projection?.notificationsEnabled === false ? 'notification-settings'
          : view.projection && view.projection.notificationsPausedUntil > Date.now() ? 'resume-notifications' : 'pause-notifications' }) },
      { type: 'separator' },
      { id: 'system-entry-settings', label: copy.settings, enabled: ready, click: action({ kind: 'settings' }) },
      { id: 'system-entry-support', label: copy.support, click: action({ kind: 'support' }) },
      { id: 'system-entry-quit', label: copy.quit, enabled: !quitPending, click: action({ kind: 'quit' }) },
    ];
    const currentMenu = input.electron.Menu.buildFromTemplate(template);
    menu = currentMenu;
    currentMenu.once('menu-will-close', () => {
      if (menu === currentMenu) menu = undefined;
    });
    try { tray.popUpContextMenu(currentMenu); }
    catch (error) { menu = undefined; input.reportError('system-entry-menu', error); }
  };

  return Object.freeze({
    enabled,
    async initialize(): Promise<void> {
      if (!enabled) throw new Error('system-entry-platform-unsupported');
      if (initialized || disposed) throw new Error('system-entry-already-initialized');
      const icon = prepareIcon(input.icon, platform);
      try {
        tray = new input.electron.Tray(icon);
        popup = createSystemEntryPopupHost({
          electron: input.electron, ...input.popup, configurePopup: input.configurePopup,
          anchor: () => tray && !tray.isDestroyed() ? tray.getBounds() : undefined,
          getSnapshot: snapshot, act, openMenu, restoreEntryFocus,
          reportError: input.reportError, platform,
        });
        tray.on('click', () => {
          if (singleClick) clearTimeout(singleClick);
          if (platform === 'win32' && now() - lastDoubleClick < 250) return;
          const toggle = (): void => {
            singleClick = undefined;
            if (popup?.isVisible() || popup?.isOpening()) popup.hide('escape');
            else void openOverview().catch((error) => input.reportError('system-entry-overview', error));
          };
          if (platform === 'win32') { singleClick = setTimeout(toggle, 250); singleClick.unref?.(); }
          else toggle();
        });
        tray.on('right-click', openMenu);
        if (platform === 'darwin') tray.setIgnoreDoubleClickEvents(true);
        if (platform === 'win32') tray.on('double-click', () => {
          lastDoubleClick = now();
          if (singleClick) clearTimeout(singleClick);
          singleClick = undefined;
          popup?.hide('destination');
          closeMenu();
          void Promise.resolve().then(() => input.ensureHomeWindow()).catch((error: unknown) => input.reportError('system-entry-home', error));
        });
        initialized = true;
        updateTooltip();
      } catch (error) {
        popup?.dispose();
        popup = undefined;
        tray?.destroy();
        tray = undefined;
        throw error;
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      invalidation += 1;
      if (watchdog) clearTimeout(watchdog);
      if (singleClick) clearTimeout(singleClick);
      closeMenu();
      popup?.dispose();
      popup = undefined;
      tray?.destroy();
      tray = undefined;
      initialized = false;
      projection = null;
    },
    async context(): Promise<SystemEntryContext> {
      const current = await readAdmission();
      return { ...current, homeVisible };
    },
    snapshot,
    async publish(raw: unknown): Promise<void> {
      const value = parseSystemEntryProjection(raw);
      const fence = invalidation;
      const current = await readAdmission();
      if (fence !== invalidation) throw new Error('system-entry-view-stale');
      if (current.state !== 'ready') throw new Error('system-entry-admission-required');
      if (value.generation !== current.generation || value.revision <= revision) throw new Error('system-entry-view-stale');
      projection = value;
      revision = value.revision;
      locale = value.locale;
      colorScheme = value.colorScheme;
      observation = 'current';
      actionError = null;
      receivedAt = now();
      scheduleWatchdog();
      updateTooltip();
      notify();
    },
    async heartbeat(raw: unknown): Promise<void> {
      const value = parseSystemEntryHeartbeat(raw);
      const current = await readAdmission();
      if (value.generation !== current.generation) throw new Error('system-entry-view-stale');
      expireObservation();
      // Transport recovery cannot restore a cleared projection. Only a newer
      // current-scope snapshot may make object actions available again.
      if (projection && observation === 'current') {
        receivedAt = now();
        scheduleWatchdog();
      }
    },
    invalidate,
    act,
    setLocale(value: SystemEntryLocale): void {
      if (value !== 'zh' && value !== 'en') throw new Error('system-entry-locale-invalid');
      if (locale !== value) closeMenu();
      locale = value;
      updateTooltip();
      notify();
    },
    setHomeVisibility(visible: boolean): void { homeVisible = visible; notify(); },
    setQuitPhase(phase: DesktopQuitPhase): void {
      quitPending = phase !== 'idle';
      const stopped = phase === 'stopping' || phase === 'committed' || phase === 'system-ending';
      if (stopped === observationStopped) return;
      observationStopped = stopped;
      invalidate();
    },
    hideHomeWindowOnClose(): boolean {
      if (quitPending || !entryReady()) return false;
      input.hideHomeWindow();
      homeVisible = false;
      notify();
      return true;
    },
    hasRecoverableEntry: entryReady,
    openOverview,
    openMenu,
    popupWebContents: () => popup?.webContents(),
  });
}

function prepareIcon(icon: NativeImage | string, platform: NodeJS.Platform): NativeImage | string {
  if (typeof icon === 'string') {
    if (!icon.trim()) throw new Error('system-entry-icon-invalid');
    return icon;
  }
  if (icon.isEmpty()) throw new Error('system-entry-icon-invalid');
  if (platform === 'darwin') icon.setTemplateImage(true);
  return icon;
}

function menuLabel(value: string): string {
  return value.replace(/[\r\n\t]/gu, ' ').replace(/&/gu, '&&').slice(0, 180);
}

function safeActionError(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return ['system-entry-view-stale', 'system-entry-admission-required', 'system-entry-observation-unavailable', 'system-entry-action-unavailable'].includes(code)
    ? code : 'system-entry-action-failed';
}

function serviceLabel(state: SystemEntryProjection['service'], locale: SystemEntryLocale): string {
  const labels: Record<string, readonly [string, string]> = {
    running: ['本地 AI 服务运行中', 'Local AI service running'],
    degraded: ['本地 AI 服务需要关注', 'Local AI service needs attention'],
    starting: ['本地 AI 服务正在启动', 'Local AI service starting'],
    stopped: ['本地 AI 服务已停止', 'Local AI service stopped'],
    unavailable: ['本地 AI 服务暂时无法确认', 'Local AI service unavailable'],
  };
  return (labels[state] ?? labels.unavailable)![locale === 'zh' ? 0 : 1];
}

function menuCopy(locale: SystemEntryLocale) {
  return locale === 'zh' ? {
    overview: '快速概览', home: '打开 Nimi Home', chat: '继续聊天', apps: '已打开的 App',
    downloads: '下载', capabilities: 'AI 能力', usage: 'AI 活动与用量', settings: '设置', support: '帮助与恢复',
    pauseNotifications: '暂停普通提醒 1 小时', resumeNotifications: '恢复普通提醒', notificationSettings: '通知设置', quit: '退出 Nimi Home',
    showAll: '查看全部', observationUnavailable: '活动状态待更新', actionFailed: '操作未完成，请打开概览查看',
    loginRequired: '打开 Home 登录', recoveryRequired: '打开 Home 查看恢复步骤', locked: '已锁定',
  } : {
    overview: 'Quick overview', home: 'Open Nimi Home', chat: 'Continue chatting', apps: 'Open Apps',
    downloads: 'Downloads', capabilities: 'AI Capabilities', usage: 'AI activity & usage', settings: 'Settings', support: 'Help & recovery',
    pauseNotifications: 'Pause ordinary notifications for 1 hour', resumeNotifications: 'Resume ordinary notifications', notificationSettings: 'Notification settings', quit: 'Quit Nimi Home',
    showAll: 'Show all', observationUnavailable: 'Activity awaiting update', actionFailed: 'Action failed — open overview for details',
    loginRequired: 'Open Home to sign in', recoveryRequired: 'Open Home for recovery', locked: 'Locked',
  };
}
