// =====================================================================
//  validate.js — проверка входящих данных по «схеме» (библиотека zod).
//
//  Схема описывает, какими должны быть данные:
//      const schema = z.object({ login: z.string().min(3), age: z.number().int() });
//  В маршруте:
//      router.post('/', validate(schema), (req, res) => { req.body … });   // тело запроса
//      router.get('/', validate(schema, 'query'), (req, res) => { req.valid.query … });  // ?параметры
//
//  Если данные не подходят — клиент получит 400 и список полей с ошибками,
//  а код маршрута даже не начнёт выполняться.
// =====================================================================

import { badRequest } from '../errors.js';

/**
 * @param {import('zod').ZodTypeAny} schema
 * @param {'body'|'query'|'params'} where — что проверяем: тело, параметры адреса после «?» или части пути
 */
export function validate(schema, where = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[where] ?? {});
    if (!result.success) {
      const fields = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(весь запрос)',
        message: issue.message,
      }));
      throw badRequest('Проверьте введённые данные', { fields });
    }
    // Проверенные и очищенные данные (лишние поля отброшены, строки обрезаны и т.п.)
    req.valid = { ...req.valid, [where]: result.data };
    if (where === 'body') req.body = result.data;
    next();
  };
}
