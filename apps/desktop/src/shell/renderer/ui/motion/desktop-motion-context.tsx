import { MotionConfig } from 'motion/react';
import {
  createContext,
  useContext,
  useEffect,
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

  // Mirror the app-level switch onto the root element so the CSS guard in
  // styles.css can freeze transitions/animations too; clean up on unmount.
  useEffect(() => {
    document.documentElement.dataset.nimiReducedMotion = appReducedMotion ? 'true' : 'false';
    return () => {
      delete document.documentElement.dataset.nimiReducedMotion;
    };
  }, [appReducedMotion]);

  return (
    <DesktopMotionContext.Provider value={value}>
      {/* Feed the app switch into the kit motion substrate: 'always' forces
          reduced motion; 'user' hands back to the OS media query. */}
      <MotionConfig reducedMotion={appReducedMotion ? 'always' : 'user'}>
        {props.children}
      </MotionConfig>
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
