// =====================================================================
//  access.js (middleware) — проверки прав на направление и объект для маршрутов.
//  Сами правила — в services/access.js; здесь только «обёртки» для Express.
//
//  Как будет выглядеть маршрут ввода на следующих шагах:
//    router.put('/objects/:id/status',
//      useDirection('mkd'),                      // направление видно пользователю?
//      requireObjectEdit((req) => req.params.id), // он ответственный за этот адрес?
//      async (req, res) => { … сохранить … });
// =====================================================================

import { badRequest, forbidden } from '../errors.js';
import { getDirectionByCode, canViewDirection, canEditObject } from '../services/access.js';

async function attachDirection(req, code) {
  const direction = await getDirectionByCode(code);
  if (!(await canViewDirection(req.user, direction.id))) {
    throw forbidden('У вас нет доступа к этому направлению. Обратитесь к администратору.');
  }
  req.direction = direction;
}

/** Направление задано в коде маршрута: useDirection('mkd'). */
export function useDirection(code) {
  return async (req, res, next) => {
    await attachDirection(req, code);
    next();
  };
}

/** Направление берётся из адреса: /api/directions/:direction/… */
export function useDirectionFromParam(paramName = 'direction') {
  return async (req, res, next) => {
    await attachDirection(req, req.params[paramName]);
    next();
  };
}

/**
 * Пользователь должен быть ответственным за объект (или администратором).
 * @param {(req) => number|string} getObjectId — как достать id объекта из запроса
 */
export function requireObjectEdit(getObjectId) {
  return async (req, res, next) => {
    if (!req.direction) throw new Error('requireObjectEdit нужно ставить после useDirection');
    const objectId = Number(getObjectId(req));
    if (!Number.isInteger(objectId) || objectId <= 0) throw badRequest('Неверный номер объекта');
    if (!(await canEditObject(req.user, req.direction, objectId))) {
      throw forbidden('Вы не назначены ответственным за этот объект. Обратитесь к администратору.');
    }
    next();
  };
}
