import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import {
  AppConversationEntry,
  createBrowserAppConversationHostPort,
} from '@nimiplatform/kit/features/chat';

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
// @nimi-authority: rule.nimi.runtime.agent-participation.r093
export function AgentConversationCapability(props: { readonly client: ComponentProps<typeof AppConversationEntry>['client']; readonly language?: string }) {
  const language = useDocumentLanguage(props.language);
  const hostPort = useMemo(() => createBrowserAppConversationHostPort(), []);
  return (
    <AppConversationEntry
      client={props.client}
      hostPort={hostPort}
      language={language}
    />
  );
}
