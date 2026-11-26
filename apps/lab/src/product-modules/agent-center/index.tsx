import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import {
  AppAgentCenterEntry,
  createAgentCenterShellHostMechanics,
} from '@nimiplatform/kit/features/agent-center';
import {
  createAgentCenterShellBridge,
  hasElectronInvoke,
} from '@nimiplatform/kit/shell/renderer/bridge';

function useDocumentLanguage(explicit?: string): string {
  const [docLang, setDocLang] = useState(() => globalThis.document?.documentElement.lang || 'en');
  useEffect(() => {
    if (explicit) return undefined;
    const root = globalThis.document?.documentElement;
    if (!root || typeof MutationObserver === 'undefined') return undefined;
    const sync = () => setDocLang(root.lang || 'en');
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['lang'] });
    return () => observer.disconnect();
  }, [explicit]);
  return explicit || docLang;
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-019c
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-agid-014a
export function AgentCenterCapability(props: { readonly client: ComponentProps<typeof AppAgentCenterEntry>['client']; readonly language?: string }) {
  const language = useDocumentLanguage(props.language);
  const hostMechanics = useMemo(() => (
    hasElectronInvoke()
      ? createAgentCenterShellHostMechanics(createAgentCenterShellBridge())
      : null
  ), []);
  return (
    <AppAgentCenterEntry
      client={props.client}
      hostMechanics={hostMechanics}
      language={language}
    />
  );
}
