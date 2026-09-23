import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMarketData } from '@/context/MarketDataContext';
import { useLivePriceMap } from '@/hooks/useLivePrices';
import { Bell, X, Plus, Trash2, CheckCircle2, Pause, Play, AlertTriangle, Send, Webhook, History } from 'lucide-react';
import { CANONICAL_ASSETS } from '@/services/data/registry/assetRegistry';
import { PlanManager } from '@/services/subscription/PlanManager';
import type { AlertChannelId, UserAlertCondition } from '@/services/alerts/alertEvaluator';
import { conditionLabelRu } from '@/services/alerts/alertEvaluator';
import { isPlausibleBotToken, isValidWebhookUrl, maskToken } from '@/services/alerts/deliveryChannels';
import { signalSymbolToRoute } from '@/services/signals/signalNotifications';

type Tab = 'rules' | 'signals' | 'history' | 'channels';

const inputCls =
  'w-full bg-surface border border-surface-border rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-brand-cyan';

const DEFAULT_TARGET: Record<UserAlertCondition, string> = {
  ABOVE: '',
  BELOW: '',
  OI_SPIKE: '5',
  FUNDING_EXTREME: '0.05',
};

const STATUS_RU: Record<string, string> = {
  DELIVERED: 'ДОСТАВЛЕНО',
  SENT_UNCONFIRMED: 'ОТПРАВЛЕНО (БЕЗ ПОДТВЕРЖДЕНИЯ)',
  FAILED: 'ОШИБКА',
  SKIPPED: 'ПРОПУЩЕНО',
};

export const AlertsModal: React.FC = () => {
  const {
    isAlertsModalOpen,
    closeAlertsModal,
    alerts,
    addAlert,
    removeAlert,
    toggleAlertPaused,
    alertHistory,
    clearAlertHistory,
    markAlertsRead,
    unreadAlertCount,
    signalNotifications,
    signalUnreadCount,
    markSignalsRead,
    clearSignalNotifications,
    alertChannels,
    setAlertChannels,
    deliveryLog,
    userPlan,
    dataMode,
    liveFunding,
  } = useMarketData();

  const livePrices = useLivePriceMap(isAlertsModalOpen);
  const [tab, setTab] = useState<Tab>('rules');
  const [symbol, setSymbol] = useState('BTC');
  const [condition, setCondition] = useState<UserAlertCondition>('ABOVE');
  const [targetValue, setTargetValue] = useState('');
  const [channels, setChannels] = useState<AlertChannelId[]>(['IN_APP']);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [draft, setDraft] = useState(alertChannels);

  useEffect(() => {
    setDraft(alertChannels);
  }, [alertChannels]);

  useEffect(() => {
    if (isAlertsModalOpen && tab === 'history') markAlertsRead();
    if (isAlertsModalOpen && tab === 'signals') markSignalsRead();
  }, [isAlertsModalOpen, tab, markAlertsRead, markSignalsRead]);

  if (!isAlertsModalOpen) return null;

  const maxAlerts = PlanManager.getMaxAlerts(userPlan);
  const limitReached = alerts.length >= maxAlerts;

  const flash = (kind: 'ok' | 'err', text: string) => {
    setNotice({ kind, text });
    setTimeout(() => setNotice(null), 3000);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseFloat(targetValue.replace(',', '.'));
    if (!Number.isFinite(n)) {
      flash('err', 'Порог должен быть числом.');
      return;
    }
    const ok = addAlert({ symbol, condition, targetValue: n, channels });
    if (!ok) {
      flash('err', `Лимит тарифа ${userPlan}: не более ${maxAlerts} алертов.`);
      return;
    }
    flash('ok', `Алерт ${symbol} ${conditionLabelRu(condition)} ${n} создан.`);
    setTargetValue('');
  };

  const toggleChannel = (ch: AlertChannelId) =>
    setChannels((prev) => (prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]));

  const saveChannels = () => {
    setAlertChannels(draft);
    flash('ok', 'Настройки каналов сохранены локально в браузере.');
  };

  const requestBrowserPermission = async () => {
    if (typeof Notification === 'undefined') {
      flash('err', 'Браузер не поддерживает уведомления.');
      return;
    }
    const p = await Notification.requestPermission();
    if (p === 'granted') setDraft((d) => ({ ...d, browser: { enabled: true } }));
    else flash('err', `Разрешение на уведомления: ${p}.`);
  };

  const tgReady = alertChannels.telegram.enabled && isPlausibleBotToken(alertChannels.telegram.botToken) && alertChannels.telegram.chatId.trim() !== '';
  const whReady = alertChannels.webhook.enabled && isValidWebhookUrl(alertChannels.webhook.url);

  const currentValue = (a: (typeof alerts)[number]): string => {
    if (a.condition === 'ABOVE' || a.condition === 'BELOW') {
      const p = livePrices[a.symbol];
      return p !== undefined ? `сейчас $${p.toLocaleString('en-US', { maximumFractionDigits: 6 })}` : 'цена ещё не получена';
    }
    if (a.condition === 'FUNDING_EXTREME') {
      const f = liveFunding[a.symbol];
      return f !== undefined ? `сейчас ${f}%` : 'фандинг ещё не получен';
    }
    return 'оценивается по фактическому ряду OI (Binance openInterestHist, опрос 60 с)';
  };

  const tabBtn = (id: Tab, label: string, badge?: number) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      data-qa={`alerts-tab-${id}`}
      className={`px-3 py-1.5 text-xs rounded-t border-b-2 transition-colors ${
        tab === id ? 'border-brand-cyan text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
      }`}
    >
      {label}
      {badge ? <span className="ml-1.5 rounded-full bg-rose-500 px-1.5 font-mono text-[11px] text-white">{badge}</span> : null}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-xl max-h-[92vh] overflow-y-auto bg-surface border border-surface-border rounded-lg shadow-2xl p-6 text-slate-200">
        <button onClick={closeAlertsModal} className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors" aria-label="Закрыть">
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-3">
          <div className="p-2 rounded-full bg-brand-cyan/20 text-brand-cyan border border-brand-cyan/30">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">Система алертов</h3>
            <p className="text-xs text-slate-400 font-sans">
              Цена — по WS-тикеру, фандинг — по REST premiumIndex. Уведомления информационные, сделки не исполняются.
            </p>
          </div>
        </div>

        {dataMode !== 'live' && (
          <div className="mb-3 p-2.5 bg-amber-950/60 border border-amber-500/40 rounded flex items-center space-x-2 text-xs text-amber-300">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>Источник данных не LIVE — алерты не оцениваются.</span>
          </div>
        )}

        {notice && (
          <div
            className={`mb-3 p-2.5 rounded flex items-center space-x-2 text-xs border ${
              notice.kind === 'ok'
                ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300'
                : 'bg-rose-950/70 border-rose-500/40 text-rose-300'
            }`}
          >
            {notice.kind === 'ok' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
            <span>{notice.text}</span>
          </div>
        )}

        <div className="flex items-end gap-1 border-b border-surface-border mb-4">
          {tabBtn('rules', `Правила (${alerts.length}/${maxAlerts})`)}
          {tabBtn('signals', 'Сигналы', signalUnreadCount)}
          {tabBtn('history', 'История', unreadAlertCount)}
          {tabBtn('channels', 'Каналы')}
        </div>

        {tab === 'rules' && (
          <>
            <form onSubmit={handleSubmit} className="p-3.5 bg-surface-elevated/70 rounded-md border border-surface-border mb-4 space-y-3">
              <div className="text-xs font-semibold text-slate-300 tracking-wide">Новое условие</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-slate-400 font-sans block mb-1">Инструмент</label>
                  <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className={`${inputCls} font-mono`}>
                    {CANONICAL_ASSETS.map((a) => (
                      <option key={a.symbol} value={a.symbol}>
                        {a.symbol} ({a.name})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 font-sans block mb-1">Триггер</label>
                  <select
                    value={condition}
                    onChange={(e) => {
                      const c = e.target.value as UserAlertCondition;
                      setCondition(c);
                      setTargetValue(DEFAULT_TARGET[c]);
                    }}
                    className={inputCls}
                  >
                    <option value="ABOVE">Цена ≥ порога (USD)</option>
                    <option value="BELOW">Цена ≤ порога (USD)</option>
                    <option value="FUNDING_EXTREME">|Фандинг 8ч| ≥ порога (%)</option>
                    <option value="OI_SPIKE">OI Δ1ч ≥ порога (%) — только фактический ряд OI</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[11px] text-slate-400 font-sans block mb-1">Порог</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                  placeholder={condition === 'FUNDING_EXTREME' ? 'например 0.05' : 'например 66500'}
                  className={`${inputCls} font-mono`}
                  data-qa="alert-target-input"
                />
              </div>
              <div>
                <div className="text-[11px] text-slate-400 font-sans mb-1">Каналы доставки</div>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  {(
                    [
                      ['IN_APP', 'В приложении', true],
                      ['BROWSER', 'Браузер', alertChannels.browser.enabled],
                      ['TELEGRAM', 'Telegram', tgReady],
                      ['WEBHOOK', 'Webhook', whReady],
                    ] as const
                  ).map(([id, label, ready]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleChannel(id)}
                      disabled={id === 'IN_APP'}
                      title={ready ? undefined : 'Канал не настроен — см. вкладку «Каналы»'}
                      className={`px-2 py-0.5 rounded border ${
                        channels.includes(id) ? 'border-brand-cyan text-brand-cyan bg-brand-cyan/10' : 'border-surface-border text-slate-400'
                      } ${ready ? '' : 'opacity-60'}`}
                    >
                      {label}
                      {!ready && ' ·  не настроен'}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="submit"
                disabled={limitReached}
                data-qa="alert-submit"
                className="w-full py-2 bg-brand-cyan hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-semibold text-xs rounded flex items-center justify-center space-x-1 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{limitReached ? `Достигнут лимит тарифа ${userPlan} (${maxAlerts})` : 'Добавить алерт'}</span>
              </button>
            </form>

            <div className="text-xs font-semibold text-slate-400 tracking-wide mb-2">Активные правила</div>
            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
              {alerts.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-xs">Нет активных алертов.</div>
              ) : (
                alerts.map((alert) => (
                  <div
                    key={alert.id}
                    data-qa="alert-rule"
                    className={`flex items-center justify-between p-2 rounded bg-surface border border-surface-border text-xs ${alert.paused ? 'opacity-60' : ''}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-mono">
                        <span className="font-bold text-white">{alert.symbol}</span>
                        <span className="text-slate-300">
                          {conditionLabelRu(alert.condition)} {alert.targetValue}
                        </span>
                        {alert.paused && <span className="text-[11px] text-amber-400">ПАУЗА</span>}
                      </div>
                      <div className="text-[11px] text-slate-500 font-sans truncate">
                        {currentValue(alert)}
                        {' · '}
                        {(alert.channels ?? ['IN_APP']).join(', ')}
                        {alert.lastTriggeredAt && ` · сработал ${new Date(alert.lastTriggeredAt).toLocaleTimeString('ru-RU')}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => toggleAlertPaused(alert.id)}
                        className="text-slate-500 hover:text-white transition-colors p-1.5"
                        title={alert.paused ? 'Возобновить' : 'Приостановить'}
                        aria-label={alert.paused ? 'Возобновить' : 'Приостановить'}
                      >
                        {alert.paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => removeAlert(alert.id)}
                        className="text-slate-500 hover:text-rose-400 transition-colors p-1.5"
                        title="Удалить"
                        aria-label="Удалить"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {tab === 'signals' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-slate-400 tracking-wide">
                События журнала сигналов ({signalNotifications.length})
              </div>
              <div className="flex items-center gap-3">
                <Link
                  to="/signals"
                  onClick={closeAlertsModal}
                  className="text-[11px] text-brand-cyan hover:underline"
                >
                  Открыть журнал →
                </Link>
                {signalNotifications.length > 0 && (
                  <button onClick={clearSignalNotifications} className="text-[11px] text-slate-500 hover:text-rose-400">
                    Очистить
                  </button>
                )}
              </div>
            </div>
            <p className="text-[11px] text-slate-500 font-sans mb-2">
              Новый сигнал, исполнение входа и исходы стратегий V3.0 / V3.3 / V2.8 — только факты журнала этого браузера.
            </p>
            <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
              {signalNotifications.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-xs">
                  Событий пока не было — движок публикует сетапы только на закрытых барах.
                </div>
              ) : (
                [...signalNotifications].reverse().map((n) => (
                  <div key={n.id} data-qa="signal-notification" className="p-2 rounded bg-surface border border-surface-border text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`font-bold ${
                          n.kind === 'NEW_SIGNAL'
                            ? 'text-brand-cyan'
                            : n.kind === 'FILL'
                              ? 'text-amber-300'
                              : 'text-emerald-300'
                        }`}
                      >
                        {n.title}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">{new Date(n.at).toLocaleString('ru-RU')}</span>
                    </div>
                    <div className="text-slate-300 font-sans mt-0.5">{n.detail}</div>
                    {/* Jump straight to the asset behind the signal (FET/USDT -> /coin/FET). */}
                    <Link
                      to={`/coin/${signalSymbolToRoute(n.symbol)}`}
                      onClick={closeAlertsModal}
                      data-qa="signal-open-asset"
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-cyan hover:underline"
                    >
                      Открыть актив {signalSymbolToRoute(n.symbol)} →
                    </Link>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === 'history' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-slate-400 tracking-wide flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" /> Срабатывания ({alertHistory.length})
              </div>
              {alertHistory.length > 0 && (
                <button onClick={clearAlertHistory} className="text-[11px] text-slate-500 hover:text-rose-400">
                  Очистить
                </button>
              )}
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
              {alertHistory.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-xs">Срабатываний пока не было.</div>
              ) : (
                alertHistory.map((ev) => {
                  const dl = deliveryLog.filter((d) => d.eventId === ev.id);
                  return (
                    <div key={ev.id} data-qa="alert-event" className="p-2 rounded bg-surface border border-surface-border text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-bold text-white">{ev.symbol}</span>
                        <span className="font-mono text-[11px] text-slate-500">{new Date(ev.timestamp).toLocaleString('ru-RU')}</span>
                      </div>
                      <div className="text-slate-300 font-sans mt-0.5">{ev.message}</div>
                      {dl.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {dl.map((d) => (
                            <span
                              key={d.id}
                              title={d.detail}
                              className={`px-1.5 py-0.5 rounded border text-[11px] ${
                                d.status === 'DELIVERED'
                                  ? 'border-emerald-500/40 text-emerald-300'
                                  : d.status === 'FAILED'
                                    ? 'border-rose-500/40 text-rose-300'
                                    : 'border-slate-500/40 text-slate-400'
                              }`}
                            >
                              {d.channel}: {STATUS_RU[d.status] ?? d.status}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {tab === 'channels' && (
          <div className="space-y-4">
            <p className="text-[11px] text-slate-400 font-sans">
              Настройки хранятся только в этом браузере (localStorage) и передаются только адресатам (Telegram Bot API / ваш webhook).
              У CRYPTORA нет сервера-посредника. Это не ключи бирж — только уведомления.
            </p>

            <section className="p-3 rounded-md border border-surface-border bg-surface-elevated/70 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <Bell className="w-3.5 h-3.5" /> Браузерные уведомления
                </div>
                <span className="text-[11px] font-mono text-slate-400">
                  {typeof Notification === 'undefined' ? 'НЕДОСТУПНО' : Notification.permission.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={requestBrowserPermission} className="px-2.5 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-200">
                  Запросить разрешение
                </button>
                <label className="flex items-center gap-1.5 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={draft.browser.enabled}
                    onChange={(e) => setDraft((d) => ({ ...d, browser: { enabled: e.target.checked } }))}
                  />
                  Включить
                </label>
              </div>
            </section>

            <section className="p-3 rounded-md border border-surface-border bg-surface-elevated/70 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5" /> Telegram
                </div>
                <label className="flex items-center gap-1.5 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={draft.telegram.enabled}
                    onChange={(e) => setDraft((d) => ({ ...d, telegram: { ...d.telegram, enabled: e.target.checked } }))}
                  />
                  Включить
                </label>
              </div>
              <p className="text-[11px] text-slate-500 font-sans">
                Создайте бота через @BotFather, напишите ему /start и укажите токен и chat id. Токен отправляется напрямую в api.telegram.org.
              </p>
              <input
                type="password"
                autoComplete="off"
                placeholder="Bot token (123456789:AA...)"
                value={draft.telegram.botToken}
                onChange={(e) => setDraft((d) => ({ ...d, telegram: { ...d.telegram, botToken: e.target.value } }))}
                className={`${inputCls} font-mono`}
                data-qa="tg-token"
              />
              <input
                type="text"
                placeholder="Chat id"
                value={draft.telegram.chatId}
                onChange={(e) => setDraft((d) => ({ ...d, telegram: { ...d.telegram, chatId: e.target.value } }))}
                className={`${inputCls} font-mono`}
                data-qa="tg-chat"
              />
              <div className="text-[11px] font-mono text-slate-500">
                {draft.telegram.botToken
                  ? isPlausibleBotToken(draft.telegram.botToken)
                    ? `токен ${maskToken(draft.telegram.botToken)} — формат корректен`
                    : 'формат токена не распознан'
                  : 'токен не задан'}
              </div>
            </section>

            <section className="p-3 rounded-md border border-surface-border bg-surface-elevated/70 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <Webhook className="w-3.5 h-3.5" /> Webhook
                </div>
                <label className="flex items-center gap-1.5 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={draft.webhook.enabled}
                    onChange={(e) => setDraft((d) => ({ ...d, webhook: { ...d.webhook, enabled: e.target.checked } }))}
                  />
                  Включить
                </label>
              </div>
              <p className="text-[11px] text-slate-500 font-sans">
                POST JSON <span className="font-mono">cryptora.alert.v1</span>. Если endpoint не отдаёт CORS-заголовки, запрос уходит в режиме no-cors и
                помечается «ОТПРАВЛЕНО (БЕЗ ПОДТВЕРЖДЕНИЯ)».
              </p>
              <input
                type="url"
                placeholder="https://example.com/hooks/cryptora"
                value={draft.webhook.url}
                onChange={(e) => setDraft((d) => ({ ...d, webhook: { ...d.webhook, url: e.target.value } }))}
                className={`${inputCls} font-mono`}
                data-qa="wh-url"
              />
              {draft.webhook.url && !isValidWebhookUrl(draft.webhook.url) && (
                <div className="text-[11px] text-rose-400">Некорректный URL.</div>
              )}
            </section>

            <button
              type="button"
              onClick={saveChannels}
              data-qa="channels-save"
              className="w-full py-2 bg-brand-cyan hover:bg-sky-500 text-slate-950 font-semibold text-xs rounded transition-colors"
            >
              Сохранить каналы
            </button>
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-surface-border text-right">
          <button onClick={closeAlertsModal} className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded transition-colors">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
