import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NimiThemeProvider, TooltipProvider } from '@nimiplatform/kit/ui';
import { AuthProvider } from './app-shell/auth-provider.js';
import { ShellLayout, type StudioWorkspace } from './app-shell/shell-layout.js';
import { OwnerPortfolio } from './features/portfolio/OwnerPortfolio.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  const [activeWorkspace, setActiveWorkspace] = useState<StudioWorkspace>('portfolio');

  return (
    <NimiThemeProvider accentPack="nimi-accent" defaultScheme="light">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <ShellLayout activeWorkspace={activeWorkspace} onWorkspaceChange={setActiveWorkspace}>
              <OwnerPortfolio activeWorkspace={activeWorkspace} onWorkspaceChange={setActiveWorkspace} />
            </ShellLayout>
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </NimiThemeProvider>
  );
}
