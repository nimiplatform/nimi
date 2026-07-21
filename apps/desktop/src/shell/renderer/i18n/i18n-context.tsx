import { createContext, useContext, type PropsWithChildren } from 'react';

import type { DesktopI18nResource } from './desktop-i18n.js';

export const DesktopI18nResourceContext = createContext<DesktopI18nResource | null>(null);

export function DesktopI18nResourceProvider(
  props: PropsWithChildren<{ readonly resource: DesktopI18nResource }>,
) {
  return (
    <DesktopI18nResourceContext.Provider value={props.resource}>
      {props.children}
    </DesktopI18nResourceContext.Provider>
  );
}

export function useDesktopI18nResource(): DesktopI18nResource {
  const resource = useContext(DesktopI18nResourceContext);
  if (!resource) throw new Error('DESKTOP_I18N_RESOURCE_MISSING');
  return resource;
}
