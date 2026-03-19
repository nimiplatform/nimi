import { describe, it, expect, vi } from 'vitest';

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({ realm: { services: {} } }),
}));

const tdc = await import('./template-data-client.js');

describe('template-data-client', () => {
  const message = 'Template marketplace is deferred in the current Forge scope';

  it('createTemplate throws', async () => {
    await expect(tdc.createTemplate({})).rejects.toThrow(message);
  });

  it('browseTemplates throws', async () => {
    await expect(tdc.browseTemplates()).rejects.toThrow(message);
  });

  it('listMyTemplates throws', async () => {
    await expect(tdc.listMyTemplates()).rejects.toThrow(message);
  });

  it('getTemplate throws', async () => {
    await expect(tdc.getTemplate('t1')).rejects.toThrow(message);
  });

  it('updateTemplate throws', async () => {
    await expect(tdc.updateTemplate('t1', {})).rejects.toThrow(message);
  });

  it('archiveTemplate throws', async () => {
    await expect(tdc.archiveTemplate('t1')).rejects.toThrow(message);
  });

  it('forkTemplate throws', async () => {
    await expect(tdc.forkTemplate('t1')).rejects.toThrow(message);
  });

  it('rateTemplate throws', async () => {
    await expect(tdc.rateTemplate('t1', { rating: 5 })).rejects.toThrow(message);
  });
});
