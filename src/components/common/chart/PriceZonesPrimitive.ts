import type {
  ISeriesPrimitive,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { ChartPriceZone } from '@/types/chart';

interface RenderZone {
  left: number;
  right: number;
  top: number;
  bottom: number;
  fillColor: string;
  borderColor: string;
}

class PriceZonesRenderer implements ISeriesPrimitivePaneRenderer {
  private zones: readonly RenderZone[] = [];

  setZones(zones: readonly RenderZone[]): void {
    this.zones = zones;
  }

  draw(target: CanvasRenderingTarget2D): void {
    if (this.zones.length === 0) return;
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      for (const zone of this.zones) {
        const left = Math.round(Math.min(zone.left, zone.right) * horizontalPixelRatio);
        const right = Math.round(Math.max(zone.left, zone.right) * horizontalPixelRatio);
        const top = Math.round(Math.min(zone.top, zone.bottom) * verticalPixelRatio);
        const bottom = Math.round(Math.max(zone.top, zone.bottom) * verticalPixelRatio);
        const width = Math.max(1, right - left);
        const height = Math.max(1, bottom - top);

        context.save();
        context.fillStyle = zone.fillColor;
        context.fillRect(left, top, width, height);
        context.strokeStyle = zone.borderColor;
        context.lineWidth = Math.max(1, Math.round(Math.min(horizontalPixelRatio, verticalPixelRatio)));
        context.strokeRect(left + 0.5, top + 0.5, Math.max(0, width - 1), Math.max(0, height - 1));
        context.restore();
      }
    });
  }
}

class PriceZonesPaneView implements ISeriesPrimitivePaneView {
  private readonly paneRenderer = new PriceZonesRenderer();

  update(zones: readonly RenderZone[]): void {
    this.paneRenderer.setZones(zones);
  }

  zOrder(): 'bottom' {
    return 'bottom';
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    return this.paneRenderer;
  }
}

/**
 * A generic, reusable price-zone primitive. It owns no Order Block semantics:
 * callers pass only generic time/price rectangles. The lightweight-charts
 * primitive lifecycle recalculates coordinates as the time/price scales pan,
 * zoom, resize, or otherwise update.
 */
export class PriceZonesPrimitive implements ISeriesPrimitive<Time> {
  private zones: readonly ChartPriceZone[] = [];
  private attachedParams: SeriesAttachedParameter<Time> | null = null;
  private readonly view = new PriceZonesPaneView();

  constructor(zones: readonly ChartPriceZone[] = []) {
    this.zones = zones;
  }

  attached(params: SeriesAttachedParameter<Time>): void {
    this.attachedParams = params;
    this.updateAllViews();
  }

  detached(): void {
    this.attachedParams = null;
    this.view.update([]);
  }

  setZones(zones: readonly ChartPriceZone[]): void {
    this.zones = zones;
    this.updateAllViews();
    this.attachedParams?.requestUpdate();
  }

  updateAllViews(): void {
    const params = this.attachedParams;
    if (!params) return;

    const renderZones: RenderZone[] = [];
    for (const zone of this.zones) {
      const left = params.chart.timeScale().timeToCoordinate(zone.fromTime as Time);
      const right = params.chart.timeScale().timeToCoordinate(zone.toTime as Time);
      const top = params.series.priceToCoordinate(zone.high);
      const bottom = params.series.priceToCoordinate(zone.low);
      if (left === null || right === null || top === null || bottom === null) continue;
      if (![left, right, top, bottom].every(Number.isFinite)) continue;
      renderZones.push({ left, right, top, bottom, fillColor: zone.fillColor, borderColor: zone.borderColor });
    }
    this.view.update(renderZones);
  }

  paneViews(): readonly ISeriesPrimitivePaneView[] {
    return [this.view];
  }
}
