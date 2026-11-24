import { useEffect } from 'react';
import { ProductArea } from './routes/product-area.js';
import { useAppNavigation } from './routes/app-navigation.js';

// The ready subtree declares availability; its teardown fences App navigation.
export function AuthenticatedShell() {
  const { setReady } = useAppNavigation();
  useEffect(() => { setReady(true); return () => setReady(false); }, [setReady]);
  return (
    <div className="app-shell" data-testid="nimi-app-shell">
      <ProductArea />
    </div>
  );
}
