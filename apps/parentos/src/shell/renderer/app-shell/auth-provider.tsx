import { useEffect } from 'react';
import { useAppStore } from './app-store.js';
import { runParentOSBootstrap } from '../infra/parentos-bootstrap.js';
import { getPlatformClient } from '@nimiplatform/sdk';
import { ParentOSLoginPage } from '../features/auth/parentos-login-page.js';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const authStatus = useAppStore((s) => s.auth.status);
  const bootstrapReady = useAppStore((s) => s.bootstrapReady);
  const bootstrapError = useAppStore((s) => s.bootstrapError);

  useEffect(() => {
    void runParentOSBootstrap();
  }, []);

  useEffect(() => {
    if (authStatus !== 'unauthenticated') {
      return;
    }
    try {
      getPlatformClient().realm.clearAuth();
    } catch {
      // Platform client may not be ready yet
    }
  }, [authStatus]);

  if (bootstrapError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center" style={{ background: '#E5ECEA' }}>
        <div className="text-center space-y-4">
          <p className="text-red-500 text-lg">{bootstrapError}</p>
        </div>
      </div>
    );
  }

  if (!bootstrapReady || authStatus === 'bootstrapping') {
    return (
      <div className="flex h-screen w-screen items-center justify-center" style={{ background: '#E5ECEA' }}>
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin mx-auto" />
          <p className="text-gray-500">加载中...</p>
        </div>
      </div>
    );
  }

  if (authStatus === 'unauthenticated') {
    return <ParentOSLoginPage />;
  }

  return <>{children}</>;
}
