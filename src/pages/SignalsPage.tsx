import React from 'react';
import { BarChart3, AlertOctagon, CheckCircle2, Shield } from 'lucide-react';
import { Badge } from '@/components/common/Badge';

export const SignalsPage: React.FC = () => {
  return (
    <div className="space-y-6 max-w-[1920px] mx-auto px-3 sm:px-4 py-3">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <BarChart3 className="w-5 h-5 text-brand-cyan" />
            <h1 className="text-lg sm:text-xl font-bold font-mono text-white tracking-wide">
              АНАЛИТИЧЕСКИЕ СЕТАПЫ И СИГНАЛЫ (SIGNALS)
            </h1>
            <Badge variant="amber" size="sm">
              ПРОТОТИП МЕТОДОЛОГИИ
            </Badge>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Прозрачные алгоритмические структуры с неизменяемым журналом аудита и фиксацией факторов отмены.
          </p>
        </div>

        <div className="text-xs font-mono text-rose-400 bg-rose-500/10 px-2.5 py-1 rounded border border-rose-500/30">
          НЕ ЯВЛЯЕТСЯ ФИНАНСОВОЙ РЕКОМЕНДАЦИЕЙ
        </div>
      </div>

      {/* Ethical Code Banner */}
      <div className="p-4 bg-surface border border-surface-border rounded-lg text-xs font-sans text-slate-300 space-y-2">
        <div className="flex items-center space-x-2 text-white font-mono font-bold">
          <Shield className="w-4 h-4 text-brand-green" />
          <span>Кодекс прозрачности сигналов CRYPTORA</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 text-[11px] text-slate-400">
          <div>
            <strong className="text-white block mb-0.5 font-mono">1. Неизменяемый журнал:</strong>
            Выпущенный сетап фиксируется криптографическим хэшем в неизменяемом логе. Ни один сигнал нельзя удалить или отредактировать задним числом.
          </div>
          <div>
            <strong className="text-white block mb-0.5 font-mono">2. Честная статистика:</strong>
            Убыточные сделки и ложные срабатывания учитываются в расчете винрейта на 100%. Мы никогда не заявляем нереалистичные «98% точности».
          </div>
          <div>
            <strong className="text-white block mb-0.5 font-mono">3. Опровергающие аргументы:</strong>
            Каждый сетап обязан содержать не только подтверждающие факты, но и риски/опровергающие сигналы других индикаторов.
          </div>
        </div>
      </div>

      {/* Sample Structured Analytical Setups (Demo) */}
      <div className="space-y-4">
        <div className="text-xs font-mono text-slate-400 uppercase tracking-wider font-bold">
          Примеры формализованных сетапов (Архитектурный шаблон)
        </div>

        {/* Setup Card 1 */}
        <div className="bg-surface border border-surface-border rounded-lg p-5 font-mono text-xs space-y-4 shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
            <div className="flex items-center space-x-3">
              <span className="text-base font-bold text-white">BTC/USDT</span>
              <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                4h Timeframe
              </span>
              <Badge variant="green" size="sm">
                LONG IDEA DEMO
              </Badge>
            </div>
            <div className="text-[11px] text-slate-500">
              Strategy: <strong>Momentum + Negative Funding v1.2</strong>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-surface-elevated/70 p-3 rounded border border-surface-border">
              <div className="text-[11px] text-slate-400">Диапазон входа</div>
              <div className="text-sm font-bold text-white mt-0.5">$64,200 – $64,800</div>
            </div>
            <div className="bg-surface-elevated/70 p-3 rounded border border-surface-border">
              <div className="text-[11px] text-slate-400">Уровень отмены (Stop)</div>
              <div className="text-sm font-bold text-rose-400 mt-0.5">&lt; $62,900 (-2.4%)</div>
            </div>
            <div className="bg-surface-elevated/70 p-3 rounded border border-surface-border">
              <div className="text-[11px] text-slate-400">Целевой ориентир</div>
              <div className="text-sm font-bold text-brand-green mt-0.5">$68,500 (+6.1%)</div>
            </div>
          </div>

          {/* Evidence Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 font-sans text-xs">
            <div className="p-3 rounded bg-emerald-950/20 border border-emerald-500/20 space-y-1.5">
              <div className="font-bold text-emerald-400 font-mono flex items-center space-x-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Подтверждающие наблюдения (Supporting Evidence)</span>
              </div>
              <ul className="list-disc list-inside text-slate-300 text-[11px] space-y-0.5">
                <li>Открытый интерес (OI) за 1 час вырос на +7.2% на фоне локального пробоя $64.5k.</li>
                <li>Каскад шорт-ликвидаций на $48.9M создал сильный топливный импульс.</li>
                <li>Цена закрепилась выше дневной SMA-50.</li>
              </ul>
            </div>

            <div className="p-3 rounded bg-rose-950/20 border border-rose-500/20 space-y-1.5">
              <div className="font-bold text-rose-400 font-mono flex items-center space-x-1.5">
                <AlertOctagon className="w-3.5 h-3.5" />
                <span>Опровергающие факторы (Opposing Evidence / Risk)</span>
              </div>
              <ul className="list-disc list-inside text-slate-300 text-[11px] space-y-0.5">
                <li>RSI-14 подошел к верхней границе перекупленности (68.4).</li>
                <li>Приближение к зоне макро-сопротивления $65,500.</li>
                <li>Возможный откат спотового спроса после закрытия сессии.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Setup Card 2 */}
        <div className="bg-surface border border-surface-border rounded-lg p-5 font-mono text-xs space-y-4 shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-surface-border gap-2">
            <div className="flex items-center space-x-3">
              <span className="text-base font-bold text-white">SUI/USDT</span>
              <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                1h Timeframe
              </span>
              <Badge variant="purple" size="sm">
                SHORT SQUEEZE ALERT
              </Badge>
            </div>
            <div className="text-[11px] text-slate-500">
              Strategy: <strong>Extreme Negative Funding v2.0</strong>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-surface-elevated/70 p-3 rounded border border-surface-border">
              <div className="text-[11px] text-slate-400">Наблюдаемая зона</div>
              <div className="text-sm font-bold text-white mt-0.5">$1.58 – $1.62</div>
            </div>
            <div className="bg-surface-elevated/70 p-3 rounded border border-surface-border">
              <div className="text-[11px] text-slate-400">Ставка финансирования</div>
              <div className="text-sm font-bold text-purple-400 mt-0.5">-0.0185% (Отрицательная)</div>
            </div>
            <div className="bg-surface-elevated/70 p-3 rounded border border-surface-border">
              <div className="text-[11px] text-slate-400">Дельта OI за 24h</div>
              <div className="text-sm font-bold text-brand-green mt-0.5">+24.5% ($540M)</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
