import { useEffect, useState } from 'react';
import { bootstrapAvatar, type BootstrapHandle } from './app-shell/app-bootstrap.js';
import { useAvatarStore } from './app-shell/app-store.js';
import { startWindowDrag } from './app-shell/tauri-commands.js';
import { isTauriRuntime } from './app-shell/tauri-lifecycle.js';

export function App() {
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const bundle = useAvatarStore((s) => s.bundle);
  const shell = useAvatarStore((s) => s.shell);
  const driver = useAvatarStore((s) => s.driver);
  const scenario = useAvatarStore((s) => s.scenario);

  useEffect(() => {
    let handle: BootstrapHandle | null = null;
    bootstrapAvatar()
      .then((h) => {
        handle = h;
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setBootstrapError(message);
      });
    return () => {
      void handle?.shutdown();
    };
  }, []);

  if (bootstrapError) {
    return (
      <div className="avatar-root">
        <div className="avatar-placeholder avatar-placeholder--error">
          <span className="avatar-placeholder-label">启动失败</span>
          <span className="avatar-placeholder-hint">{bootstrapError}</span>
        </div>
      </div>
    );
  }

  const activityName = bundle?.activity?.name ?? '—';
  const postureFamily = bundle?.posture.action_family ?? '—';

  return (
    <div className="avatar-root">
      <div
        className="avatar-placeholder"
        onPointerDown={(event) => {
          if (isTauriRuntime() && event.button === 0) {
            void startWindowDrag();
          }
        }}
      >
        <span className="avatar-placeholder-label">Nimi Avatar</span>
        <span className="avatar-placeholder-hint">
          shell: {shell.shellReady ? 'ready' : 'booting'} · driver: {driver.status} · scenario: {scenario.scenarioId ?? '—'}
        </span>
        <span className="avatar-placeholder-hint">
          activity: {activityName} · posture: {postureFamily}
        </span>
      </div>
    </div>
  );
}
