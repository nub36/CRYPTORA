import { z } from 'zod';
import raw from '../../../content/sponsor-slots.json' with { type: 'json' };

/**
 * Партнёрские слоты (ROADMAP п. 7, решение владельца): статичный JSON в репозитории, без внешних ad-сетей,
 * трекеров и скриптов. Каждый показ помечен «Sponsored / Partner» (docs/MONETIZATION.md). Пустой конфиг → ничего не рендерится.
 */
export const SLOT_IDS = ['overview-sidebar', 'articles-list', 'footer-banner'] as const;
export type SlotId = (typeof SLOT_IDS)[number];

const PlacementSchema = z.object({
  id: z.string().min(1),
  slot: z.enum(SLOT_IDS),
  title: z.string().min(1).max(80),
  text: z.string().min(1).max(240),
  href: z.string().url().startsWith('https://'),
  partner: z.string().min(1).max(60),
  activeFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  activeTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const ConfigSchema = z.object({ placements: z.array(PlacementSchema) });
export type SponsorPlacement = z.infer<typeof PlacementSchema>;

const FORBIDDEN = /прибыльн|гарантир|доходност|лучший сигнал|100%|без риска|x\d+|\d+x\b/i;

export function loadPlacements(input: unknown = raw): SponsorPlacement[] {
  const parsed = ConfigSchema.safeParse(input);
  if (!parsed.success) return [];
  return parsed.data.placements;
}

/** Активные слоты на дату; тексты с запрещёнными обещаниями отфильтровываются (страховка от партнёрского копирайта). */
export function activePlacements(slot: SlotId, now: Date = new Date(), all: SponsorPlacement[] = loadPlacements()): SponsorPlacement[] {
  const day = now.toISOString().slice(0, 10);
  return all.filter((p) => p.slot === slot && p.activeFrom <= day && day <= p.activeTo && !FORBIDDEN.test(`${p.title} ${p.text}`));
}
