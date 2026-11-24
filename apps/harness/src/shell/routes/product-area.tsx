import { useNimiNavigationSnapshot } from '@nimiplatform/kit/ui/app-chrome';
import { Conversations } from '../../product/conversations.js';
import { useAppNavigation, type Destination } from './app-navigation.js';

export function ProductArea() {
  const { navigation, sidebarVisible } = useAppNavigation();
  const id = useNimiNavigationSnapshot<Destination>().current.destination.id;

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
