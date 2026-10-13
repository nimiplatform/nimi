import { AmbientBackground } from '@nimiplatform/kit/ui';
import { ProductArea } from './routes/product-area.js';
import { useEffect } from 'react';
import { useAppNavigation } from './routes/app-navigation.js';

// The ready subtree declares availability; its teardown fences App navigation.
export function AuthenticatedShell() {
  const { setReady } = useAppNavigation();
  useEffect(() => { setReady(true); return () => setReady(false); }, [setReady]);
  return (
    <AmbientBackground
      variant="mesh"
      className="app-shell"
      data-testid="nimi-app-shell"
    >
      <ProductArea />
    </AmbientBackground>
  );
}
