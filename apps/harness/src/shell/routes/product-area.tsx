import { useEffect } from 'react';
import { useNimiAppSession } from '@nimiplatform/kit/auth/app';
import { useNimiNavigationSnapshot } from '@nimiplatform/kit/ui/app-chrome';
import { sessionActivityType } from '../../product/session-activity.js';
import { Conversations } from '../../product/conversations.js';
import { useAppNavigation, type Destination } from './app-navigation.js';

export function ProductArea() {
  const { navigation, sidebarVisible } = useAppNavigation();
  const id = useNimiNavigationSnapshot<Destination>().current.destination.id;
  const { snapshot } = useNimiAppSession();
  const scope = snapshot.runtime.status === 'connected' ? snapshot.runtime.scope : undefined;

  useEffect(() => {
    if (!scope) return;
    let active = true;
    const registration = scope.client.activity.onOpenRequest(async request => {
      if (!active || scope.signal.aborted || request.type !== sessionActivityType || !request.objectRef.startsWith('session:')) return 'object-unavailable';
      const sessionId = request.objectRef.slice('session:'.length);
      const view = await window.nimiHarness.snapshot();
      if (!active || scope.signal.aborted || !view.sessions.some(item => item.id === sessionId)) return 'object-unavailable';
      await window.nimiHarness.select(sessionId);
      if (!active || scope.signal.aborted) return 'object-unavailable';
      const result = await navigation.push({ id: 'conversations' });
      return active && !scope.signal.aborted && (result.status === 'committed' || result.status === 'unchanged') ? 'opened' : 'object-unavailable';
    });
    return () => { active = false; void registration.stop().catch(error => console.error('Activity subscription close failed', error)); };
  }, [navigation, scope]);

  const select = (target: Destination['id']) => { void navigation.push({ id: target }); };

  return (
    <Conversations
      sidebarVisible={sidebarVisible}
      activeDestination={id}
      openModels={() => select('models')}
      openConversations={() => select('conversations')}
    />
  );
}
