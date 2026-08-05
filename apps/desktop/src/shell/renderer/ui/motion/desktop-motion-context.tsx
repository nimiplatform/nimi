import {
  createContext,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

type DesktopMotionContextValue = {
  readonly appReducedMotion: boolean;
  readonly setAppReducedMotion: (value: boolean) => void;
};

const DesktopMotionContext = createContext<DesktopMotionContextValue | null>(null);

export function DesktopMotionProvider(props: PropsWithChildren) {
  const [appReducedMotion, setAppReducedMotion] = useState(false);
  const value = useMemo<DesktopMotionContextValue>(() => ({
    appReducedMotion,
    setAppReducedMotion,
  }), [appReducedMotion]);

  return (
    <DesktopMotionContext.Provider value={value}>
      {props.children}
    </DesktopMotionContext.Provider>
  );
}

function useDesktopMotionContext(): DesktopMotionContextValue {
  const context = useContext(DesktopMotionContext);
  if (!context) throw new Error('DESKTOP_MOTION_PROVIDER_MISSING');
  return context;
}

export function useDesktopAppReducedMotionPreference(): boolean {
  return useDesktopMotionContext().appReducedMotion;
}

export function useSetDesktopAppReducedMotionPreference(): (value: boolean) => void {
  return useDesktopMotionContext().setAppReducedMotion;
}
