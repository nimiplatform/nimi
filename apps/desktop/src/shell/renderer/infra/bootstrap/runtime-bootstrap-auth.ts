export async function bootstrapAuthSession(): Promise<void> {
  throw new Error('Desktop shared auth bootstrap is disabled; RuntimeAccountService owns local account truth');
}
