export async function issueLegacyGrant(runtime: any): Promise<void> {
  await runtime.grants.authorizeExternalPrincipal({});
}
