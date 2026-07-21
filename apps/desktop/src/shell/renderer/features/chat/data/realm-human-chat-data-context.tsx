import { createContext, useContext, type PropsWithChildren } from 'react';
import type { RealmHumanChatData } from './realm-human-chat-data.js';

const RealmHumanChatDataContext = createContext<RealmHumanChatData | null>(null);

export function RealmHumanChatDataProvider(
  props: PropsWithChildren<{ readonly resource: RealmHumanChatData }>,
) {
  return (
    <RealmHumanChatDataContext.Provider value={props.resource}>
      {props.children}
    </RealmHumanChatDataContext.Provider>
  );
}

export function useRealmHumanChatData(): RealmHumanChatData {
  const resource = useContext(RealmHumanChatDataContext);
  if (!resource) throw new Error('REALM_HUMAN_CHAT_DATA_MISSING');
  return resource;
}
