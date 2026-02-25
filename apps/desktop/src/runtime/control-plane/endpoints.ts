export const CONTROL_PLANE_ENDPOINTS = {
  verifyManifest: '/api/creator/mods/control/manifest/verify',
  verifySignature: '/api/creator/mods/control/signature/verify',
  issueGrant: '/api/creator/mods/control/grants/issue',
  validateGrant: '/api/creator/mods/control/grants/validate',
  fetchRevocations: '/api/creator/mods/control/revocations',
  syncAudit: '/api/creator/mods/control/audit/ingest',
} as const;
