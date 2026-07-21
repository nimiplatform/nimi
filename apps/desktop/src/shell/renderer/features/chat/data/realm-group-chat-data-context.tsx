import { createContext, useContext, type PropsWithChildren } from 'react';
import type { RealmGroupChatData } from './realm-group-chat-data.js';

const RealmGroupChatDataContext = createContext<RealmGroupChatData | null>(null);

export function RealmGroupChatDataProvider(
  props: PropsWithChildren<{ readonly resource: RealmGroupChatData }>,
) {
  return (
    <RealmGroupChatDataContext.Provider value={props.resource}>
      {props.children}
    </RealmGroupChatDataContext.Provider>
  );
}

export function useRealmGroupChatData(): RealmGroupChatData {
  const resource = useContext(RealmGroupChatDataContext);
  if (!resource) throw new Error('REALM_GROUP_CHAT_DATA_MISSING');
  return resource;
}
