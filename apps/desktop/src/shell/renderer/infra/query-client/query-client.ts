import { QueryClient } from '@tanstack/react-query';

export function createDesktopQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 15_000,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
