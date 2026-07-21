import { createContext, useContext, type PropsWithChildren } from 'react';

import type { RuntimeConfigConnectorSdkService } from './runtime-config-connector-sdk-service.js';

const RuntimeConfigConnectorSdkContext = createContext<RuntimeConfigConnectorSdkService | null>(null);

export function RuntimeConfigConnectorSdkProvider({
  children,
  service,
}: PropsWithChildren<{ readonly service: RuntimeConfigConnectorSdkService }>) {
  return (
    <RuntimeConfigConnectorSdkContext.Provider value={service}>
      {children}
    </RuntimeConfigConnectorSdkContext.Provider>
  );
}

export function useRuntimeConfigConnectorSdk(): RuntimeConfigConnectorSdkService {
  const service = useContext(RuntimeConfigConnectorSdkContext);
  if (!service) {
    throw new Error('DESKTOP_RUNTIME_CONNECTOR_SDK_CONTEXT_MISSING');
  }
  return service;
}
