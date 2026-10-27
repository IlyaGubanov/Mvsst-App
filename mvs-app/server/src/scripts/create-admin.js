// =====================================================================
//  npm run create-admin — создать администратора (или сделать администратором существующего).
//
//  Запускается в терминале из папки server/. Задаёт вопросы:
//    логин → ФИО → пароль (не отображается при вводе) → повтор пароля.
//  Если такой логин уже есть — предложит сменить ему пароль и выдать роль администратора
//  (на случай, если вы забыли пароль единственного администратора).
// =====================================================================

import readline from 'node:readline';
import { pool, query, queryOne, explainDbError } from '../db.js';
import { hashPassword, newPasswordSchema } from '../services/passwords.js';
import { audit } from '../services/audit.js';

// Пакетный режим: если ответы подаются не с клавиатуры, а потоком строк
// (например, из скрипта установки: логин, ФИО, пароль, повтор пароля — по строке на ответ),
// читаем их все заранее и отдаём по очереди.
let pipedAnswers = null;
async function readPipedAnswers() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  // PowerShell добавляет в начало невидимый символ BOM (﻿) — убираем его
  return text.replace(/^﻿/, '').split(/\r?\n/);
}

/** Задать вопрос в терминале. hidden: true — вместо символов печатать «*» (для пароля). */
async function ask(question, { hidden = false } = {}) {
  if (!process.stdin.isTTY) {
    pipedAnswers ??= await readPipedAnswers();
    const answer = pipedAnswers.shift() ?? '';
    process.stdout.write(question + (hidden ? '***' : answer) + '\n');
    return hidden ? answer : answer.trim();
  }
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Подменяем вывод: всё, что печатается после вопроса, заменяем звёздочками
      rl._writeToOutput = (text) => rl.output.write(rl.muted ? '*' : text);
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(hidden ? answer : answer.trim());
    });
    rl.muted = hidden; // включаем «звёздочки» после того, как вопрос напечатан
  });
}

async function askNewPassword() {
  for (;;) {
    const password = await ask('Пароль (не меньше 10 символов, буквы и цифры): ', { hidden: true });
    const check = newPasswordSchema.safeParse(password);
    let problem = check.success ? null : check.error.issues[0].message;
    if (!problem) {
      const repeat = await ask('Повторите пароль: ', { hidden: true });
      if (repeat !== password) problem = 'Пароли не совпадают';
    }
    if (!problem) return password;
    // В пакетном режиме переспросить некого — останавливаемся с понятной ошибкой
    if (!process.stdin.isTTY) throw new Error(problem);
    console.log(`  ✖ ${problem}, попробуйте ещё раз`);
  }
}

async function main() {
  console.log('\n=== Создание администратора МВС СТ ===\n');

  const login = (await ask('Логин (латиница, например admin): ')).toLowerCase();
  if (!/^[a-z0-9._-]{3,60}$/.test(login)) {
    throw new Error('Логин: 3–60 символов — латинские буквы, цифры, точка, дефис, подчёркивание');
  }

  const existing = await queryOne('SELECT id, full_name, role FROM users WHERE login = ?', [login]);
  if (existing) {
    const answer = await ask(`Пользователь «${login}» (${existing.full_name}) уже есть. Сменить ему пароль и сделать администратором? (да/нет): `);
    if (!['да', 'д', 'yes', 'y'].includes(answer.toLowerCase())) {
      console.log('Отменено, ничего не изменено.');
      return;
    }
    const password = await askNewPassword();
    await query(
      `UPDATE users SET password_hash = ?, role = 'admin', is_active = 1, must_change_password = 0,
              failed_logins = 0, locked_until = NULL WHERE id = ?`,
      [await hashPassword(password), existing.id],
    );
    await audit(undefined, {
      entity: 'user', entityId: existing.id, entityName: existing.full_name, action: 'update',
      summary: 'Пароль и роль администратора заданы командой create-admin',
    });
    console.log(`\n✔ Готово: «${login}» — администратор, пароль обновлён.`);
    return;
  }

  const fullName = await ask('ФИО (как будет видно в журнале, например Иванов И. И.): ');
  if (fullName.length < 2) throw new Error('ФИО — не короче 2 символов');
  const password = await askNewPassword();

  // Пароль задан самим администратором, поэтому менять его при первом входе не требуем
  const result = await query(
    `INSERT INTO users (login, password_hash, full_name, role, must_change_password)
     VALUES (?, ?, ?, 'admin', 0)`,
    [login, await hashPassword(password), fullName],
  );
  await audit(undefined, {
    entity: 'user', entityId: result.insertId, entityName: fullName, action: 'create',
    summary: `Создан администратор ${login} командой create-admin`,
  });
  console.log(`\n✔ Администратор «${login}» создан. Войдите в приложение с этим логином и паролем.`);
}

main()
  .catch((err) => {
    console.error('\n✖ ' + explainDbError(err));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
