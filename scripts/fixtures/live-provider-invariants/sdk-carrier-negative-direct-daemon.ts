export async function runLegacyLivePath(): Promise<void> {
  await withRuntimeDaemon({ run: async () => undefined });
}
