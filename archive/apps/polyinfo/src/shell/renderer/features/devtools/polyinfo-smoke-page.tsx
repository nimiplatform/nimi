import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import {
  hasTauriInvoke,
  invoke,
} from '@renderer/bridge';
import {
  runPolyinfoAppSmoke,
  type PolyinfoSmokeCheck,
  type PolyinfoSmokeSnapshot,
} from './polyinfo-smoke.js';

function statusClass(status: PolyinfoSmokeCheck['status']): string {
  if (status === 'pass') {
    return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100';
  }
  if (status === 'warn') {
    return 'border-amber-400/20 bg-amber-400/10 text-amber-100';
  }
  return 'border-rose-400/20 bg-rose-400/10 text-rose-100';
}

function statusText(status: PolyinfoSmokeCheck['status']): string {
  if (status === 'pass') {
    return 'PASS';
  }
  if (status === 'warn') {
    return 'WARN';
  }
  return 'FAIL';
}

let lastLoggedSmoke: { signature: string; loggedAt: number } | null = null;
const SMOKE_LOG_DEDUPE_MS = 1000;

function shouldLogSmokeSnapshot(snapshot: PolyinfoSmokeSnapshot, now = Date.now()): boolean {
  const signature = JSON.stringify({
    status: snapshot.status,
    checks: snapshot.checks,
  });
  if (
    lastLoggedSmoke
    && lastLoggedSmoke.signature === signature
    && now - lastLoggedSmoke.loggedAt < SMOKE_LOG_DEDUPE_MS
  ) {
    return false;
  }
  lastLoggedSmoke = {
    signature,
    loggedAt: now,
  };
  return true;
}

export function PolyinfoSmokePage() {
  const aiConfig = useAppStore((state) => state.aiConfig);
  const runtimeDefaults = useAppStore((state) => state.runtimeDefaults);
  const authStatus = useAppStore((state) => state.auth.status);
  const [snapshot, setSnapshot] = useState<PolyinfoSmokeSnapshot | null>(null);
  const [running, setRunning] = useState(false);

  const runSmoke = useCallback(async () => {
    setRunning(true);
    try {
      setSnapshot(await runPolyinfoAppSmoke({
        aiConfig,
        runtimeDefaults,
        authStatus,
      }));
    } finally {
      setRunning(false);
    }
  }, [aiConfig, authStatus, runtimeDefaults]);

  useEffect(() => {
    void runSmoke();
  }, [runSmoke]);

  useEffect(() => {
    if (!snapshot || !hasTauriInvoke()) {
      return;
    }
    if (!shouldLogSmokeSnapshot(snapshot)) {
      return;
    }
    void invoke('log_renderer_event', {
      payload: {
        level: snapshot.status === 'pass' ? 'info' : 'error',
        area: 'polyinfo.smoke',
        message: `polyinfo smoke ${snapshot.status}`,
        details: {
          completedAt: snapshot.completedAt,
          status: snapshot.status,
          checks: snapshot.checks,
        },
      },
    }).catch(() => {
      // Diagnostics should not block the page itself.
    });
  }, [snapshot]);

  return (
    <div className="space-y-4" data-testid="polyinfo-smoke-page">
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Polyinfo Smoke</p>
            <h1 className="mt-2 text-2xl font-semibold text-white">App 验收入口</h1>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/runtime"
              className="rounded-md border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-200 hover:bg-white/[0.08]"
            >
              Runtime
            </Link>
            <button
              type="button"
              disabled={running}
              onClick={() => void runSmoke()}
              className="rounded-md bg-teal-300 px-4 py-3 text-sm font-medium text-slate-950 disabled:opacity-50"
            >
              {running ? '检查中…' : '重新检查'}
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <span
            data-testid="polyinfo-smoke-status"
            className={`rounded-md border px-4 py-3 text-sm font-semibold ${statusClass(snapshot?.status ?? 'warn')}`}
          >
            {snapshot ? statusText(snapshot.status) : 'RUNNING'}
          </span>
          <span className="text-sm text-slate-400" data-testid="polyinfo-smoke-completed-at">
            {snapshot?.completedAt ?? '等待结果'}
          </span>
        </div>
      </section>

      <section className="grid gap-3">
        {(snapshot?.checks ?? []).map((check) => (
          <div
            key={check.id}
            data-testid={`polyinfo-smoke-check-${check.id}`}
            className={`rounded-xl border p-4 ${statusClass(check.status)}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">{check.title}</h2>
              <span className="rounded-md bg-black/15 px-2.5 py-1 text-xs font-semibold">
                {statusText(check.status)}
              </span>
            </div>
            <p className="mt-3 break-words text-sm leading-6">{check.detail}</p>
          </div>
        ))}
      </section>

      {snapshot ? (
        <pre
          data-testid="polyinfo-smoke-json"
          className="max-h-72 overflow-auto rounded-xl border border-white/10 bg-slate-950/80 p-4 text-xs leading-5 text-slate-300"
        >
          {JSON.stringify(snapshot, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
