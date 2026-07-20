import { createContext, useContext, type ReactNode } from 'react';

import type { TesterCanonicalRendererBindings } from './contract.js';

const TesterRendererContext = createContext<TesterCanonicalRendererBindings | null>(null);

export function TesterRendererProvider(props: {
  readonly bindings: TesterCanonicalRendererBindings;
  readonly children: ReactNode;
}) {
  return (
    <TesterRendererContext.Provider value={props.bindings}>
      {props.children}
    </TesterRendererContext.Provider>
  );
}

export function useTesterRendererHost(): TesterCanonicalRendererBindings {
  const value = useContext(TesterRendererContext);
  if (!value) throw new Error('TESTER_RENDERER_HOST_MISSING');
  return value;
}
