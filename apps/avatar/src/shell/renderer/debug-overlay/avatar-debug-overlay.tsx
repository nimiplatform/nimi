import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCcw, SearchCheck, X } from 'lucide-react';
import { AvatarDebugProbeKind, AvatarDebugProbeStatus } from '@nimiplatform/sdk/runtime/wire-types';
import { useTranslation } from '../i18n/index.js';
import type { BootstrapHandle } from '../app-shell/app-bootstrap.js';

export type AvatarDebugOverlayDismissReason =
  | 'close'
  | 'outside_click'
  | 'escape'
  | 'composition_change';

export type AvatarDebugOverlayProps = {
  x: number;
  y: number;
  agentId: string;
  conversationAnchorId: string;
  avatarInstanceId: string | null;
  avatarDebug: NonNullable<BootstrapHandle['avatarDebug']>;
  onRequestFailed(input: {
    probeKind: AvatarDebugProbeKind;
    reasonCode: string;
    error: string;
  }): void;
  onDismiss(reason: AvatarDebugOverlayDismissReason): void;
};

type AvatarDebugSnapshot = Awaited<ReturnType<AvatarDebugOverlayProps['avatarDebug']['snapshot']>>;
type AvatarDebugProbeResult = AvatarDebugSnapshot['probeResults'][number];
type AvatarDebugReplayRef = AvatarDebugSnapshot['replayRefs'][number];

const OVERLAY_WIDTH_PX = 420;
const OVERLAY_ESTIMATED_HEIGHT_PX = 360;
const VIEWPORT_PADDING_PX = 8;
const AVATAR_DEBUG_RPC_TIMEOUT_MS = 10_000;

const AVATAR_BACKEND_PROBES = [
  AvatarDebugProbeKind.BACKEND_LOAD,
  AvatarDebugProbeKind.CAPABILITY_PROFILE,
  AvatarDebugProbeKind.ROUTE_SUPPORT_MATRIX,
  AvatarDebugProbeKind.GENERATED_MOTION,
  AvatarDebugProbeKind.EMOTION_EXPRESSION,
  AvatarDebugProbeKind.SPEECH_LIPSYNC,
  AvatarDebugProbeKind.WINDOW_HIT_REGION,
] as const;

function clampPosition(value: number, size: number, viewport: number): number {
  if (!Number.isFinite(value)) return VIEWPORT_PADDING_PX;
  const max = Math.max(VIEWPORT_PADDING_PX, viewport - size - VIEWPORT_PADDING_PX);
  return Math.max(VIEWPORT_PADDING_PX, Math.min(value, max));
}

function readViewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') {
    return { width: 480, height: 600 };
  }
  return {
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight),
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown avatar debug failure');
}

function isTimeoutError(error: unknown): boolean {
  return /deadline|timed out|timeout/i.test(toErrorMessage(error));
}

function probeKey(probeKind: AvatarDebugProbeKind): string {
  switch (probeKind) {
    case AvatarDebugProbeKind.BACKEND_LOAD:
      return 'backend_load';
    case AvatarDebugProbeKind.CAPABILITY_PROFILE:
      return 'capability_profile';
    case AvatarDebugProbeKind.ROUTE_SUPPORT_MATRIX:
      return 'route_support_matrix';
    case AvatarDebugProbeKind.GENERATED_MOTION:
      return 'generated_motion';
    case AvatarDebugProbeKind.EMOTION_EXPRESSION:
      return 'emotion_expression';
    case AvatarDebugProbeKind.SPEECH_LIPSYNC:
      return 'speech_lipsync';
    case AvatarDebugProbeKind.WINDOW_HIT_REGION:
      return 'window_hit_region';
    default:
      return 'unknown';
  }
}

function statusKey(status: AvatarDebugProbeStatus): string {
  switch (status) {
    case AvatarDebugProbeStatus.PASSED:
      return 'passed';
    case AvatarDebugProbeStatus.FAILED:
      return 'failed';
    case AvatarDebugProbeStatus.UNSUPPORTED:
      return 'unsupported';
    case AvatarDebugProbeStatus.BLOCKED:
      return 'blocked';
    case AvatarDebugProbeStatus.INVALID:
      return 'invalid';
    default:
      return 'unknown';
  }
}

function latestByProbeKind(results: readonly AvatarDebugProbeResult[]): Map<AvatarDebugProbeKind, AvatarDebugProbeResult> {
  const map = new Map<AvatarDebugProbeKind, AvatarDebugProbeResult>();
  for (const result of results) {
    map.set(result.probeKind, result);
  }
  return map;
}

function replayByProbeId(replays: readonly AvatarDebugReplayRef[]): Map<string, AvatarDebugReplayRef> {
  const map = new Map<string, AvatarDebugReplayRef>();
  for (const replay of replays) {
    if (replay.probeId) {
      map.set(replay.probeId, replay);
    }
  }
  return map;
}

export function AvatarDebugOverlay(props: AvatarDebugOverlayProps) {
  const {
    x,
    y,
    agentId,
    conversationAnchorId,
    avatarInstanceId,
    avatarDebug,
    onRequestFailed,
    onDismiss,
  } = props;
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const operationAbortRef = useRef<AbortController | null>(null);
  const [snapshot, setSnapshot] = useState<AvatarDebugSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const position = useMemo(() => {
    const viewport = readViewportSize();
    return {
      left: clampPosition(x, OVERLAY_WIDTH_PX, viewport.width),
      top: clampPosition(y, OVERLAY_ESTIMATED_HEIGHT_PX, viewport.height),
    };
  }, [x, y]);

  const loadSnapshot = useCallback(async () => {
    operationAbortRef.current?.abort();
    const controller = new AbortController();
    operationAbortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await avatarDebug.snapshot(
        { agentId, conversationAnchorId },
        { signal: controller.signal, timeoutMs: AVATAR_DEBUG_RPC_TIMEOUT_MS },
      ));
    } catch (loadError) {
      setError(controller.signal.aborted
        ? t('Avatar.debug.request_canceled')
        : isTimeoutError(loadError)
          ? t('Avatar.debug.request_timeout')
          : toErrorMessage(loadError));
    } finally {
      if (operationAbortRef.current === controller) operationAbortRef.current = null;
      setLoading(false);
    }
  }, [agentId, avatarDebug, conversationAnchorId, t]);

  const requestProbes = useCallback(async () => {
    operationAbortRef.current?.abort();
    const controller = new AbortController();
    operationAbortRef.current = controller;
    setRequesting(true);
    setError(null);
    try {
      for (const probeKind of AVATAR_BACKEND_PROBES) {
        try {
          await avatarDebug.requestProbe({
            agentId,
            conversationAnchorId,
            probeKind,
            avatarInstanceId,
          }, { signal: controller.signal, timeoutMs: AVATAR_DEBUG_RPC_TIMEOUT_MS });
        } catch (requestError) {
          if (controller.signal.aborted) {
            setError(t('Avatar.debug.request_canceled'));
            break;
          }
          const message = toErrorMessage(requestError);
          onRequestFailed({
            probeKind,
            reasonCode: isTimeoutError(requestError)
              ? 'runtime_avatar_debug_request_timeout'
              : 'runtime_avatar_debug_request_rejected',
            error: message,
          });
          setError(isTimeoutError(requestError) ? t('Avatar.debug.request_timeout') : message);
          if (isTimeoutError(requestError)) break;
        }
      }
      if (!controller.signal.aborted) {
        setSnapshot(await avatarDebug.snapshot(
          { agentId, conversationAnchorId },
          { signal: controller.signal, timeoutMs: AVATAR_DEBUG_RPC_TIMEOUT_MS },
        ));
      }
    } catch (requestError) {
      setError(controller.signal.aborted
        ? t('Avatar.debug.request_canceled')
        : isTimeoutError(requestError)
          ? t('Avatar.debug.request_timeout')
          : toErrorMessage(requestError));
    } finally {
      if (operationAbortRef.current === controller) operationAbortRef.current = null;
      setRequesting(false);
    }
  }, [agentId, avatarDebug, avatarInstanceId, conversationAnchorId, onRequestFailed, t]);

  const cancelRequest = useCallback(() => {
    operationAbortRef.current?.abort(new DOMException('Avatar diagnostics canceled by user', 'AbortError'));
    setError(t('Avatar.debug.request_canceled'));
  }, [t]);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    void loadSnapshot();
    return () => {
      operationAbortRef.current?.abort();
      operationAbortRef.current = null;
    };
  }, [loadSnapshot]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      const root = rootRef.current;
      if (!root || !(event.target instanceof Node) || root.contains(event.target)) return;
      onDismiss('outside_click');
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onDismiss('escape');
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [onDismiss]);

  const resultByProbe = useMemo(
    () => latestByProbeKind(snapshot?.probeResults ?? []),
    [snapshot?.probeResults],
  );
  const replayByProbe = useMemo(
    () => replayByProbeId(snapshot?.replayRefs ?? []),
    [snapshot?.replayRefs],
  );
  const hasResults = (snapshot?.probeResults.length ?? 0) > 0;

  return (
    <div
      ref={rootRef}
      id="avatar-debug-overlay"
      className="avatar-debug-overlay nimi-material-glass-thick"
      style={{ left: position.left, top: position.top }}
      role="dialog"
      aria-label={t('Avatar.debug.popover_aria')}
      tabIndex={-1}
      data-testid="avatar-debug-overlay"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="avatar-debug-overlay__header">
        <span>{t('Avatar.debug.header')}</span>
        <div className="avatar-debug-overlay__header-actions">
          <button
            type="button"
            className="avatar-debug-overlay__icon-button"
            aria-label={t('Avatar.debug.refresh')}
            data-testid="avatar-debug-overlay-refresh"
            disabled={loading || requesting}
            onClick={() => {
              void loadSnapshot();
            }}
          >
            <RefreshCcw size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="avatar-debug-overlay__icon-button"
            aria-label={t('Avatar.debug.close_aria')}
            data-testid="avatar-debug-overlay-close"
            onClick={() => onDismiss('close')}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <button
        type="button"
        className="avatar-debug-overlay__request"
        data-testid="avatar-debug-overlay-request-probes"
        onClick={() => {
          if (requesting) {
            cancelRequest();
          } else {
            void requestProbes();
          }
        }}
      >
        {requesting ? <X size={15} aria-hidden="true" /> : <SearchCheck size={15} aria-hidden="true" />}
        <span>{t(requesting ? 'Avatar.debug.cancel_request' : 'Avatar.debug.request_all')}</span>
      </button>

      {loading ? (
        <p className="avatar-debug-overlay__state">{t('Avatar.debug.loading')}</p>
      ) : null}
      {!loading && error ? (
        <p className="avatar-debug-overlay__error" role="alert">
          {t('Avatar.debug.error_prefix')}: {error}
        </p>
      ) : null}
      {!loading && !error && !hasResults ? (
        <p className="avatar-debug-overlay__state">{t('Avatar.debug.empty')}</p>
      ) : null}

      <div className="avatar-debug-overlay__table" role="table">
        <div className="avatar-debug-overlay__row avatar-debug-overlay__row--head" role="row">
          <span role="columnheader">{t('Avatar.debug.columns.probe')}</span>
          <span role="columnheader">{t('Avatar.debug.columns.status')}</span>
          <span role="columnheader">{t('Avatar.debug.columns.evidence')}</span>
          <span role="columnheader">{t('Avatar.debug.columns.replay')}</span>
        </div>
        {AVATAR_BACKEND_PROBES.map((probeKind) => {
          const result = resultByProbe.get(probeKind) ?? null;
          const replay = result?.probeId ? replayByProbe.get(result.probeId) ?? null : null;
          const status = result ? statusKey(result.status) : 'unknown';
          return (
            <div
              key={probeKind}
              className={`avatar-debug-overlay__row avatar-debug-overlay__row--${status}`}
              role="row"
              data-testid={`avatar-debug-overlay-probe-${probeKey(probeKind)}`}
            >
              <span role="cell">{t(`Avatar.debug.probe.${probeKey(probeKind)}`)}</span>
              <span role="cell">{t(`Avatar.debug.status.${status}`)}</span>
              <span role="cell">
                {t('Avatar.debug.evidence_count', { count: result?.evidenceRefs.length ?? 0 })}
              </span>
              <span role="cell">
                {replay?.replayRef?.trim() ? replay.replayRef : t('Avatar.debug.no_replay')}
              </span>
              {result?.reasonCode ? (
                <span className="avatar-debug-overlay__reason" role="cell">
                  {result.reasonCode}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
