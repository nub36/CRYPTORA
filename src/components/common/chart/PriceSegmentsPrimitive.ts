import type {
  ISeriesPrimitive,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { ChartPriceSegment, ChartPriceSegmentStyle } from '@/types/chart';

interface RenderSegment {
  left: number;
  right: number;
  y: number;
  color: string;
  style: ChartPriceSegmentStyle;
  lineWidth: 1 | 2 | 3 | 4;
}

function dash(style: ChartPriceSegmentStyle): number[] {
  switch (style) {
    case 'dashed': return [6, 4];
    case 'dotted': return [2, 3];
    case 'largeDashed': return [10, 6];
    case 'sparseDotted': return [2, 6];
    default: return [];
  }
}

class PriceSegmentsRenderer implements ISeriesPrimitivePaneRenderer {
  private segments: readonly RenderSegment[] = [];

  setSegments(segments: readonly RenderSegment[]): void {
    this.segments = segments;
  }

  draw(target: CanvasRenderingTarget2D): void {
    if (this.segments.length === 0) return;
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      for (const segment of this.segments) {
        const left = Math.round(Math.min(segment.left, segment.right) * horizontalPixelRatio);
        const right = Math.round(Math.max(segment.left, segment.right) * horizontalPixelRatio);
        const y = Math.round(segment.y * verticalPixelRatio) + 0.5;
        context.save();
        context.strokeStyle = segment.color;
        context.lineWidth = Math.max(1, Math.round(segment.lineWidth * Math.min(horizontalPixelRatio, verticalPixelRatio)));
        context.setLineDash(dash(segment.style).map((value) => Math.round(value * horizontalPixelRatio)));
        context.beginPath();
        context.moveTo(left, y);
        context.lineTo(right, y);
        context.stroke();
        context.restore();
      }
    });
  }
}

class PriceSegmentsPaneView implements ISeriesPrimitivePaneView {
  private readonly paneRenderer = new PriceSegmentsRenderer();

  update(segments: readonly RenderSegment[]): void {
    this.paneRenderer.setSegments(segments);
  }

  zOrder(): 'bottom' {
    return 'bottom';
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    return this.paneRenderer;
  }
}

/** Generic finite price/time segments. The chart remains domain-agnostic. */
export class PriceSegmentsPrimitive implements ISeriesPrimitive<Time> {
  private segments: readonly ChartPriceSegment[] = [];
  private attachedParams: SeriesAttachedParameter<Time> | null = null;
  private readonly view = new PriceSegmentsPaneView();

  constructor(segments: readonly ChartPriceSegment[] = []) {
    this.segments = segments;
  }

  attached(params: SeriesAttachedParameter<Time>): void {
    this.attachedParams = params;
    this.updateAllViews();
  }

  detached(): void {
    this.attachedParams = null;
    this.view.update([]);
  }

  setSegments(segments: readonly ChartPriceSegment[]): void {
    this.segments = segments;
    this.updateAllViews();
    this.attachedParams?.requestUpdate();
  }

  updateAllViews(): void {
    const params = this.attachedParams;
    if (!params) return;
    const renderSegments: RenderSegment[] = [];
    for (const segment of this.segments) {
      const left = params.chart.timeScale().timeToCoordinate(segment.fromTime as Time);
      const right = params.chart.timeScale().timeToCoordinate(segment.toTime as Time);
      const y = params.series.priceToCoordinate(segment.price);
      if (left === null || right === null || y === null) continue;
      if (![left, right, y].every(Number.isFinite)) continue;
      renderSegments.push({
        left,
        right,
        y,
        color: segment.color,
        style: segment.style ?? 'solid',
        lineWidth: segment.lineWidth ?? 1,
      });
    }
    this.view.update(renderSegments);
  }

  paneViews(): readonly ISeriesPrimitivePaneView[] {
    return [this.view];
  }
}
