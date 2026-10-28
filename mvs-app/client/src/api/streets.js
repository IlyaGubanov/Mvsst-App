// Запросы к API «Благоустройство улиц». Ключи кэша начинаются с 'streets'.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export const useStreetsMeta = () => useQuery({ queryKey: ['streets', 'meta'], queryFn: () => api('/streets/meta') });

/** Отчёт; compare — id отчёта для сравнения (по умолчанию сервер берёт предыдущий). */
export const useStreetsReport = (id, compare) => useQuery({
  queryKey: ['streets', 'report', id, compare ?? 'prev'],
  queryFn: () => api(`/streets/reports/${id}${compare ? `?compare=${compare}` : ''}`),
  enabled: Boolean(id),
});

export const useStreetsHistory = (program, objectId, enabled = true) => useQuery({
  queryKey: ['streets', 'history', program, objectId ?? 'all'],
  queryFn: () => api(`/streets/history?program=${program}${objectId ? `&objectId=${objectId}` : ''}`),
  enabled: Boolean(program) && enabled,
  staleTime: 5 * 60 * 1000,
});

export const useStreetObject = (id) => useQuery({ queryKey: ['streets', 'object', id], queryFn: () => api(`/streets/objects/${id}`), enabled: Boolean(id) });

// После любой записи сбрасываем кэш раздела и «Сводки»
function useStreetsMutation(mutationFn) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['streets'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

/** Новый ручной отчёт на дату: { program, date }. */
export const useCreateStreetsReport = () => useStreetsMutation((body) => api('/streets/reports', { method: 'POST', body }));

/** Ввод по объекту: { reportId, objectId, row: { status, people, tech, remarks, values } }. */
export const useSaveStreetRow = () => useStreetsMutation(({ reportId, objectId, row }) => api(`/streets/reports/${reportId}/objects/${objectId}`, { method: 'PUT', body: row }));

/** Закрыть / открыть ручной отчёт (администратор). */
export const useToggleStreetsReport = () => useStreetsMutation(({ id, close }) => api(`/streets/reports/${id}/${close ? 'close' : 'reopen'}`, { method: 'POST' }));
