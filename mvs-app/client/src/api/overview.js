// Запрос «Сводки» с кэшированием: одна и та же дата не запрашивается повторно, пока данные свежие.
import { useQuery } from '@tanstack/react-query';
import { api } from './client.js';

export function useOverview(date) {
  return useQuery({
    queryKey: ['overview', date],
    queryFn: () => api(`/overview?date=${encodeURIComponent(date)}`),
  });
}
