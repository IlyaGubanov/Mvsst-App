// Запросы к API «Сети, коллекторы, водные объекты». Ключи кэша начинаются с 'networks'.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

const withPeriod = (path, period) => (period ? `${path}?period=${period}` : path);

export const useNetMeta = () => useQuery({ queryKey: ['networks', 'meta'], queryFn: () => api('/networks/meta'), staleTime: 5 * 60 * 1000 });

export const useNetObjects = (period) => useQuery({
  queryKey: ['networks', 'objects', period ?? 'current'],
  queryFn: () => api(withPeriod('/networks/objects', period)),
});

export const useNetObject = (id, period, options = {}) => useQuery({
  queryKey: ['networks', 'object', id, period ?? 'current'],
  queryFn: () => api(withPeriod(`/networks/objects/${id}`, period)),
  enabled: Boolean(id),
  ...options,
});

/** Сохранить факт по линиям, КС, рабочих и технику за период. */
export function useSaveNetFacts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ period, objects }) => api(`/networks/periods/${period}/facts`, { method: 'PUT', body: { objects } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['networks'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

export function useToggleNetPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ period, close }) => api(`/networks/periods/${period}/${close ? 'close' : 'reopen'}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['networks'] }),
  });
}
