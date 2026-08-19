import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NimiRuntimeLocalTransferProgressEvent } from '@nimiplatform/sdk/runtime';
import { emitRuntimeLog } from '@nimiplatform/kit/telemetry';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service';
import {
  partitionTransferSessionsByDisplayState,
  type ProgressSessionState,
  toProgressEventFromSummary,
  parseTimestamp,
  pruneProgressSessions,
} from './runtime-config-model-center-utils';
import { useLocalModelCenterProgressCache } from './runtime-config-local-model-center-progress-context.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

type UseLocalModelCenterDownloadsInput = {
  onProgressSettled?: (event: NimiRuntimeLocalTransferProgressEvent) => void;
};

export function useLocalModelCenterDownloads(input: UseLocalModelCenterDownloadsInput) {
  const localEnvironmentClient = useRuntimeConfigLocalEnvironmentClient();
  const progressCache = useLocalModelCenterProgressCache();
  const bindings = useDesktopRendererBindings();
  const initialProgressBySessionIdRef = useRef<Record<string, ProgressSessionState> | null>(null);
  if (initialProgressBySessionIdRef.current === null) {
    initialProgressBySessionIdRef.current = progressCache.getProgressSessions();
  }
  const [progressBySessionId, setProgressBySessionId] = useState<Record<string, ProgressSessionState>>(
    () => initialProgressBySessionIdRef.current ?? {},
  );
  const progressBySessionIdRef = useRef<Record<string, ProgressSessionState>>(initialProgressBySessionIdRef.current ?? {});
  const dismissedSessionIdsRef = useRef<Set<string>>(progressCache.getDismissedSessionIds());
  // Sessions already observed in a terminal (done) state. WatchLocalTransfers
  // replays every existing session on each subscribe, so terminal sessions
  // arrive with done=true again and again; without this guard each replay would
  // re-run terminal refresh work. Seed from cached terminal sessions only;
  // listTransfers may race with a just-completed active
  // transfer, so it may only mark terminals whose updatedAt predates this
  // effect's subscription window.
  const seenTerminalSessionIdsRef = useRef<Set<string>>(new Set(
    Object.values(initialProgressBySessionIdRef.current ?? {})
      .filter((session) => session.event.done)
      .map((session) => session.event.installSessionId),
  ));
  // Read the completion handlers via refs so the watch effect below does not
  // have to list them as dependencies. If it did, their identity churn (they
  // are recreated whenever runtime-config state updates) would tear down and
  // re-subscribe the transfer stream on every render.
  const onProgressSettledRef = useRef(input.onProgressSettled);
  onProgressSettledRef.current = input.onProgressSettled;

  useEffect(() => {
    progressBySessionIdRef.current = progressBySessionId;
  }, [progressBySessionId]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    const effectStartedMs = bindings.clock.now();

    void localEnvironmentClient.listTransfers()
      .then((sessions) => {
        if (disposed) {
          return;
        }
        const nowMs = bindings.clock.now();
        setProgressBySessionId((prev) => {
          const next = pruneProgressSessions(prev, nowMs);
          const merged: Record<string, ProgressSessionState> = { ...next };
          for (const session of sessions) {
            if (dismissedSessionIdsRef.current.has(session.installSessionId)) {
              continue;
            }
            const sessionEvent = toProgressEventFromSummary(session);
            const updatedAtMs = parseTimestamp(session.updatedAt);
            if (sessionEvent.done && updatedAtMs > 0 && updatedAtMs < effectStartedMs) {
              seenTerminalSessionIdsRef.current.add(session.installSessionId);
            }
            const previous = next[session.installSessionId];
            merged[session.installSessionId] = {
              event: sessionEvent,
              updatedAtMs: updatedAtMs || nowMs,
              createdAtMs: previous?.createdAtMs || parseTimestamp(session.createdAt) || nowMs,
            };
          }
          return progressCache.cacheProgressSessions(merged);
        });
      })
      .catch((err) => {
        emitRuntimeLog({
          level: 'warn',
          area: 'local-ai',
          message: 'action:listTransfers:failed',
          details: { error: err instanceof Error ? err.message : String(err) },
        });
      });

    void localEnvironmentClient.watchTransferProgress((event) => {
      if (disposed) {
        return;
      }
      if (dismissedSessionIdsRef.current.has(event.installSessionId)) {
        return;
      }
      const nowMs = bindings.clock.now();
      setProgressBySessionId((prev) => {
        const next = pruneProgressSessions(prev, nowMs);
        const previous = next[event.installSessionId];
        return progressCache.cacheProgressSessions({
          ...next,
          [event.installSessionId]: {
            event,
            updatedAtMs: nowMs,
            createdAtMs: previous?.createdAtMs || nowMs,
          },
        });
      });
      if (event.done && !seenTerminalSessionIdsRef.current.has(event.installSessionId)) {
        seenTerminalSessionIdsRef.current.add(event.installSessionId);
        onProgressSettledRef.current?.(event);
      }
    }).then((off) => {
      if (disposed) {
        off();
        return;
      }
      unsubscribe = off;
    });

    return () => {
      disposed = true;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  const mergeSessionSummary = useCallback((
    installSessionId: string,
    updater: () => Promise<ReturnType<typeof toProgressEventFromSummary>>,
  ) => {
    void updater()
      .then((event) => {
        const nowMs = bindings.clock.now();
        setProgressBySessionId((prev) => progressCache.cacheProgressSessions({
          ...pruneProgressSessions(prev, nowMs),
          [installSessionId]: {
            event,
            updatedAtMs: nowMs,
            createdAtMs: prev[installSessionId]?.createdAtMs || nowMs,
          },
        }));
      })
      .catch((err) => {
        emitRuntimeLog({
          level: 'warn',
          area: 'local-ai',
          message: 'action:mergeSessionSummary:failed',
          details: { installSessionId, error: err instanceof Error ? err.message : String(err) },
        });
      });
  }, []);

  const onPauseDownload = useCallback((installSessionId: string) => {
    mergeSessionSummary(
      installSessionId,
      async () => toProgressEventFromSummary(await localEnvironmentClient.pauseTransfer(installSessionId, { caller: 'core' })),
    );
  }, [mergeSessionSummary]);

  const onResumeDownload = useCallback((installSessionId: string) => {
    mergeSessionSummary(
      installSessionId,
      async () => toProgressEventFromSummary(await localEnvironmentClient.resumeTransfer(installSessionId, { caller: 'core' })),
    );
  }, [mergeSessionSummary]);

  const onCancelDownload = useCallback((installSessionId: string) => {
    mergeSessionSummary(
      installSessionId,
      async () => toProgressEventFromSummary(await localEnvironmentClient.cancelTransfer(installSessionId, { caller: 'core' })),
    );
  }, [mergeSessionSummary]);

  const onDismissSession = useCallback((installSessionId: string) => {
    progressCache.addDismissedSessionId(installSessionId);
    dismissedSessionIdsRef.current.add(installSessionId);
    setProgressBySessionId((prev) => {
      const next = { ...prev };
      delete next[installSessionId];
      progressCache.cacheProgressSessions(next);
      return next;
    });
    progressBySessionIdRef.current = { ...progressBySessionIdRef.current };
    delete progressBySessionIdRef.current[installSessionId];
  }, []);

  const activeDownloads = useMemo(
    () => partitionTransferSessionsByDisplayState(progressBySessionId, 'download').active,
    [progressBySessionId],
  );

  const terminalDownloads = useMemo(
    () => partitionTransferSessionsByDisplayState(progressBySessionId, 'download').terminal,
    [progressBySessionId],
  );

  const activeImports = useMemo(
    () => partitionTransferSessionsByDisplayState(progressBySessionId, 'import').active,
    [progressBySessionId],
  );

  const terminalImports = useMemo(
    () => partitionTransferSessionsByDisplayState(progressBySessionId, 'import').terminal,
    [progressBySessionId],
  );

  const getLatestProgressEvent = useCallback((installSessionId: string) => (
    progressBySessionIdRef.current[installSessionId]?.event
  ), []);

  return {
    activeDownloads,
    activeImports,
    terminalDownloads,
    terminalImports,
    getLatestProgressEvent,
    onPauseDownload,
    onResumeDownload,
    onCancelDownload,
    onDismissSession,
  };
}
