// =====================================================================
//  Запросы к API «Капремонт МКД».
//  Ключи кэша начинаются с 'mkd' — после сохранения ввода сбрасываем их разом.
// =====================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

const withPeriod = (path, period) => (period ? `${path}${path.includes('?') ? '&' : '?'}period=${period}` : path);

/** Справочники, периоды, текущий период, мои адреса. */
export const useMkdMeta = () => useQuery({ queryKey: ['mkd', 'meta'], queryFn: () => api('/mkd/meta'), staleTime: 5 * 60 * 1000 });

/** Реестр адресов на период (без периода — последний на сегодня). */
export const useMkdObjects = (period) => useQuery({
  queryKey: ['mkd', 'objects', period ?? 'current'],
  queryFn: () => api(withPeriod('/mkd/objects', period)),
});

/** Карточка адреса на период. */
export const useMkdObject = (id, period, options = {}) => useQuery({
  queryKey: ['mkd', 'object', id, period ?? 'current'],
  queryFn: () => api(withPeriod(`/mkd/objects/${id}`, period)),
  enabled: Boolean(id),
  ...options,
});

/** Сохранить статусы позиций за период. */
export function useSaveMkdStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ period, items }) => api(`/mkd/periods/${period}/status`, { method: 'PUT', body: { items } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mkd'] });      // реестр, карточки, список периодов
      qc.invalidateQueries({ queryKey: ['overview'] }); // «Сводка» и счётчики на вкладках
    },
  });
}

/** Закрыть / открыть период (администратор). */
export function useTogglePeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ period, close }) => api(`/mkd/periods/${period}/${close ? 'close' : 'reopen'}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mkd'] }),
  });
}
