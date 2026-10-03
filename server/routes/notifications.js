import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  deliverSavedTelegram,
  getNotificationChannels,
  saveNotificationChannels,
} from '../services/notificationChannels.js';

const router = Router();
router.use(requireAuth);

const ERROR_MESSAGES = Object.freeze({
  INVALID_TOKEN: 'Неверный токен',
  INVALID_CHAT_ID: 'Некорректный Chat ID',
  TOKEN_REQUIRED: 'Токен Telegram не задан',
  INVALID_WEBHOOK: 'Некорректный Webhook URL',
  NOT_CONFIGURED: 'Настройки не сохранены',
  CHAT_NOT_FOUND: 'Чат не найден',
  BOT_CANNOT_MESSAGE: 'Бот не может написать этому пользователю',
  RATE_LIMITED: 'Telegram временно ограничил отправку',
  TELEGRAM_UNAVAILABLE: 'Telegram недоступен',
  TELEGRAM_REJECTED: 'Telegram отклонил сообщение',
  TIMEOUT: 'Telegram не ответил вовремя',
  NETWORK_ERROR: 'Ошибка сети',
  SECRET_UNAVAILABLE: 'Защищённые настройки недоступны',
  ENCRYPTION_NOT_CONFIGURED: 'Серверное хранение секретов не настроено',
});

function errorResponse(res, error) {
  const code = error?.code && ERROR_MESSAGES[error.code] ? error.code : 'SAVE_FAILED';
  const status = code === 'ENCRYPTION_NOT_CONFIGURED' ? 503 : 400;
  return res.status(status).json({ ok: false, code, message: ERROR_MESSAGES[code] ?? 'Не удалось сохранить' });
}

router.get('/channels', async (req, res, next) => {
  try { res.json({ channels: await getNotificationChannels(req.user.id) }); }
  catch (error) { next(error); }
});

router.put('/channels', async (req, res, next) => {
  try {
    const channels = await saveNotificationChannels(req.user.id, req.body);
    res.json({ ok: true, channels });
  } catch (error) {
    if (error?.code) return errorResponse(res, error);
    next(error);
  }
});

router.post('/telegram/test', async (req, res, next) => {
  try {
    const result = await deliverSavedTelegram(req.user.id, {
      eventType: 'TEST',
      text: 'CRYPTORA · Проверка Telegram\nУведомления настроены правильно.',
    });
    if (result.ok) return res.json({ ok: true, message: 'Уведомление отправлено' });
    const code = result.code ?? 'TELEGRAM_REJECTED';
    return res.status(code === 'RATE_LIMITED' ? 429 : 400).json({ ok: false, code, message: ERROR_MESSAGES[code] ?? 'Ошибка Telegram' });
  } catch (error) { next(error); }
});

// Locally evaluated user rules still originate in the browser. Delivery goes
// through the authenticated backend so the saved token never returns to JS.
router.post('/telegram/send', async (req, res, next) => {
  try {
    const event = req.body?.event;
    if (!event || typeof event.id !== 'string' || typeof event.symbol !== 'string' || typeof event.message !== 'string' || event.message.length > 2000) {
      return res.status(400).json({ ok: false, code: 'INVALID_EVENT', message: 'Некорректное событие' });
    }
    const text = [`CRYPTORA · алерт ${event.symbol.slice(0, 30)}`, event.message, `Время: ${String(event.timestamp ?? new Date().toISOString())}`, 'Информационное уведомление. Не является рекомендацией и не исполняет сделок.'].join('\n');
    const result = await deliverSavedTelegram(req.user.id, { eventType: 'USER_ALERT', eventId: event.id, text });
    if (result.ok) return res.json({ ok: true });
    const code = result.code ?? 'TELEGRAM_REJECTED';
    return res.status(code === 'RATE_LIMITED' ? 429 : 400).json({ ok: false, code, message: ERROR_MESSAGES[code] ?? 'Ошибка Telegram' });
  } catch (error) { next(error); }
});

export default router;
