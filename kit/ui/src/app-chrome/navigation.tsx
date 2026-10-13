import React, { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { NimiDestination, NimiNavigationController } from '@nimiplatform/kit/core/navigation';

const NavigationContext = createContext<NimiNavigationController<NimiDestination> | null>(null);

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-navigation
export function NimiNavigationProvider<D extends NimiDestination>({ controller, children }: {
  readonly controller: NimiNavigationController<D>; readonly children: ReactNode;
}) {
  return <NavigationContext.Provider value={controller as unknown as NimiNavigationController<NimiDestination>}>{children}</NavigationContext.Provider>;
}
export function useNimiNavigation<D extends NimiDestination>(): NimiNavigationController<D> {
  const controller = useContext(NavigationContext);
  if (!controller) throw new Error('A NimiNavigationProvider is required.');
  return controller as unknown as NimiNavigationController<D>;
}
export function useNimiNavigationSnapshot<D extends NimiDestination>() {
  const controller = useNimiNavigation<D>();
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}
export function useOptionalNimiNavigation() { return useContext(NavigationContext); }
export function NimiNavigationLink<D extends NimiDestination>({ destination, replace = false, children, onResult, ...rest }: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  readonly destination: D; readonly replace?: boolean; readonly onResult?: (result: Awaited<ReturnType<NimiNavigationController<D>['push']>>) => void;
}) {
  const controller = useNimiNavigation<D>();
  return <button {...rest} type="button" role="link" onClick={() => { void (replace ? controller.replace(destination) : controller.push(destination)).then(onResult); }}>{children}</button>;
}
