import { describe, it, expect, vi } from 'vitest';

vi.mock('@runtime/platform-client.js', () => ({
  getPlatformClient: () => ({ realm: { services: {} } }),
}));

const cdc = await import('./copyright-data-client.js');

describe('copyright-data-client', () => {
  const message = 'Copyright feature is deferred in the current Forge scope';

  // ── Registrations ────────────────────────────────────────────

  it('createRegistration throws', async () => {
    await expect(cdc.createRegistration({})).rejects.toThrow(message);
  });

  it('listRegistrations throws', async () => {
    await expect(cdc.listRegistrations()).rejects.toThrow(message);
  });

  it('getRegistration throws', async () => {
    await expect(cdc.getRegistration('r1')).rejects.toThrow(message);
  });

  it('updateRegistration throws', async () => {
    await expect(cdc.updateRegistration('r1', {})).rejects.toThrow(message);
  });

  it('revokeRegistration throws', async () => {
    await expect(cdc.revokeRegistration('r1')).rejects.toThrow(message);
  });

  // ── Licenses ─────────────────────────────────────────────────

  it('createLicense throws', async () => {
    await expect(cdc.createLicense({})).rejects.toThrow(message);
  });

  it('listLicenses throws', async () => {
    await expect(cdc.listLicenses()).rejects.toThrow(message);
  });

  it('updateLicense throws', async () => {
    await expect(cdc.updateLicense('l1', {})).rejects.toThrow(message);
  });

  it('revokeLicense throws', async () => {
    await expect(cdc.revokeLicense('l1')).rejects.toThrow(message);
  });

  // ── Attributions ─────────────────────────────────────────────

  it('listAttributions throws', async () => {
    await expect(cdc.listAttributions()).rejects.toThrow(message);
  });

  it('createAttribution throws', async () => {
    await expect(cdc.createAttribution({})).rejects.toThrow(message);
  });

  it('updateAttribution throws', async () => {
    await expect(cdc.updateAttribution('a1', {})).rejects.toThrow(message);
  });

  // ── Infringements ────────────────────────────────────────────

  it('submitInfringementReport throws', async () => {
    await expect(cdc.submitInfringementReport({})).rejects.toThrow(message);
  });

  it('listInfringementReports throws', async () => {
    await expect(cdc.listInfringementReports()).rejects.toThrow(message);
  });

  it('getInfringementReport throws', async () => {
    await expect(cdc.getInfringementReport('ir1')).rejects.toThrow(message);
  });
});
