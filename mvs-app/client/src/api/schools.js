// Запросы к API «Капремонт школ». Ключи кэша начинаются с 'schools'.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

const withDate = (path, date) => (date ? `${path}${path.includes('?') ? '&' : '?'}date=${date}` : path);

export const useSchoolsMeta = () => useQuery({ queryKey: ['schools', 'meta'], queryFn: () => api('/schools/meta'), staleTime: 5 * 60 * 1000 });

export const useSchoolsOverview = (date) => useQuery({
  queryKey: ['schools', 'overview', date ?? 'today'],
  queryFn: () => api(withDate('/schools/overview', date)),
});

export const useSchool = (id, date, options = {}) => useQuery({
  queryKey: ['schools', 'object', id, date ?? 'today'],
  queryFn: () => api(withDate(`/schools/objects/${id}`, date)),
  enabled: Boolean(id),
  ...options,
});

export const useProcurement = (date, enabled = true) => useQuery({
  queryKey: ['schools', 'procurement', date ?? 'today'],
  queryFn: () => api(withDate('/schools/procurement', date)),
  enabled,
});

export const useSystems = (enabled = true) => useQuery({ queryKey: ['schools', 'systems'], queryFn: () => api('/schools/systems'), enabled });

/** Сохранить выполнение работ и ресурсы за день. */
export function useSaveSchoolDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ date, objects }) => api(`/schools/days/${date}`, { method: 'PUT', body: { objects } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schools'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}
