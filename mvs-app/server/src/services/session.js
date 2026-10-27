// =====================================================================
//  session.js — действия с сеансом входа в виде промисов (чтобы писать await).
// =====================================================================

/**
 * Выдать новый номер сеанса. Делается при каждом входе: если злоумышленник заранее
 * «подсунул» пользователю известный ему номер сеанса, после входа этот номер станет бесполезен.
 */
export function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

/** Принудительно сохранить сеанс (нужно перед ответом сразу после входа). */
export function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

/** Завершить сеанс (выход). Ошибки игнорируем: цель — чтобы сеанса не было. */
export function destroySession(req) {
  return new Promise((resolve) => {
    if (!req.session) return resolve();
    req.session.destroy(() => resolve());
  });
}
