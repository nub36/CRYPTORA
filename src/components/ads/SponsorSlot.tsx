import React from 'react';
import { Megaphone, ExternalLink } from 'lucide-react';
import { activePlacements, type SlotId } from '@/services/ads/SponsorSlots';

/** Рендерит партнёрский слот; при отсутствии активных размещений возвращает null (ничего не занимает). */
export const SponsorSlot: React.FC<{ slot: SlotId; className?: string }> = ({ slot, className = '' }) => {
  const items = activePlacements(slot);
  if (items.length === 0) return null;
  return (
    <div className={`space-y-2 ${className}`} data-qa="sponsor-slot" data-slot={slot}>
      {items.map((p) => (
        <a
          key={p.id}
          href={p.href}
          target="_blank"
          rel="sponsored noopener noreferrer"
          className="block bg-surface border border-amber-500/30 rounded-lg p-3 font-sans hover:border-amber-400/50 transition-colors"
        >
          <div className="flex items-center justify-between text-[11px] text-amber-300 mb-1">
            <span className="inline-flex items-center gap-1 font-bold tracking-wide">
              <Megaphone className="w-3 h-3" /> Sponsored / Partner
            </span>
            <span className="text-slate-500">{p.partner}</span>
          </div>
          <div className="text-sm font-bold text-white">{p.title}</div>
          <p className="text-xs text-slate-400 leading-relaxed mt-0.5">{p.text}</p>
          <div className="text-[11px] text-slate-500 mt-1.5 inline-flex items-center gap-1">
            Партнёрский материал, не рекомендация CRYPTORA <ExternalLink className="w-3 h-3" />
          </div>
        </a>
      ))}
    </div>
  );
};
