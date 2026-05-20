import { QueryClient } from '@tanstack/react-query';

/**
 * QueryClient global con defaults pensados para un WMS operativo:
 * - staleTime 30s: los KPIs/listados no re-fetchan en cada nav
 * - refetchOnWindowFocus: al volver al tab, refresca (turno largo)
 * - retry 1: errores transitorios sí, pero no spamear el server
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: 1,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
    mutations: {
      retry: 0,
    },
  },
});
