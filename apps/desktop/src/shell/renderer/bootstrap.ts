import { ensureNimiShellRuntimeBridgeInstalled } from '@nimiplatform/kit/shell/renderer/bootstrap';

async function startRenderer(): Promise<void> {
  await ensureNimiShellRuntimeBridgeInstalled({
    setTimeout: window.setTimeout.bind(window),
  });
  await import('./main.js');
}

void startRenderer().catch((error) => {
  const root = document.getElementById('root');
  if (root) {
    root.setAttribute('role', 'alert');
    root.textContent = error instanceof Error
      ? error.message
      : 'Desktop renderer bootstrap failed';
  }
});
