import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NimiElectronAppBusinessServices } from '@nimiplatform/kit/shell/electron/main';
import { BrowserWindow, app, dialog, shell, utilityProcess, type IpcMain, type IpcMainInvokeEvent } from 'electron';
import { HarnessBodySymbiosisClient } from './body-symbiosis.js';
import { EngineWorkerHostClient } from './engine-worker.js';
import { openHarness, type PermissionMode } from './harness.js';
import { serveSessions } from './session-provider.js';

export type HarnessBundledControllerInput = Readonly<{
  ipcMain: IpcMain;
  services: NimiElectronAppBusinessServices;
  engineWorkerPath: string;
  ownsSender: (event: IpcMainInvokeEvent) => boolean;
  notifyViewChanged: () => void;
  notifyFocusSession: (workSessionRef: string) => void;
  focusWindow: () => Promise<void>;
  reportError: (error: unknown) => void;
}>;

export type HarnessBundledController = Readonly<{
  start: () => Promise<void>;
  focusWorkSession: (workSessionRef: string) => Promise<void>;
  shutdown: () => Promise<void>;
}>;

const HARNESS_CHANNELS = [
  'harness:snapshot',
  'harness:import-home',
  'harness:import-material',
  'harness:list-files',
  'harness:preview-file',
  'harness:reveal-file',
  'harness:reveal-workspace',
  'harness:choose-workspace',
  'harness:set-workspace',
  'harness:create',
  'harness:select',
  'harness:rename',
  'harness:delete-session',
  'harness:pin-session',
  'harness:set-permission-mode',
  'harness:set-reasoning-effort',
  'harness:export-markdown',
  'harness:list-integrations',
  'harness:withdraw',
  'harness:instructions',
  'harness:submit',
  'harness:decide',
  'harness:list-snapshots',
  'harness:restore-snapshot',
  'harness:review-model',
  'harness:stop',
  'harness:resume',
] as const;

async function resolvePersistentDeviceId(
  storage: NimiElectronAppBusinessServices['storage'],
  signal: AbortSignal,
): Promise<string> {
  try {
    const existing = (await storage.readJson('harness-device-id.json')).value;
    if (typeof existing === 'string' && /^[A-Za-z0-9._-]{8,128}$/.test(existing)) {
      return existing;
    }
  } catch {
    // Missing device id; allocate one durably under account storage.
  }
  signal.throwIfAborted();
  const created = `pc-${randomUUID()}`;
  await storage.writeJson('harness-device-id.json', created).catch(() => {});
  return created;
}

export function createHarnessBundledController(input: HarnessBundledControllerInput): HarnessBundledController {
  const { ipcMain, services, ownsSender, notifyViewChanged, notifyFocusSession, focusWindow, reportError } = input;
  const lifetime = new AbortController();
  const harnessDataRoot = path.join(app.getPath('userData'), 'harness');
  let engineWorker: EngineWorkerHostClient | undefined;
  let harnessPromise: ReturnType<typeof openHarness> | undefined;
  let symbiosis: HarnessBodySymbiosisClient | undefined;
  let closed = false;

  const assertSender = (event: IpcMainInvokeEvent): void => {
    if (closed || lifetime.signal.aborted || !ownsSender(event)) {
      throw new Error('Nimi Harness accepts commands from its main window.');
    }
  };

  const getHarness = (): ReturnType<typeof openHarness> => {
    if (!harnessPromise) {
      let queued: ReturnType<typeof setTimeout> | undefined;
      const opening = openHarness(services, lifetime.signal, () => {
        if (queued || lifetime.signal.aborted) return;
        queued = setTimeout(() => {
          queued = undefined;
          notifyViewChanged();
        }, 60);
        queued.unref();
      }, {
        dataRoot: harnessDataRoot,
        symbiosis,
        requireSymbiosis: true,
      });
      opening.catch(() => {
        if (harnessPromise === opening) harnessPromise = undefined;
      });
      harnessPromise = opening;
    }
    return harnessPromise;
  };

  ipcMain.handle('harness:snapshot', async (event) => {
    assertSender(event);
    return (await getHarness()).snapshot();
  });
  ipcMain.handle('harness:import-home', async (event, source: unknown) => {
    assertSender(event);
    if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > 10 * 1024 * 1024) {
      throw new Error('Choose a valid Home conversation export file up to 10 MiB.');
    }
    await (await getHarness()).importHome(source);
  });
  ipcMain.handle('harness:import-material', async (event, id: unknown, name: unknown, data: unknown) => {
    assertSender(event);
    if (typeof id !== 'string' || typeof name !== 'string' || !name.trim() || !(data instanceof Uint8Array)) {
      throw new Error('Choose a file to add to this session.');
    }
    return (await getHarness()).importMaterial(id, name, data);
  });
  ipcMain.handle('harness:list-files', async (event, id: unknown, folder: unknown, offset: unknown) => {
    assertSender(event);
    if (typeof id !== 'string' || typeof folder !== 'string'
      || typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) {
      throw new Error('Invalid file listing request.');
    }
    return (await getHarness()).listFiles(id, folder, offset);
  });
  ipcMain.handle('harness:preview-file', async (event, id: unknown, ref: unknown, page?: unknown) => {
    assertSender(event);
    if (typeof id !== 'string' || typeof ref !== 'string'
      || (page !== undefined && (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1))) {
      throw new Error('Invalid file preview request.');
    }
    return (await getHarness()).previewFile(id, ref, page);
  });
  ipcMain.handle('harness:reveal-file', async (event, id: unknown, ref: unknown) => {
    assertSender(event);
    if (typeof id !== 'string' || typeof ref !== 'string') throw new Error('Invalid file.');
    const filePath = await (await getHarness()).revealFile(id, ref);
    lifetime.signal.throwIfAborted();
    shell.showItemInFolder(filePath);
  });
  ipcMain.handle('harness:reveal-workspace', async (event, id: unknown) => {
    assertSender(event);
    if (typeof id !== 'string') throw new Error('Invalid session.');
    const dir = await (await getHarness()).revealWorkspace(id);
    lifetime.signal.throwIfAborted();
    await shell.openPath(dir);
  });
  ipcMain.handle('harness:choose-workspace', async (event) => {
    assertSender(event);
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });
  ipcMain.handle('harness:set-workspace', async (event, id: unknown, dir: unknown) => {
    assertSender(event);
    if (typeof id !== 'string') throw new Error('Invalid session.');
    if (dir !== null && (typeof dir !== 'string' || !path.isAbsolute(dir) || /[\x00-\x1f]/u.test(dir))) {
      throw new Error('Choose an absolute directory path for the workspace.');
    }
    await (await getHarness()).setWorkspace(id, dir);
  });
  ipcMain.handle('harness:create', async (event, configRef: unknown, workspaceDir?: unknown) => {
    assertSender(event);
    if (configRef !== undefined && (typeof configRef !== 'string' || !/^(main|[0-9a-f]{32})$/.test(configRef))) {
      throw new Error('Invalid configuration reference.');
    }
    if (workspaceDir !== undefined && (typeof workspaceDir !== 'string' || !path.isAbsolute(workspaceDir) || /[\x00-\x1f]/u.test(workspaceDir))) {
      throw new Error('Invalid workspace directory.');
    }
    await (await getHarness()).create(configRef, workspaceDir);
  });
  ipcMain.handle('harness:select', async (event, id: unknown) => {
    assertSender(event);
    if (typeof id !== 'string') throw new Error('Invalid session.');
    await (await getHarness()).select(id);
    await focusWindow().catch(() => {});
  });
  ipcMain.handle('harness:rename', async (event, id: unknown, title: unknown) => {
    assertSender(event);
    if (typeof id !== 'string' || typeof title !== 'string' || !title.trim() || title.trim().length > 120) {
      throw new Error('Choose a session name of up to 120 characters.');
    }
    await (await getHarness()).rename(id, title.trim());
  });
  ipcMain.handle('harness:delete-session', async (event, id: unknown) => {
    assertSender(event);
    if (typeof id !== 'string') throw new Error('Invalid session.');
    await (await getHarness()).deleteSession(id);
  });
  ipcMain.handle('harness:pin-session', async (event, id: unknown, pinned: unknown) => {
    assertSender(event);
    if (typeof id !== 'string' || typeof pinned !== 'boolean') throw new Error('Invalid pin update.');
    await (await getHarness()).pinSession(id, pinned);
  });
  ipcMain.handle('harness:set-permission-mode', async (event, id: unknown, mode: unknown) => {
    assertSender(event);
    if (typeof id !== 'string' || (mode !== 'strict' && mode !== 'workspace-edit' && mode !== 'plan-readonly')) {
      throw new Error('Invalid permission mode.');
    }
    await (await getHarness()).setPermissionMode(id, mode as PermissionMode);
  });
  ipcMain.handle('harness:set-reasoning-effort', async (event, id: unknown, effort: unknown) => {
    assertSender(event);
    if (typeof id !== 'string' || (effort !== null && (typeof effort !== 'string' || !effort.trim() || effort.length > 32))) {
      throw new Error('Invalid reasoning effort.');
    }
    await (await getHarness()).setReasoningEffort(id, effort);
  });
  ipcMain.handle('harness:export-markdown', async (event, id: unknown) => {
    assertSender(event);
    if (typeof id !== 'string') throw new Error('Invalid session.');
    return (await getHarness()).exportMarkdown(id);
  });
  ipcMain.handle('harness:list-integrations', async (event) => {
    assertSender(event);
    return (await getHarness()).listIntegrations();
  });
  ipcMain.handle('harness:withdraw', async (event, id: unknown, index: unknown) => {
    assertSender(event);
    if (typeof id !== 'string' || typeof index !== 'number' || !Number.isSafeInteger(index) || index < 1) {
      throw new Error('Invalid queued follow-up.');
    }
    await (await getHarness()).withdraw(id, index);
  });
  ipcMain.handle('harness:instructions', async (event, id: unknown, text: unknown) => {
    assertSender(event);
    if (typeof id !== 'string' || typeof text !== 'string' || text.length > 4000) {
      throw new Error('Use up to 4,000 characters for session instructions.');
    }
    await (await getHarness()).setInstructions(id, text.trim());
  });
  ipcMain.handle('harness:submit', async (event, sessionId: unknown, text: unknown, requestId: unknown, queue: unknown = false) => {
    assertSender(event);
    if (typeof sessionId !== 'string' || typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 64 * 1024
      || typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/.test(requestId) || typeof queue !== 'boolean') {
      throw new Error('Invalid task input.');
    }
    await (await getHarness()).submit(sessionId, text, requestId, queue);
  });
  ipcMain.handle('harness:decide', async (event, sessionId: unknown, id: unknown, allow: unknown, feedback?: unknown, allowForSession?: unknown, revision?: unknown) => {
    assertSender(event);
    if (typeof sessionId !== 'string' || typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || typeof allow !== 'boolean') {
      throw new Error('Invalid tool decision.');
    }
    if (feedback !== undefined && (allow || typeof feedback !== 'string' || !feedback.trim() || feedback.length > 4000)) {
      throw new Error('A change request needs a note of up to 4,000 characters and declines the current proposal.');
    }
    if (allowForSession !== undefined && (typeof allowForSession !== 'boolean' || (allowForSession && !allow))) {
      throw new Error('Session allowlist applies only to allowed actions.');
    }
    if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) {
      throw new Error('Decision revision is required to prevent stale approvals.');
    }
    await (await getHarness()).decide(sessionId, id, allow, feedback?.trim(), allowForSession === true, revision);
  });
  ipcMain.handle('harness:list-snapshots', async (event, sessionId: unknown) => {
    assertSender(event);
    if (typeof sessionId !== 'string') throw new Error('Invalid session.');
    return (await getHarness()).listSnapshots(sessionId);
  });
  ipcMain.handle('harness:restore-snapshot', async (event, sessionId: unknown, snapshotId: unknown) => {
    assertSender(event);
    if (typeof sessionId !== 'string' || typeof snapshotId !== 'string' || !snapshotId.trim()) {
      throw new Error('Invalid snapshot restore request.');
    }
    return (await getHarness()).restoreSnapshot(sessionId, snapshotId);
  });
  ipcMain.handle('harness:review-model', async (event, sessionId: unknown, confirmation: unknown, configRef: unknown) => {
    assertSender(event);
    if (typeof sessionId !== 'string' || (confirmation !== undefined && (typeof confirmation !== 'string' || !/^[a-f0-9]{64}$/.test(confirmation)))) {
      throw new Error('Invalid session model selection.');
    }
    if (configRef !== undefined && (typeof configRef !== 'string' || !/^(main|[0-9a-f]{32})$/.test(configRef))) {
      throw new Error('Invalid configuration reference.');
    }
    return (await getHarness()).reviewModel(sessionId, confirmation, configRef);
  });
  ipcMain.handle('harness:stop', async (event, sessionId: unknown) => {
    assertSender(event);
    if (typeof sessionId !== 'string') throw new Error('Invalid session.');
    await (await getHarness()).stop(sessionId);
  });
  ipcMain.handle('harness:resume', async (event, sessionId: unknown) => {
    assertSender(event);
    if (typeof sessionId !== 'string') throw new Error('Invalid session.');
    await (await getHarness()).resume(sessionId);
  });

  const start = async (): Promise<void> => {
    if (closed || lifetime.signal.aborted) return;
    if (input.engineWorkerPath && existsSync(input.engineWorkerPath)) {
      try {
        const forked = utilityProcess.fork(input.engineWorkerPath, [], { serviceName: 'nimi-harness-engine' });
        engineWorker = new EngineWorkerHostClient(forked);
        void engineWorker.request({ kind: 'ping' }).catch(() => {});
      } catch (error) {
        reportError(error);
      }
    }
    void serveSessions(services.integration, getHarness, lifetime.signal).catch((error) => {
      if (!lifetime.signal.aborted) reportError(error);
    });
    void (async () => {
      try {
        const deviceId = await resolvePersistentDeviceId(services.storage, lifetime.signal);
        if (lifetime.signal.aborted) return;
        const client = new HarnessBodySymbiosisClient({
          deviceId,
          client: services.agentSession,
          handlers: {
            onPurgeSession: async (workSessionRef) => {
              await (await getHarness()).handleBodyPurgeSession(workSessionRef);
              notifyViewChanged();
            },
            onPurgeAgent: async (agentBinding) => {
              await (await getHarness()).handleBodyPurgeAgent(agentBinding);
              notifyViewChanged();
            },
            onInvalidateMemory: async (workSessionRef) => {
              await (await getHarness()).handleBodyInvalidateMemory(workSessionRef);
              notifyViewChanged();
            },
            onNewIntent: async (env) => {
              await (await getHarness()).handleBodyNewIntent(env);
              notifyViewChanged();
            },
            onReconcileAfterTombstones: async () => (await getHarness()).listBodyProjectionsForReconcile(),
            onLeaseLost: () => {
              notifyViewChanged();
            },
          },
        });
        symbiosis = client;
        if (harnessPromise) {
          const opened = await harnessPromise.catch(() => undefined);
          opened?.attachSymbiosis(client);
        }
        await client.start(lifetime.signal);
      } catch (error) {
        if (!lifetime.signal.aborted) reportError(error);
      }
    })();
  };

  const focusWorkSession = async (workSessionRef: string): Promise<void> => {
    const trimmed = workSessionRef.trim();
    if (!trimmed || closed || lifetime.signal.aborted) return;
    const opened = await getHarness();
    const matched = await opened.selectByWorkSessionRef(trimmed).catch(() => false);
    if (matched) notifyViewChanged();
    notifyFocusSession(trimmed);
  };

  const shutdown = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    lifetime.abort();
    for (const channel of HARNESS_CHANNELS) {
      ipcMain.removeHandler(channel);
    }
    const prevSymbiosis = symbiosis;
    const prevHarness = harnessPromise;
    symbiosis = undefined;
    harnessPromise = undefined;
    await prevSymbiosis?.stop().catch(() => undefined);
    const opened = await prevHarness?.catch(() => undefined);
    await opened?.close().catch(() => undefined);
    engineWorker?.close();
    engineWorker = undefined;
  };

  return Object.freeze({ start, focusWorkSession, shutdown });
}
