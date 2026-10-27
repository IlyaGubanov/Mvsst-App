// =====================================================================
//  passwords.js — всё о паролях: хеширование, проверка, временные пароли, требования.
//
//  Хеш (bcrypt) — «отпечаток» пароля, из которого нельзя получить сам пароль.
//  При входе мы хешируем введённый пароль тем же способом и сравниваем отпечатки.
//  Даже если базу украдут, паролей в ней не будет.
// =====================================================================

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config.js';

// «Стоимость» хеширования: чем больше, тем дольше подбор пароля для злоумышленника.
// 11 ≈ 0,2–0,4 секунды на одну проверку — незаметно для человека, очень дорого для перебора.
const BCRYPT_COST = 11;

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Хеш-пустышка: при входе под несуществующим логином мы всё равно тратим время на проверку.
// Иначе по скорости ответа можно было бы угадать, какие логины существуют.
const DUMMY_HASH = bcrypt.hashSync('пароль-пустышка-для-выравнивания-времени', BCRYPT_COST);
export function wasteTimeLikePasswordCheck(password) {
  return bcrypt.compare(password, DUMMY_HASH);
}

/**
 * Временный пароль для нового пользователя или после сброса.
 * Без похожих символов (0/O, 1/l/I), чтобы его было легко продиктовать.
 */
export function generateTempPassword(length = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < length; i++) result += alphabet[crypto.randomInt(alphabet.length)];
  return result;
}

/** Требования к новому паролю (используется в zod-схемах). */
export const newPasswordSchema = z
  .string({ required_error: 'Введите новый пароль' })
  .min(config.security.minPasswordLength, `Пароль — не короче ${config.security.minPasswordLength} символов`)
  // bcrypt учитывает только первые 72 байта; кириллическая буква занимает 2 байта
  .refine((p) => Buffer.byteLength(p, 'utf8') <= 72, 'Пароль слишком длинный (не больше ~36 русских или 72 латинских символов)')
  .refine((p) => /\p{L}/u.test(p) && /\d/.test(p), 'Пароль должен содержать и буквы, и цифры');
