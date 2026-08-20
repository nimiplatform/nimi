import { createContext, useContext, type ReactNode } from 'react';

import type { LabCanonicalRendererBindings } from './contract.js';

const LabRendererContext = createContext<LabCanonicalRendererBindings | null>(null);

export function LabRendererProvider(props: {
  readonly bindings: LabCanonicalRendererBindings;
  readonly children: ReactNode;
}) {
  return (
    <LabRendererContext.Provider value={props.bindings}>
      {props.children}
    </LabRendererContext.Provider>
  );
}

export function useLabRendererHost(): LabCanonicalRendererBindings {
  const value = useContext(LabRendererContext);
  if (!value) throw new Error('LAB_RENDERER_HOST_MISSING');
  return value;
}
