import { createContext, useContext, type PropsWithChildren } from 'react';

import type { DesktopCanonicalRendererBindings } from './contract.js';

const DesktopRendererBindingContext = createContext<DesktopCanonicalRendererBindings | null>(null);

export function DesktopRendererBindingProvider(
  props: PropsWithChildren<{ readonly bindings: DesktopCanonicalRendererBindings }>,
) {
  return (
    <DesktopRendererBindingContext.Provider value={props.bindings}>
      {props.children}
    </DesktopRendererBindingContext.Provider>
  );
}

export function useDesktopRendererCommands(): DesktopCanonicalRendererBindings['app']['commands'] {
  return useDesktopRendererBindings().app.commands;
}

export function useDesktopRendererSdk(): DesktopCanonicalRendererBindings['sdk'] {
  return useDesktopRendererBindings().sdk;
}

export function useDesktopRendererBindings(): DesktopCanonicalRendererBindings {
  const bindings = useContext(DesktopRendererBindingContext);
  if (!bindings) throw new Error('DESKTOP_RENDERER_BINDINGS_MISSING');
  return bindings;
}
