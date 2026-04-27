import { invoke } from '@tauri-apps/api/core';

function toErrorDetail(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack || null,
    };
  }
  return {
    name: 'UnknownError',
    message: String(error),
    stack: null,
  };
}

function recordEarlyEvidence(kind: 'avatar.renderer.entry-loaded' | 'avatar.renderer.failed', detail: Record<string, unknown>): void {
  void invoke('nimi_avatar_record_evidence', {
    payload: {
      kind,
      recordedAt: new Date().toISOString(),
      detail,
      consume: {},
      model: {},
    },
  }).catch(() => {});
}

recordEarlyEvidence('avatar.renderer.entry-loaded', {
  source: 'avatar-renderer',
  phase: 'pre-react-module',
});

window.addEventListener('error', (event) => {
  recordEarlyEvidence('avatar.renderer.failed', {
    source: 'avatar-renderer',
    phase: 'window-error',
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: toErrorDetail(event.error),
  });
});

window.addEventListener('unhandledrejection', (event) => {
  recordEarlyEvidence('avatar.renderer.failed', {
    source: 'avatar-renderer',
    phase: 'unhandled-rejection',
    reason: toErrorDetail(event.reason),
  });
});
