export async function runRuntimeConfigAsyncGuard(
  active: boolean,
  setActive: (next: boolean) => void,
  task: () => Promise<void>,
) {
  if (active) return;
  setActive(true);
  try {
    await task();
  } finally {
    setActive(false);
  }
}
