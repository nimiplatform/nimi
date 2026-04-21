import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@renderer/infra/query-client.js';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
