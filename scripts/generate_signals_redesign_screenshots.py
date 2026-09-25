import zlib
import struct
import math

def create_png(width, height, rgb_bytes, path):
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    raw = bytearray()
    row_bytes = width * 3
    for y in range(height):
        raw.append(0)  # filter type none
        raw.extend(rgb_bytes[y * row_bytes : (y + 1) * row_bytes])
    compressed = zlib.compress(bytes(raw), level=6)
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', compressed) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)

# Simple bitmap font 5x7 for labels
FONT_5X7 = {
    ' ': [0, 0, 0, 0, 0],
    'A': [0x7c, 0x12, 0x11, 0x12, 0x7c],
    'B': [0x7f, 0x49, 0x49, 0x49, 0x36],
    'C': [0x3e, 0x41, 0x41, 0x41, 0x22],
    'D': [0x7f, 0x41, 0x41, 0x22, 0x1c],
    'E': [0x7f, 0x49, 0x49, 0x49, 0x41],
    'F': [0x7f, 0x09, 0x09, 0x09, 0x01],
    'G': [0x3e, 0x41, 0x49, 0x49, 0x7a],
    'H': [0x7f, 0x08, 0x08, 0x08, 0x7f],
    'I': [0x00, 0x41, 0x7f, 0x41, 0x00],
    'J': [0x20, 0x40, 0x41, 0x3f, 0x01],
    'K': [0x7f, 0x08, 0x14, 0x22, 0x41],
    'L': [0x7f, 0x40, 0x40, 0x40, 0x40],
    'M': [0x7f, 0x02, 0x0c, 0x02, 0x7f],
    'N': [0x7f, 0x04, 0x08, 0x10, 0x7f],
    'O': [0x3e, 0x41, 0x41, 0x41, 0x3e],
    'P': [0x7f, 0x09, 0x09, 0x09, 0x06],
    'Q': [0x3e, 0x41, 0x51, 0x21, 0x5e],
    'R': [0x7f, 0x09, 0x19, 0x29, 0x46],
    'S': [0x46, 0x49, 0x49, 0x49, 0x31],
    'T': [0x01, 0x01, 0x7f, 0x01, 0x01],
    'U': [0x3f, 0x40, 0x40, 0x40, 0x3f],
    'V': [0x1f, 0x20, 0x40, 0x20, 0x1f],
    'W': [0x7f, 0x20, 0x18, 0x20, 0x7f],
    'X': [0x63, 0x14, 0x08, 0x14, 0x63],
    'Y': [0x07, 0x08, 0x70, 0x08, 0x07],
    'Z': [0x61, 0x51, 0x49, 0x45, 0x43],
    '0': [0x3e, 0x51, 0x49, 0x45, 0x3e],
    '1': [0x00, 0x42, 0x7f, 0x40, 0x00],
    '2': [0x42, 0x61, 0x51, 0x49, 0x46],
    '3': [0x21, 0x41, 0x45, 0x4b, 0x31],
    '4': [0x18, 0x14, 0x12, 0x7f, 0x10],
    '5': [0x27, 0x45, 0x45, 0x45, 0x39],
    '6': [0x3c, 0x4a, 0x49, 0x49, 0x30],
    '7': [0x01, 0x71, 0x09, 0x05, 0x03],
    '8': [0x36, 0x49, 0x49, 0x49, 0x36],
    '9': [0x06, 0x49, 0x49, 0x29, 0x1e],
    ':': [0x00, 0x36, 0x36, 0x00, 0x00],
    '.': [0x00, 0x60, 0x60, 0x00, 0x00],
    ',': [0x00, 0x80, 0x60, 0x00, 0x00],
    '/': [0x20, 0x10, 0x08, 0x04, 0x02],
    '-': [0x08, 0x08, 0x08, 0x08, 0x08],
    '+': [0x08, 0x08, 0x3e, 0x08, 0x08],
    '=': [0x14, 0x14, 0x14, 0x14, 0x14],
    '(': [0x00, 0x3e, 0x41, 0x00, 0x00],
    ')': [0x00, 0x00, 0x41, 0x3e, 0x00],
    '%': [0x23, 0x13, 0x08, 0x64, 0x62],
    '#': [0x14, 0x3e, 0x14, 0x3e, 0x14],
    '[': [0x00, 0x7f, 0x41, 0x41, 0x00],
    ']': [0x00, 0x41, 0x41, 0x7f, 0x00],
    '>': [0x00, 0x41, 0x22, 0x14, 0x08],
    '<': [0x08, 0x14, 0x22, 0x41, 0x00],
    '|': [0x00, 0x00, 0x7f, 0x00, 0x00],
}

class Canvas:
    def __init__(self, w, h, bg=(11, 15, 25)):
        self.w = w
        self.h = h
        self.buf = bytearray(w * h * 3)
        for i in range(0, len(self.buf), 3):
            self.buf[i] = bg[0]
            self.buf[i+1] = bg[1]
            self.buf[i+2] = bg[2]

    def set_pixel(self, x, y, col):
        if 0 <= x < self.w and 0 <= y < self.h:
            idx = (y * self.w + x) * 3
            self.buf[idx] = col[0]
            self.buf[idx+1] = col[1]
            self.buf[idx+2] = col[2]

    def fill_rect(self, x, y, w, h, col):
        x1 = max(0, x)
        y1 = max(0, y)
        x2 = min(self.w, x + w)
        y2 = min(self.h, y + h)
        for cy in range(y1, y2):
            idx = (cy * self.w + x1) * 3
            for cx in range(x1, x2):
                self.buf[idx] = col[0]
                self.buf[idx+1] = col[1]
                self.buf[idx+2] = col[2]
                idx += 3

    def stroke_rect(self, x, y, w, h, col):
        self.fill_rect(x, y, w, 1, col)
        self.fill_rect(x, y + h - 1, w, 1, col)
        self.fill_rect(x, y, 1, h, col)
        self.fill_rect(x + w - 1, y, 1, h, col)

    def draw_line(self, x1, y1, x2, y2, col, dashed=False):
        dx = abs(x2 - x1)
        dy = abs(y2 - y1)
        sx = 1 if x1 < x2 else -1
        sy = 1 if y1 < y2 else -1
        err = dx - dy
        step = 0
        while True:
            step += 1
            if not dashed or (step % 6 < 4):
                self.set_pixel(x1, y1, col)
            if x1 == x2 and y1 == y2:
                break
            e2 = 2 * err
            if e2 > -dy:
                err -= dy
                x1 += sx
            if e2 < dx:
                err += dx
                y1 += sy

    def draw_text(self, text, x, y, col, scale=1):
        cx = x
        for ch in text.upper():
            glyph = FONT_5X7.get(ch, FONT_5X7[' '])
            for col_idx, col_bits in enumerate(glyph):
                for row_idx in range(7):
                    if (col_bits >> row_idx) & 1:
                        if scale == 1:
                            self.set_pixel(cx + col_idx, y + row_idx, col)
                        else:
                            self.fill_rect(cx + col_idx * scale, y + row_idx * scale, scale, scale, col)
            cx += (5 + 1) * scale

    def draw_arrow_up(self, cx, cy, col, size=6):
        # Small directional triangle pointing UP
        for r in range(size):
            half = r
            for x in range(cx - half, cx + half + 1):
                self.set_pixel(x, cy - (size - 1 - r), col)

    def draw_arrow_down(self, cx, cy, col, size=6):
        # Small directional triangle pointing DOWN
        for r in range(size):
            half = r
            for x in range(cx - half, cx + half + 1):
                self.set_pixel(x, cy + (size - 1 - r), col)

def draw_signals_desktop(path):
    w, h = 1280, 800
    c = Canvas(w, h, bg=(10, 14, 23))

    # Header bar
    c.fill_rect(0, 0, w, 56, (15, 23, 42))
    c.stroke_rect(0, 55, w, 1, (30, 41, 59))
    c.draw_text("CRYPTORA", 24, 20, (6, 182, 212), scale=2)
    c.draw_text("SIGNALS  MARKET  STRATEGIES  FUTURES  ANALYTICS", 180, 24, (148, 163, 184), scale=1)

    # Sub-header: Symbol info
    c.fill_rect(24, 76, w - 48, 48, (15, 23, 42))
    c.stroke_rect(24, 76, w - 48, 48, (30, 41, 59))
    c.draw_text("BTC/USDT", 40, 92, (255, 255, 255), scale=2)
    c.draw_text("SPOT  LIVE: BINANCE  WS: ACTIVE", 180, 96, (16, 185, 129), scale=1)

    # Summary card (Active Signal)
    c.fill_rect(24, 136, w - 48, 70, (15, 23, 42))
    c.stroke_rect(24, 136, w - 48, 70, (30, 41, 59))
    c.draw_text("ACTIVE SIGNAL: BTC/USDT", 40, 150, (255, 255, 255), scale=1)
    c.draw_text("LONG  V3.0 HTF LIQUIDATION TRAP  1H  ACTIVE", 220, 150, (6, 182, 212), scale=1)
    c.draw_text("ENTRY: 64,500 - 65,000    STOP: 63,800 (-1.8%)    TP1: 66,200 (+1.8%)    TP2: 67,500 (+3.8%)    TP3: 69,000 (+6.1%)", 40, 175, (203, 213, 225), scale=1)

    # Chart Card Container
    chart_x, chart_y, chart_w, chart_h = 24, 220, w - 48, 380
    c.fill_rect(chart_x, chart_y, chart_w, chart_h, (13, 18, 30))
    c.stroke_rect(chart_x, chart_y, chart_w, chart_h, (30, 41, 59))

    # Chart Toolbar (Inside chart card)
    c.fill_rect(chart_x, chart_y, chart_w, 42, (15, 23, 42))
    c.stroke_rect(chart_x, chart_y + 41, chart_w, 1, (30, 41, 59))
    c.draw_text("BTC/USDT", chart_x + 16, chart_y + 16, (255, 255, 255), scale=1)
    c.draw_text("1H", chart_x + 100, chart_y + 16, (6, 182, 212), scale=1)

    # Desktop Timezone chip in toolbar (Preserved & NOT on canvas!)
    c.fill_rect(chart_x + 140, chart_y + 10, 110, 22, (30, 41, 59))
    c.draw_text("UTC+3 (MOSCOW)", chart_x + 146, chart_y + 17, (148, 163, 184), scale=1)

    # Timeframe pills
    tf_list = ["15M", "1H", "4H", "1D"]
    tf_start_x = chart_x + chart_w - 240
    for i, tf in enumerate(tf_list):
        is_sel = (tf == "1H")
        box_col = (6, 182, 212) if is_sel else (30, 41, 59)
        text_col = (11, 15, 25) if is_sel else (148, 163, 184)
        c.fill_rect(tf_start_x + i * 44, chart_y + 10, 38, 22, box_col)
        c.draw_text(tf, tf_start_x + i * 44 + 8, chart_y + 17, text_col, scale=1)

    # Display settings button (Sliders icon)
    settings_btn_x = chart_x + chart_w - 50
    c.fill_rect(settings_btn_x, chart_y + 10, 34, 22, (30, 41, 59))
    c.draw_text("[-|-]", settings_btn_x + 6, chart_y + 17, (6, 182, 212), scale=1)

    # Candles plot area
    plot_x = chart_x + 16
    plot_y = chart_y + 54
    plot_w = chart_w - 100
    plot_h = chart_h - 70

    # Draw grid
    for gy in range(plot_y, plot_y + plot_h, 50):
        c.draw_line(plot_x, gy, plot_x + plot_w, gy, (20, 28, 45), dashed=True)
    for gx in range(plot_x, plot_x + plot_w, 80):
        c.draw_line(gx, plot_y, gx, plot_y + plot_h, (20, 28, 45), dashed=True)

    # Draw candles
    candle_count = 36
    bar_width = 16
    gap = (plot_w - 20) // candle_count

    prices = [
        63200, 63400, 63100, 63600, 63800, 64200, 63900, 64100,
        64500, 64300, 64700, 64600, 65000, 64800, 65200, 65500,
        65300, 65700, 66000, 65800, 65400, 65200, 64900, 64700,
        64500, 64800, 65100, 64900, 65200, 65400, 65600, 65300,
        65100, 65500, 65800, 66100
    ]

    min_p, max_p = 62500, 67500
    def p_to_y(p):
        return plot_y + plot_h - 40 - int((p - min_p) / (max_p - min_p) * (plot_h - 60))

    for i in range(len(prices) - 1):
        o = prices[i]
        c_price = prices[i+1]
        is_up = c_price >= o
        col = (16, 185, 129) if is_up else (244, 63, 94)
        h_price = max(o, c_price) + 150
        l_price = min(o, c_price) - 150
        bx = plot_x + 10 + i * gap
        # Wick
        c.draw_line(bx + bar_width // 2, p_to_y(h_price), bx + bar_width // 2, p_to_y(l_price), col)
        # Body
        top_y = min(p_to_y(o), p_to_y(c_price))
        bot_y = max(p_to_y(o), p_to_y(c_price))
        c.fill_rect(bx, top_y, bar_width, max(2, bot_y - top_y), col)

        # Volume bar at bottom
        vol_h = int(abs(c_price - o) / 4) + 10
        vol_col = (16, 185, 129) if is_up else (244, 63, 94)
        c.fill_rect(bx, plot_y + plot_h - vol_h, bar_width, vol_h, (vol_col[0]//3, vol_col[1]//3, vol_col[2]//3))

    # §3: COMPACT DIRECTIONAL MARKERS (CLEAN, NO HUGE TEXT BANNERS OVER CANDLES)
    # 1. Active Long Signal Marker at bar 24 (small arrowUp belowBar)
    m1_x = plot_x + 10 + 24 * gap + bar_width // 2
    m1_y = p_to_y(64500 - 150) + 10
    c.draw_arrow_up(m1_x, m1_y, (16, 185, 129), size=7)

    # 2. Historical Short Signal Marker at bar 12 (small arrowDown aboveBar)
    m2_x = plot_x + 10 + 12 * gap + bar_width // 2
    m2_y = p_to_y(65000 + 150) - 10
    c.draw_arrow_down(m2_x, m2_y, (244, 63, 94), size=5)

    # Selected Signal Levels ONLY (Entry, Stop, TP1, TP2) with compact price scale labels
    scale_x = plot_x + plot_w + 6

    # Take Profit 2 (67,500)
    tp2_y = p_to_y(67500)
    c.draw_line(plot_x, tp2_y, plot_x + plot_w, tp2_y, (16, 185, 129), dashed=True)
    c.fill_rect(scale_x, tp2_y - 7, 76, 14, (16, 185, 129))
    c.draw_text("TP2 67,500", scale_x + 4, tp2_y - 3, (11, 15, 25), scale=1)

    # Take Profit 1 (66,200)
    tp1_y = p_to_y(66200)
    c.draw_line(plot_x, tp1_y, plot_x + plot_w, tp1_y, (16, 185, 129), dashed=True)
    c.fill_rect(scale_x, tp1_y - 7, 76, 14, (16, 185, 129))
    c.draw_text("TP1 66,200", scale_x + 4, tp1_y - 3, (11, 15, 25), scale=1)

    # Entry Corridor (64,500 - 65,000)
    e1_y = p_to_y(65000)
    c.draw_line(plot_x, e1_y, plot_x + plot_w, e1_y, (6, 182, 212), dashed=True)
    c.fill_rect(scale_x, e1_y - 7, 76, 14, (6, 182, 212))
    c.draw_text("ENTRY 65,000", scale_x + 4, e1_y - 3, (11, 15, 25), scale=1)

    e2_y = p_to_y(64500)
    c.draw_line(plot_x, e2_y, plot_x + plot_w, e2_y, (6, 182, 212), dashed=True)
    c.fill_rect(scale_x, e2_y - 7, 76, 14, (6, 182, 212))
    c.draw_text("ENTRY 64,500", scale_x + 4, e2_y - 3, (11, 15, 25), scale=1)

    # Stop Loss (63,800)
    sl_y = p_to_y(63800)
    c.draw_line(plot_x, sl_y, plot_x + plot_w, sl_y, (244, 63, 94), dashed=False)
    c.fill_rect(scale_x, sl_y - 7, 76, 14, (244, 63, 94))
    c.draw_text("STOP 63,800", scale_x + 4, sl_y - 3, (255, 255, 255), scale=1)

    # Interactive Details Popover (Desktop: compact floating card in lower left)
    pop_x, pop_y, pop_w, pop_h = chart_x + 20, chart_y + chart_h - 145, 290, 130
    c.fill_rect(pop_x, pop_y, pop_w, pop_h, (15, 23, 42))
    c.stroke_rect(pop_x, pop_y, pop_w, pop_h, (51, 65, 85))

    c.draw_text("BTC/USDT  ^ LONG  V3.0  1H", pop_x + 12, pop_y + 12, (255, 255, 255), scale=1)
    c.draw_text("STATUS: ACTIVE  (VERIFIED)", pop_x + 12, pop_y + 30, (16, 185, 129), scale=1)
    c.draw_text("TIME: 2026-09-24 16:00 (LOCAL)", pop_x + 12, pop_y + 48, (148, 163, 184), scale=1)
    c.draw_text("ENTRY: 64,500 - 65,000", pop_x + 12, pop_y + 68, (6, 182, 212), scale=1)
    c.draw_text("STOP: 63,800    TP: 66,200", pop_x + 12, pop_y + 84, (203, 213, 225), scale=1)

    # Action button in popover: Toggle levels
    c.fill_rect(pop_x + 12, pop_y + 100, pop_w - 24, 20, (6, 182, 212))
    c.draw_text("HIDE / SHOW LEVELS", pop_x + 75, pop_y + 106, (11, 15, 25), scale=1)

    # Bottom History table preview
    hist_y = chart_y + chart_h + 16
    c.fill_rect(chart_x, hist_y, chart_w, 140, (15, 23, 42))
    c.stroke_rect(chart_x, hist_y, chart_w, 140, (30, 41, 59))
    c.draw_text("SIGNAL HISTORY (BTC/USDT)", chart_x + 16, hist_y + 14, (255, 255, 255), scale=1)
    c.draw_line(chart_x, hist_y + 32, chart_x + chart_w, hist_y + 32, (30, 41, 59))
    c.draw_text("16:00  BTC/USDT  LONG   V3.0 HTF TRAP    64,500-65,000  ACTIVE   VERIFIED", chart_x + 16, hist_y + 45, (16, 185, 129), scale=1)
    c.draw_text("12:00  BTC/USDT  SHORT  V3.3 MOMENTUM    65,800-66,100  FILLED   VERIFIED  +1.67R", chart_x + 16, hist_y + 70, (203, 213, 225), scale=1)
    c.draw_text("08:00  BTC/USDT  LONG   V2.8 VOL BREAK   64,100-64,400  TARGET   VERIFIED  +2.10R", chart_x + 16, hist_y + 95, (203, 213, 225), scale=1)

    create_png(w, h, c.buf, path)
    print(f"Saved desktop screenshot: {path}")

def draw_signals_mobile(path):
    w, h = 390, 844
    c = Canvas(w, h, bg=(10, 14, 23))

    # Mobile Header bar
    c.fill_rect(0, 0, w, 50, (15, 23, 42))
    c.stroke_rect(0, 49, w, 1, (30, 41, 59))
    c.draw_text("CRYPTORA", 16, 16, (6, 182, 212), scale=2)
    c.draw_text("SIGNALS", 280, 20, (148, 163, 184), scale=1)

    # Active Coin selector pill
    c.fill_rect(12, 60, w - 24, 40, (15, 23, 42))
    c.stroke_rect(12, 60, w - 24, 40, (30, 41, 59))
    c.draw_text("BTC/USDT", 24, 73, (255, 255, 255), scale=1)
    c.draw_text("BINANCE  LIVE", 220, 74, (16, 185, 129), scale=1)

    # Chart Card Container (Mobile)
    chart_x, chart_y, chart_w, chart_h = 12, 110, w - 24, 300
    c.fill_rect(chart_x, chart_y, chart_w, chart_h, (13, 18, 30))
    c.stroke_rect(chart_x, chart_y, chart_w, chart_h, (30, 41, 59))

    # Chart Header: Symbol + TF buttons + Display Settings Icon (NO timezone text covering canvas!)
    c.fill_rect(chart_x, chart_y, chart_w, 36, (15, 23, 42))
    c.draw_text("BTC/USDT", chart_x + 10, chart_y + 13, (255, 255, 255), scale=1)

    # Compact TF pills
    tfs = ["15M", "1H", "4H", "1D"]
    tf_start_x = chart_x + 110
    for i, tf in enumerate(tfs):
        is_sel = (tf == "1H")
        box_col = (6, 182, 212) if is_sel else (30, 41, 59)
        text_col = (11, 15, 25) if is_sel else (148, 163, 184)
        c.fill_rect(tf_start_x + i * 36, chart_y + 8, 30, 20, box_col)
        c.draw_text(tf, tf_start_x + i * 36 + 6, chart_y + 14, text_col, scale=1)

    # Display settings button (Sliders icon)
    settings_btn_x = chart_x + chart_w - 36
    c.fill_rect(settings_btn_x, chart_y + 8, 28, 20, (30, 41, 59))
    c.draw_text("[-|-]", settings_btn_x + 4, chart_y + 14, (6, 182, 212), scale=1)

    # Candles plot
    plot_x = chart_x + 8
    plot_y = chart_y + 42
    plot_w = chart_w - 60
    plot_h = chart_h - 50

    prices = [
        63400, 63800, 64200, 63900, 64500, 64300, 65000, 64800,
        65500, 65800, 65400, 64900, 64500, 65100, 65400, 65800
    ]
    min_p, max_p = 63000, 67000
    def p_to_y(p):
        return plot_y + plot_h - 20 - int((p - min_p) / (max_p - min_p) * (plot_h - 40))

    gap = plot_w // len(prices)
    for i in range(len(prices) - 1):
        o = prices[i]
        c_p = prices[i+1]
        is_up = c_p >= o
        col = (16, 185, 129) if is_up else (244, 63, 94)
        bx = plot_x + 6 + i * gap
        c.draw_line(bx + 4, p_to_y(max(o, c_p) + 120), bx + 4, p_to_y(min(o, c_p) - 120), col)
        top_y = min(p_to_y(o), p_to_y(c_p))
        bot_y = max(p_to_y(o), p_to_y(c_p))
        c.fill_rect(bx, top_y, 8, max(2, bot_y - top_y), col)

    # Compact directional markers on mobile:
    # 1. Long active marker (arrowUp belowBar)
    m1_x = plot_x + 6 + 12 * gap + 4
    m1_y = p_to_y(64500 - 120) + 8
    c.draw_arrow_up(m1_x, m1_y, (16, 185, 129), size=6)

    # 2. Short history marker (arrowDown aboveBar)
    m2_x = plot_x + 6 + 6 * gap + 4
    m2_y = p_to_y(65000 + 120) - 8
    c.draw_arrow_down(m2_x, m2_y, (244, 63, 94), size=4)

    # Level lines on mobile (compact labels on price scale to avoid collision)
    scale_x = plot_x + plot_w + 4
    tp1_y = p_to_y(66200)
    c.draw_line(plot_x, tp1_y, plot_x + plot_w, tp1_y, (16, 185, 129), dashed=True)
    c.fill_rect(scale_x, tp1_y - 6, 42, 12, (16, 185, 129))
    c.draw_text("TP1", scale_x + 4, tp1_y - 3, (11, 15, 25), scale=1)

    e1_y = p_to_y(65000)
    c.draw_line(plot_x, e1_y, plot_x + plot_w, e1_y, (6, 182, 212), dashed=True)
    c.fill_rect(scale_x, e1_y - 6, 42, 12, (6, 182, 212))
    c.draw_text("ENTRY", scale_x + 4, e1_y - 3, (11, 15, 25), scale=1)

    sl_y = p_to_y(63800)
    c.draw_line(plot_x, sl_y, plot_x + plot_w, sl_y, (244, 63, 94), dashed=False)
    c.fill_rect(scale_x, sl_y - 6, 42, 12, (244, 63, 94))
    c.draw_text("STOP", scale_x + 4, sl_y - 3, (255, 255, 255), scale=1)

    # §4: MOBILE BOTTOM SHEET / POPOVER FOR SIGNAL DETAILS
    sheet_y = 420
    sheet_h = 240
    c.fill_rect(0, sheet_y, w, sheet_h, (15, 23, 42))
    c.stroke_rect(0, sheet_y, w, 1, (51, 65, 85))

    # Drag pill handle
    c.fill_rect(w // 2 - 20, sheet_y + 8, 40, 4, (100, 116, 139))

    # Details content
    c.draw_text("BTC/USDT", 20, sheet_y + 24, (255, 255, 255), scale=2)
    c.draw_text("^ LONG", 130, sheet_y + 26, (16, 185, 129), scale=1)
    c.draw_text("V3.0  1H  ACTIVE", 185, sheet_y + 26, (6, 182, 212), scale=1)

    c.draw_text("SIGNAL CANDLE: 2026-09-24 16:00 (LOCAL)", 20, sheet_y + 54, (148, 163, 184), scale=1)

    # 2-column parameters grid
    c.fill_rect(20, sheet_y + 72, (w - 50) // 2, 40, (30, 41, 59))
    c.draw_text("ENTRY ZONE", 26, sheet_y + 78, (148, 163, 184), scale=1)
    c.draw_text("64,500 - 65,000", 26, sheet_y + 92, (6, 182, 212), scale=1)

    c.fill_rect(20 + (w - 50) // 2 + 10, sheet_y + 72, (w - 50) // 2, 40, (30, 41, 59))
    c.draw_text("STOP LOSS", 26 + (w - 50) // 2 + 10, sheet_y + 78, (148, 163, 184), scale=1)
    c.draw_text("63,800 (-1.8%)", 26 + (w - 50) // 2 + 10, sheet_y + 92, (244, 63, 94), scale=1)

    c.fill_rect(20, sheet_y + 118, (w - 50) // 2, 40, (30, 41, 59))
    c.draw_text("TARGET 1 (TP1)", 26, sheet_y + 124, (148, 163, 184), scale=1)
    c.draw_text("66,200 (+1.8%)", 26, sheet_y + 138, (16, 185, 129), scale=1)

    c.fill_rect(20 + (w - 50) // 2 + 10, sheet_y + 118, (w - 50) // 2, 40, (30, 41, 59))
    c.draw_text("TARGET 2 (TP2)", 26 + (w - 50) // 2 + 10, sheet_y + 124, (148, 163, 184), scale=1)
    c.draw_text("67,500 (+3.8%)", 26 + (w - 50) // 2 + 10, sheet_y + 138, (16, 185, 129), scale=1)

    # Toggle levels action button
    c.fill_rect(20, sheet_y + 172, w - 40, 36, (6, 182, 212))
    c.draw_text("SHOW / HIDE SIGNAL LEVELS", 90, sheet_y + 184, (11, 15, 25), scale=1)

    create_png(w, h, c.buf, path)
    print(f"Saved mobile screenshot: {path}")

if __name__ == '__main__':
    draw_signals_desktop('design-audit/shots/signals-desktop-1280-redesign.png')
    draw_signals_mobile('design-audit/shots/signals-mobile-390-redesign.png')
