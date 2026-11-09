import type { AgentCenterHostMechanics, AgentCenterHostResourcePackSelection } from './types.js';

/** Browser file selection only. The Manager and target renderer still validate
 * the archive, own preview, and commit through the current agent.configure client. */
// @nimi-authority: rule.nimi.platform.ui-design-system.agent-center-browser-picker
export function createAgentCenterBrowserHostMechanics(options: {
  readonly maxResourcePackBytes: number;
  readonly document?: Document;
}): AgentCenterHostMechanics {
  if (!Number.isSafeInteger(options.maxResourcePackBytes) || options.maxResourcePackBytes < 1) {
    throw new Error('A finite Resource Pack file limit is required.');
  }
  return Object.freeze({
    async selectResourcePack(): Promise<AgentCenterHostResourcePackSelection | null> {
      const file = await chooseResourcePack(options.document ?? document);
      if (!file) return null;
      if (!file.size || file.size > options.maxResourcePackBytes) throw new Error('Resource Pack file exceeds the target size limit.');
      const content = new Uint8Array(await file.arrayBuffer());
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', content));
      return { role: 'resource-pack', mediaType: 'application/vnd.nimi.resource-pack+zip',
        fileName: file.name, content, sha256: Array.from(digest, value => value.toString(16).padStart(2, '0')).join('') };
    },
  });
}

function chooseResourcePack(document: Document): Promise<File | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.nimipack'; input.hidden = true;
    const cleanup = () => { input.removeEventListener('change', change); input.removeEventListener('cancel', cancel); input.remove(); };
    const change = () => { const file = input.files?.[0] ?? null; cleanup(); resolve(file); };
    const cancel = () => { cleanup(); resolve(null); };
    input.addEventListener('change', change, { once: true }); input.addEventListener('cancel', cancel, { once: true });
    document.body.append(input);
    try { input.click(); } catch (error) { cleanup(); reject(error); }
  });
}
