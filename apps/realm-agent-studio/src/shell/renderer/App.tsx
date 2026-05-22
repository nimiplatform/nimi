import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NimiThemeProvider, TooltipProvider } from '@nimiplatform/nimi-kit/ui';
import { AuthProvider } from './app-shell/auth-provider.js';
import { ShellLayout } from './app-shell/shell-layout.js';
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
  return (
    <NimiThemeProvider accentPack="nimi-accent" defaultScheme="light">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <ShellLayout>
              <OwnerPortfolio />
            </ShellLayout>
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </NimiThemeProvider>
  );
}
