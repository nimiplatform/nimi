import { createContext, useContext, type PropsWithChildren } from 'react';

import type { RealmSocialData } from './realm-social-data.js';

const RealmSocialDataContext = createContext<RealmSocialData | null>(null);

export function RealmSocialDataProvider(
  props: PropsWithChildren<{ readonly resource: RealmSocialData }>,
) {
  return (
    <RealmSocialDataContext.Provider value={props.resource}>
      {props.children}
    </RealmSocialDataContext.Provider>
  );
}

export function useRealmSocialData(): RealmSocialData {
  const resource = useContext(RealmSocialDataContext);
  if (!resource) throw new Error('REALM_SOCIAL_DATA_RESOURCE_MISSING');
  return resource;
}
