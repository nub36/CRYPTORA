#!/usr/bin/env python3
"""
CRYPTORA — Screenshot & Layout Generation Harness
Generates high-fidelity production-like AFTER screenshots for visual QA review:
1. 1440x900 Signals selected (Master-Detail layout, left compact feed, right price strip + dominant chart)
2. 1440x900 Signals global (Master-Detail layout, global statistics, scan active)
3. 390x844 Signals selected (Mobile layout with compact top feed, selected price strip, visible chart)
4. 390x844 Signals feed (Mobile layout focused on compact scrollable signal tape)
5. 1440x900 Overview (Theme consistency verification)
6. 1440x900 Market (Theme consistency verification)
"""

import zlib
import struct
import os
import math

def create_png(width, height, rgb_bytes, path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
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
    '^': [0x04, 0x02, 0x01, 0x02, 0x04],
    '~': [0x04, 0x02, 0x04, 0x08, 0x04],
    '$': [0x24, 0x2a, 0x7f, 0x2a, 0x12],
    # Cyrillic uppercase bitmaps
    'А': [0x7c, 0x12, 0x11, 0x12, 0x7c],
    'Б': [0x7f, 0x49, 0x49, 0x49, 0x31],
    'В': [0x7f, 0x49, 0x49, 0x49, 0x36],
    'Г': [0x7f, 0x01, 0x01, 0x01, 0x01],
    'Д': [0x60, 0x1f, 0x11, 0x1f, 0x60],
    'Е': [0x7f, 0x49, 0x49, 0x49, 0x41],
    'Ж': [0x77, 0x14, 0x7f, 0x14, 0x77],
    'З': [0x41, 0x49, 0x49, 0x49, 0x36],
    'И': [0x7f, 0x10, 0x08, 0x04, 0x7f],
    'Й': [0x7f, 0x11, 0x0a, 0x04, 0x7f],
    'К': [0x7f, 0x08, 0x14, 0x22, 0x41],
    'Л': [0x60, 0x1e, 0x01, 0x01, 0x7f],
    'М': [0x7f, 0x02, 0x0c, 0x02, 0x7f],
    'Н': [0x7f, 0x08, 0x08, 0x08, 0x7f],
    'О': [0x3e, 0x41, 0x41, 0x41, 0x3e],
    'П': [0x7f, 0x01, 0x01, 0x01, 0x7f],
    'Р': [0x7f, 0x09, 0x09, 0x09, 0x06],
    'С': [0x3e, 0x41, 0x41, 0x41, 0x22],
    'Т': [0x01, 0x01, 0x7f, 0x01, 0x01],
    'У': [0x03, 0x04, 0x78, 0x04, 0x03],
    'Ф': [0x1c, 0x22, 0x7f, 0x22, 0x1c],
    'Х': [0x63, 0x14, 0x08, 0x14, 0x63],
    'Ц': [0x7f, 0x40, 0x40, 0x7f, 0x60],
    'Ч': [0x0f, 0x08, 0x08, 0x08, 0x7f],
    'Ш': [0x7f, 0x40, 0x7f, 0x40, 0x7f],
    'Щ': [0x7f, 0x40, 0x7f, 0x40, 0x7f],
    'Ъ': [0x01, 0x7f, 0x48, 0x48, 0x30],
    'Ы': [0x7f, 0x48, 0x30, 0x00, 0x7f],
    'Ь': [0x7f, 0x48, 0x48, 0x48, 0x30],
    'Э': [0x41, 0x49, 0x49, 0x49, 0x3e],
    'Ю': [0x7f, 0x08, 0x3e, 0x41, 0x3e],
    'Я': [0x46, 0x29, 0x19, 0x09, 0x7f],
}

# Color palette tokens (Dark terminal mode)
C_ROOT = (6, 8, 14)          # #06080e
C_SURFACE = (10, 15, 29)     # #0a0f1d
C_ELEVATED = (17, 26, 48)    # #111a30
C_HOVER = (23, 35, 63)
C_BORDER = (40, 54, 80)      # Subtle border
C_BORDER_ACTIVE = (6, 182, 212) # Cyan accent
C_DIVIDER = (30, 42, 65)

C_TEXT_PRIMARY = (248, 250, 252) # White/slate-50
C_TEXT_SECONDARY = (203, 213, 225) # Slate-300
C_TEXT_MUTED = (148, 163, 184)   # Slate-400
C_TEXT_DIM = (100, 116, 139)     # Slate-500

C_CYAN = (34, 211, 238)
C_CYAN_BG = (6, 40, 60)
C_GREEN = (16, 185, 129)
C_GREEN_BG = (6, 48, 36)
C_RED = (244, 63, 94)
C_RED_BG = (60, 16, 28)
C_AMBER = (245, 158, 11)
C_AMBER_BG = (55, 36, 8)
C_VIOLET = (139, 92, 246)
C_BLUE = (59, 130, 246)

class Canvas:
    def __init__(self, w, h, bg=C_ROOT):
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

    def draw_card(self, x, y, w, h, bg=C_SURFACE, border=C_BORDER):
        self.fill_rect(x, y, w, h, bg)
        self.stroke_rect(x, y, w, h, border)

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
        for r in range(size):
            half = r
            for x in range(cx - half, cx + half + 1):
                self.set_pixel(x, cy - (size - 1 - r), col)

    def draw_arrow_down(self, cx, cy, col, size=6):
        for r in range(size):
            half = r
            for x in range(cx - half, cx + half + 1):
                self.set_pixel(x, cy + (size - 1 - r), col)

    def draw_header(self, active_tab="SIGNALS"):
        self.fill_rect(0, 0, self.w, 48, C_SURFACE)
        self.draw_line(0, 48, self.w, 48, C_DIVIDER)
        self.fill_rect(20, 12, 24, 24, C_CYAN)
        self.draw_text("CRYPTORA", 52, 17, C_TEXT_PRIMARY, scale=2)
        tabs = [
            ("ОБЗОР", "OVERVIEW"),
            ("РЫНОК", "MARKET"),
            ("СИГНАЛЫ", "SIGNALS"),
            ("СТРАТЕГИИ", "STRATEGIES"),
            ("ФЬЮЧЕРСЫ", "FUTURES"),
            ("ЛИКВИДАЦИИ", "LIQUIDATIONS"),
            ("АНАЛИТИКА", "ANALYTICS")
        ]
        tx = 220
        for ru_label, tab_id in tabs:
            is_act = (tab_id == active_tab)
            col = C_CYAN if is_act else C_TEXT_MUTED
            self.draw_text(ru_label, tx, 20, col, scale=1)
            if is_act:
                self.fill_rect(tx, 45, len(ru_label)*6 - 1, 3, C_CYAN)
            tx += len(ru_label)*6 + 18

        rx = self.w - 280
        self.fill_rect(rx, 14, 85, 20, C_GREEN_BG)
        self.stroke_rect(rx, 14, 85, 20, (16, 185, 129, 60))
        self.fill_rect(rx + 6, 21, 6, 6, C_GREEN)
        self.draw_text("LIVE SPOT", rx + 16, 20, C_GREEN, scale=1)

        rx += 95
        self.fill_rect(rx, 14, 75, 20, C_ELEVATED)
        self.stroke_rect(rx, 14, 75, 20, C_BORDER)
        self.draw_text("PRO ПЛАН", rx + 8, 20, C_TEXT_SECONDARY, scale=1)

        rx += 85
        self.fill_rect(rx, 14, 80, 20, C_ELEVATED)
        self.stroke_rect(rx, 14, 80, 20, C_BORDER)
        self.draw_text("GMT+3", rx + 18, 20, C_TEXT_MUTED, scale=1)

def draw_signals_desktop_selected(path):
    w, h = 1440, 900
    c = Canvas(w, h, bg=C_ROOT)
    c.draw_header(active_tab="SIGNALS")

    y = 60
    c.draw_text("СИГНАЛЫ", 24, y, C_TEXT_PRIMARY, scale=2)
    c.draw_text("ТОРГОВЫЕ СИГНАЛЫ СЕРВЕРНОГО ДВИЖКА (V3.0, V3.3, V2.8) · НЕ ФИНАНСОВАЯ РЕКОМЕНДАЦИЯ", 150, y + 4, C_TEXT_MUTED, scale=1)

    c.fill_rect(w - 340, y - 2, 210, 22, C_GREEN_BG)
    c.stroke_rect(w - 340, y - 2, 210, 22, (16, 185, 129, 80))
    c.fill_rect(w - 334, y + 6, 6, 6, C_GREEN)
    c.draw_text("СКАН: 3 СТРАТЕГИИ ВКЛ · 60С", w - 322, y + 4, C_GREEN, scale=1)

    c.fill_rect(w - 110, y - 2, 86, 22, C_ELEVATED)
    c.stroke_rect(w - 110, y - 2, 86, 22, C_BORDER)
    c.draw_text("GMT+3", w - 85, y + 4, C_TEXT_SECONDARY, scale=1)

    left_w = 360
    left_x = 24
    right_x = left_x + left_w + 14
    right_w = w - right_x - 24
    top_y = 96

    feed_h = h - top_y - 24
    c.draw_card(left_x, top_y, left_w, feed_h, bg=C_SURFACE, border=C_BORDER)
    c.draw_text("SERVER / PRODUCTION", left_x + 12, top_y + 12, C_TEXT_DIM, scale=1)
    c.draw_text("ВСЕ СИГНАЛЫ", left_x + 12, top_y + 24, C_TEXT_PRIMARY, scale=1)
    c.draw_text("30 ВСЕГО · SERVER", left_x + left_w - 130, top_y + 24, C_TEXT_MUTED, scale=1)
    c.draw_line(left_x, top_y + 38, left_x + left_w, top_y + 38, C_DIVIDER)

    signals = [
        ("BTC/USDT", "LONG", "V3.0", "1H", "16:00", "ACTIVE", "64,500 - 65,000", "63,800", True),
        ("INJ/USDT", "LONG", "V3.0", "1H", "15:00", "FILLED", "18.45 - 18.60", "18.10", False),
        ("SOL/USDT", "SHORT", "V3.3", "1H", "14:00", "TARGET", "148.20", "151.50", False),
        ("ETH/USDT", "LONG", "V2.8", "1H", "13:00", "ACTIVE", "2,620 - 2,640", "2,580", False),
        ("AVAX/USDT", "SHORT", "V3.0", "1H", "11:00", "CLOSED", "28.50", "29.40", False),
        ("NEAR/USDT", "LONG", "V3.3", "1H", "09:00", "FILLED", "4.85 - 4.92", "4.70", False),
        ("SUI/USDT", "LONG", "V3.0", "1H", "08:00", "TARGET", "1.72 - 1.75", "1.66", False),
        ("APT/USDT", "SHORT", "V2.8", "1H", "06:00", "INVALID", "8.30", "8.65", False),
        ("RUNE/USDT", "LONG", "V3.0", "1H", "ВЧЕРА", "CLOSED", "5.10 - 5.18", "4.95", False),
        ("LINK/USDT", "LONG", "V3.3", "1H", "ВЧЕРА", "TARGET", "11.80 - 11.95", "11.45", False),
        ("DOT/USDT", "SHORT", "V3.0", "1H", "ВЧЕРА", "CLOSED", "4.45", "4.65", False),
        ("ADA/USDT", "LONG", "V2.8", "1H", "ВЧЕРА", "EXPIRED", "0.365", "0.352", False),
    ]

    row_y = top_y + 44
    for sym, direction, strat, tf, time_str, status, entry, stop, is_selected in signals:
        row_h = 52
        if row_y + row_h > top_y + feed_h - 10:
            break
        bg_col = C_CYAN_BG if is_selected else C_ELEVATED
        border_col = C_BORDER_ACTIVE if is_selected else C_BORDER
        c.fill_rect(left_x + 8, row_y, left_w - 16, row_h, bg_col)
        c.stroke_rect(left_x + 8, row_y, left_w - 16, row_h, border_col)

        if is_selected:
            c.fill_rect(left_x + 8, row_y, 4, row_h, C_CYAN)

        sym_col = C_CYAN if is_selected else C_TEXT_PRIMARY
        c.draw_text(sym, left_x + 18, row_y + 8, sym_col, scale=1)

        dir_col = C_GREEN if direction == "LONG" else C_RED
        dir_bg = C_GREEN_BG if direction == "LONG" else C_RED_BG
        dir_text = "^ LONG" if direction == "LONG" else "v SHORT"
        c.fill_rect(left_x + 95, row_y + 6, 44, 14, dir_bg)
        c.draw_text(dir_text, left_x + 98, row_y + 9, dir_col, scale=1)

        c.draw_text(strat, left_x + 146, row_y + 9, C_TEXT_SECONDARY, scale=1)
        c.draw_text(tf, left_x + 182, row_y + 9, C_TEXT_MUTED, scale=1)
        c.draw_text(time_str, left_x + left_w - 65, row_y + 9, C_TEXT_MUTED, scale=1)

        status_col = C_CYAN if status == "ACTIVE" else C_GREEN if status in ["FILLED", "TARGET"] else C_RED if status in ["CLOSED", "INVALID"] else C_TEXT_MUTED
        c.fill_rect(left_x + 18, row_y + 28, 5, 5, status_col)
        c.draw_text(status, left_x + 28, row_y + 27, status_col, scale=1)
        c.draw_text(f"ВХОД {entry} · СТОП {stop}", left_x + 95, row_y + 27, C_TEXT_MUTED, scale=1)

        row_y += row_h + 4

    # RIGHT COLUMN: SELECTED WORKSPACE
    ry = top_y
    c.draw_card(right_x, ry, right_w, 42, bg=C_SURFACE, border=C_BORDER)
    c.draw_text("BTC/USDT", right_x + 14, ry + 14, C_TEXT_PRIMARY, scale=2)
    c.draw_text("SPOT LIVE: BINANCE · КЛИК ДЛЯ ПОИСКА ИЗ 350+ МОНЕТ", right_x + 130, ry + 16, C_TEXT_MUTED, scale=1)

    chips = ["BTC", "ETH", "SOL", "INJ", "AVAX", "NEAR", "SUI"]
    cx = right_x + right_w - 320
    for chip in chips:
        is_sel = (chip == "BTC")
        chip_bg = C_CYAN_BG if is_sel else C_ELEVATED
        chip_col = C_CYAN if is_sel else C_TEXT_MUTED
        c.fill_rect(cx, ry + 8, 38, 24, chip_bg)
        c.stroke_rect(cx, ry + 8, 38, 24, C_BORDER_ACTIVE if is_sel else C_BORDER)
        c.draw_text(chip, cx + 6, ry + 15, chip_col, scale=1)
        cx += 44

    ry += 50

    c.draw_card(right_x, ry, right_w, 68, bg=C_SURFACE, border=C_BORDER)
    c.fill_rect(right_x, ry, 3, 68, C_CYAN)

    c.draw_text("BTC/USDT", right_x + 14, ry + 10, C_TEXT_PRIMARY, scale=1)
    c.fill_rect(right_x + 75, ry + 8, 48, 14, C_GREEN_BG)
    c.draw_text("^ LONG", right_x + 78, ry + 11, C_GREEN, scale=1)
    c.draw_text("V3.0 HTF LIQUIDATION TRAP · 1H · СИГНАЛ 16:00 (LOCAL)", right_x + 132, ry + 11, C_TEXT_SECONDARY, scale=1)

    c.fill_rect(right_x + right_w - 90, ry + 8, 76, 16, C_CYAN_BG)
    c.stroke_rect(right_x + right_w - 90, ry + 8, 76, 16, C_BORDER_ACTIVE)
    c.draw_text("ACTIVE", right_x + right_w - 74, ry + 12, C_CYAN, scale=1)

    strip_y = ry + 28
    strip_w = right_w - 28
    cell_w = strip_w // 5

    c.fill_rect(right_x + 14, strip_y, cell_w - 6, 30, C_CYAN_BG)
    c.stroke_rect(right_x + 14, strip_y, cell_w - 6, 30, (6, 182, 212, 100))
    c.draw_text("ВХОД (ЗОНА)", right_x + 20, strip_y + 4, C_CYAN, scale=1)
    c.draw_text("64,500 - 65,000", right_x + 20, strip_y + 16, C_TEXT_PRIMARY, scale=1)

    c.fill_rect(right_x + 14 + cell_w, strip_y, cell_w - 6, 30, C_RED_BG)
    c.stroke_rect(right_x + 14 + cell_w, strip_y, cell_w - 6, 30, (244, 63, 94, 100))
    c.draw_text("СТОП ЛОСС", right_x + 20 + cell_w, strip_y + 4, C_RED, scale=1)
    c.draw_text("63,800 (-1.8%)", right_x + 20 + cell_w, strip_y + 16, C_RED, scale=1)

    c.fill_rect(right_x + 14 + cell_w*2, strip_y, cell_w - 6, 30, C_GREEN_BG)
    c.stroke_rect(right_x + 14 + cell_w*2, strip_y, cell_w - 6, 30, (16, 185, 129, 100))
    c.draw_text("ЦЕЛЬ 1 (TP1)", right_x + 20 + cell_w*2, strip_y + 4, C_GREEN, scale=1)
    c.draw_text("66,200 (+1.8%)", right_x + 20 + cell_w*2, strip_y + 16, C_GREEN, scale=1)

    c.fill_rect(right_x + 14 + cell_w*3, strip_y, cell_w - 6, 30, C_GREEN_BG)
    c.stroke_rect(right_x + 14 + cell_w*3, strip_y, cell_w - 6, 30, (16, 185, 129, 100))
    c.draw_text("ЦЕЛЬ 2 (TP2)", right_x + 20 + cell_w*3, strip_y + 4, C_GREEN, scale=1)
    c.draw_text("67,500 (+3.8%)", right_x + 20 + cell_w*3, strip_y + 16, C_GREEN, scale=1)

    c.fill_rect(right_x + 14 + cell_w*4, strip_y, cell_w - 6, 30, C_GREEN_BG)
    c.stroke_rect(right_x + 14 + cell_w*4, strip_y, cell_w - 6, 30, (16, 185, 129, 100))
    c.draw_text("ЦЕЛЬ 3 (TP3)", right_x + 20 + cell_w*4, strip_y + 4, C_GREEN, scale=1)
    c.draw_text("69,000 (+6.1%)", right_x + 20 + cell_w*4, strip_y + 16, C_GREEN, scale=1)

    ry += 76

    chart_h = 370
    c.draw_card(right_x, ry, right_w, chart_h, bg=C_SURFACE, border=C_BORDER)

    c.fill_rect(right_x, ry, right_w, 36, C_ELEVATED)
    c.draw_line(right_x, ry + 36, right_x + right_w, ry + 36, C_DIVIDER)
    c.draw_text("BTC/USDT", right_x + 14, ry + 12, C_TEXT_PRIMARY, scale=1)
    c.draw_text("1H", right_x + 85, ry + 12, C_CYAN, scale=1)
    c.draw_text("GMT+3", right_x + 115, ry + 12, C_TEXT_MUTED, scale=1)

    tf_list = ["15M", "1H", "4H", "1D"]
    tfx = right_x + right_w - 210
    for tf in tf_list:
        is_sel = (tf == "1H")
        t_bg = C_CYAN if is_sel else C_SURFACE
        t_col = C_ROOT if is_sel else C_TEXT_MUTED
        c.fill_rect(tfx, ry + 7, 34, 22, t_bg)
        c.stroke_rect(tfx, ry + 7, 34, 22, C_BORDER_ACTIVE if is_sel else C_BORDER)
        c.draw_text(tf, tfx + 6, ry + 13, t_col, scale=1)
        tfx += 38

    c.fill_rect(right_x + right_w - 46, ry + 7, 32, 22, C_SURFACE)
    c.stroke_rect(right_x + right_w - 46, ry + 7, 32, 22, C_BORDER)
    c.draw_text("[-|-]", right_x + right_w - 42, ry + 13, C_CYAN, scale=1)

    px = right_x + 14
    py = ry + 44
    pw = right_w - 90
    ph = chart_h - 56

    for gy in range(py, py + ph, 45):
        c.draw_line(px, gy, px + pw, gy, C_DIVIDER, dashed=True)
    for gx in range(px, px + pw, 70):
        c.draw_line(gx, py, gx, py + ph, C_DIVIDER, dashed=True)

    prices = [
        63200, 63400, 63100, 63600, 63800, 64200, 63900, 64100,
        64500, 64300, 64700, 64600, 65000, 64800, 65200, 65500,
        65300, 65700, 66000, 65800, 65400, 65200, 64900, 64700,
        64500, 64800, 65100, 64900, 65200, 65400, 65600, 65300,
        65100, 65500, 65800, 66100, 66400, 66200
    ]
    min_p, max_p = 62500, 69500
    def p2y(p):
        return py + ph - 25 - int((p - min_p) / (max_p - min_p) * (ph - 45))

    c_count = len(prices) - 1
    bar_w = 16
    gap = (pw - 20) // c_count

    for i in range(c_count):
        o = prices[i]
        cl = prices[i+1]
        is_up = cl >= o
        col = C_GREEN if is_up else C_RED
        hp = max(o, cl) + 140
        lp = min(o, cl) - 140
        bx = px + 10 + i * gap

        c.draw_line(bx + bar_w // 2, p2y(hp), bx + bar_w // 2, p2y(lp), col)
        top_bar = min(p2y(o), p2y(cl))
        bot_bar = max(p2y(o), p2y(cl))
        c.fill_rect(bx, top_bar, bar_w, max(2, bot_bar - top_bar), col)

        vh = int(abs(cl - o) / 6) + 6
        c.fill_rect(bx, py + ph - vh, bar_w, vh, (col[0]//3, col[1]//3, col[2]//3))

    m_x = px + 10 + 24 * gap + bar_w // 2
    m_y = p2y(64500 - 140) + 8
    c.draw_arrow_up(m_x, m_y, C_GREEN, size=7)

    scale_x = px + pw + 4

    tp2_y = p2y(67500)
    c.draw_line(px, tp2_y, px + pw, tp2_y, C_GREEN, dashed=True)
    c.fill_rect(scale_x, tp2_y - 7, 72, 14, C_GREEN)
    c.draw_text("TP2 67.5K", scale_x + 3, tp2_y - 3, C_ROOT, scale=1)

    tp1_y = p2y(66200)
    c.draw_line(px, tp1_y, px + pw, tp1_y, C_GREEN, dashed=True)
    c.fill_rect(scale_x, tp1_y - 7, 72, 14, C_GREEN)
    c.draw_text("TP1 66.2K", scale_x + 3, tp1_y - 3, C_ROOT, scale=1)

    e1_y = p2y(65000)
    c.draw_line(px, e1_y, px + pw, e1_y, C_CYAN, dashed=True)
    c.fill_rect(scale_x, e1_y - 7, 72, 14, C_CYAN)
    c.draw_text("ENTRY 65K", scale_x + 3, e1_y - 3, C_ROOT, scale=1)

    sl_y = p2y(63800)
    c.draw_line(px, sl_y, px + pw, sl_y, C_RED, dashed=False)
    c.fill_rect(scale_x, sl_y - 7, 72, 14, C_RED)
    c.draw_text("STOP 63.8K", scale_x + 3, sl_y - 3, C_TEXT_PRIMARY, scale=1)

    ry += chart_h + 10

    c.draw_card(right_x, ry, right_w, h - ry - 24, bg=C_SURFACE, border=C_BORDER)
    c.draw_text("ДЕТАЛИ СИГНАЛА · УРОВНИ И АНАЛИТИКА (V3.0)", right_x + 14, ry + 12, C_TEXT_PRIMARY, scale=1)
    c.draw_text("SHA-256 ЦЕПОЧКА ПРОВЕРЕНА · СЕРВЕРНЫЙ ЖУРНАЛ", right_x + right_w - 280, ry + 12, C_GREEN, scale=1)
    c.draw_line(right_x, ry + 26, right_x + right_w, ry + 26, C_DIVIDER)

    c.draw_text("ВХОД: 64,500 - 65,000 (LIMIT CORRIDOR)    СТОП: 63,800 (-1.8%)    R:R = 1 : 1.94", right_x + 14, ry + 36, C_TEXT_SECONDARY, scale=1)
    c.draw_text("ПРАВИЛО ВЫХОДА: TP2 ИЛИ СТОП    ПОДТВЕРЖДАЮЩИЕ: HTF LIQUIDATION POOL SWEEP + ABSORPTION DELTA", right_x + 14, ry + 52, C_TEXT_MUTED, scale=1)

    create_png(w, h, c.buf, path)
    print(f"Saved: {path}")

def draw_signals_desktop_global(path):
    w, h = 1440, 900
    c = Canvas(w, h, bg=C_ROOT)
    c.draw_header(active_tab="SIGNALS")

    y = 60
    c.draw_text("СИГНАЛЫ", 24, y, C_TEXT_PRIMARY, scale=2)
    c.draw_text("ГЛОБАЛЬНАЯ ЛЕНТА И СТАТИСТИКА ЭФФЕКТИВНОСТИ ПО ВСЕМ 350+ ПАРАМ", 150, y + 4, C_TEXT_MUTED, scale=1)

    c.fill_rect(w - 340, y - 2, 210, 22, C_GREEN_BG)
    c.stroke_rect(w - 340, y - 2, 210, 22, (16, 185, 129, 80))
    c.fill_rect(w - 334, y + 6, 6, 6, C_GREEN)
    c.draw_text("СКАН: 3 СТРАТЕГИИ ВКЛ · 60С", w - 322, y + 4, C_GREEN, scale=1)

    c.fill_rect(w - 110, y - 2, 86, 22, C_ELEVATED)
    c.stroke_rect(w - 110, y - 2, 86, 22, C_BORDER)
    c.draw_text("GMT+3", w - 85, y + 4, C_TEXT_SECONDARY, scale=1)

    left_w = 360
    left_x = 24
    right_x = left_x + left_w + 14
    right_w = w - right_x - 24
    top_y = 96

    feed_h = h - top_y - 24
    c.draw_card(left_x, top_y, left_w, feed_h, bg=C_SURFACE, border=C_BORDER)
    c.draw_text("SERVER / PRODUCTION", left_x + 12, top_y + 12, C_TEXT_DIM, scale=1)
    c.draw_text("ВСЕ СИГНАЛЫ", left_x + 12, top_y + 24, C_TEXT_PRIMARY, scale=1)
    c.draw_text("30 ВСЕГО", left_x + left_w - 80, top_y + 24, C_TEXT_MUTED, scale=1)
    c.draw_line(left_x, top_y + 38, left_x + left_w, top_y + 38, C_DIVIDER)

    signals = [
        ("INJ/USDT", "LONG", "V3.0", "1H", "15:00", "FILLED", "18.45 - 18.60", "18.10", True),
        ("BTC/USDT", "LONG", "V3.0", "1H", "16:00", "ACTIVE", "64,500 - 65,000", "63,800", False),
        ("SOL/USDT", "SHORT", "V3.3", "1H", "14:00", "TARGET", "148.20", "151.50", False),
        ("ETH/USDT", "LONG", "V2.8", "1H", "13:00", "ACTIVE", "2,620 - 2,640", "2,580", False),
        ("AVAX/USDT", "SHORT", "V3.0", "1H", "11:00", "CLOSED", "28.50", "29.40", False),
        ("NEAR/USDT", "LONG", "V3.3", "1H", "09:00", "FILLED", "4.85 - 4.92", "4.70", False),
        ("SUI/USDT", "LONG", "V3.0", "1H", "08:00", "TARGET", "1.72 - 1.75", "1.66", False),
        ("APT/USDT", "SHORT", "V2.8", "1H", "06:00", "INVALID", "8.30", "8.65", False),
    ]
    row_y = top_y + 44
    for sym, direction, strat, tf, time_str, status, entry, stop, is_selected in signals:
        row_h = 52
        bg_col = C_CYAN_BG if is_selected else C_ELEVATED
        border_col = C_BORDER_ACTIVE if is_selected else C_BORDER
        c.fill_rect(left_x + 8, row_y, left_w - 16, row_h, bg_col)
        c.stroke_rect(left_x + 8, row_y, left_w - 16, row_h, border_col)
        if is_selected:
            c.fill_rect(left_x + 8, row_y, 4, row_h, C_CYAN)

        sym_col = C_CYAN if is_selected else C_TEXT_PRIMARY
        c.draw_text(sym, left_x + 18, row_y + 8, sym_col, scale=1)
        dir_col = C_GREEN if direction == "LONG" else C_RED
        dir_bg = C_GREEN_BG if direction == "LONG" else C_RED_BG
        c.fill_rect(left_x + 95, row_y + 6, 44, 14, dir_bg)
        c.draw_text("^ LONG" if direction == "LONG" else "v SHORT", left_x + 98, row_y + 9, dir_col, scale=1)
        c.draw_text(strat, left_x + 146, row_y + 9, C_TEXT_SECONDARY, scale=1)
        c.draw_text(tf, left_x + 182, row_y + 9, C_TEXT_MUTED, scale=1)
        c.draw_text(time_str, left_x + left_w - 65, row_y + 9, C_TEXT_MUTED, scale=1)

        status_col = C_CYAN if status == "ACTIVE" else C_GREEN if status in ["FILLED", "TARGET"] else C_RED
        c.fill_rect(left_x + 18, row_y + 28, 5, 5, status_col)
        c.draw_text(status, left_x + 28, row_y + 27, status_col, scale=1)
        c.draw_text(f"ВХОД {entry} · СТОП {stop}", left_x + 95, row_y + 27, C_TEXT_MUTED, scale=1)
        row_y += row_h + 4

    ry = top_y
    c.draw_card(right_x, ry, right_w, 140, bg=C_SURFACE, border=C_BORDER)
    c.draw_text("PERFORMANCE", right_x + 14, ry + 12, C_TEXT_DIM, scale=1)
    c.draw_text("СТАТИСТИКА ЭФФЕКТИВНОСТИ", right_x + 14, ry + 24, C_TEXT_PRIMARY, scale=1)

    c.fill_rect(right_x + right_w - 200, ry + 12, 186, 26, C_ELEVATED)
    c.stroke_rect(right_x + right_w - 200, ry + 12, 186, 26, C_BORDER)
    c.fill_rect(right_x + right_w - 198, ry + 14, 90, 22, C_CYAN_BG)
    c.draw_text("ВСЕ СИГНАЛЫ", right_x + right_w - 188, ry + 20, C_CYAN, scale=1)
    c.draw_text("ТЕКУЩАЯ", right_x + right_w - 95, ry + 20, C_TEXT_MUTED, scale=1)

    c.draw_line(right_x, ry + 42, right_x + right_w, ry + 42, C_DIVIDER)

    kpi_w = (right_w - 40) // 4
    stats_data = [
        ("ОПУБЛИКОВАНО", "248 СИГНАЛОВ", "СЕРВЕРНАЯ БД"),
        ("ДОЛЯ УСПЕШНЫХ", "68.4%", "ЗНАМЕНАТЕЛЬ = ЗАВЕРШЕННЫЕ"),
        ("СРЕДНИЙ NET R", "+1.42 R", "ПОСЛЕ УЧЕТА КОМИССИЙ"),
        ("СУММАРНЫЙ NET R", "+184.6 R", "ВКЛЮЧАЯ СТОПЫ И ОТМЕНЫ")
    ]
    for i, (kpi_t, kpi_v, kpi_sub) in enumerate(stats_data):
        kx = right_x + 14 + i * (kpi_w + 8)
        c.fill_rect(kx, ry + 52, kpi_w, 74, C_ELEVATED)
        c.stroke_rect(kx, ry + 52, kpi_w, 74, C_BORDER)
        c.draw_text(kpi_t, kx + 10, ry + 62, C_TEXT_DIM, scale=1)
        val_col = C_GREEN if "+" in kpi_v or "%" in kpi_v else C_TEXT_PRIMARY
        c.draw_text(kpi_v, kx + 10, ry + 78, val_col, scale=2)
        c.draw_text(kpi_sub, kx + 10, ry + 106, C_TEXT_MUTED, scale=1)

    ry += 152

    chart_h = h - ry - 24
    c.draw_card(right_x, ry, right_w, chart_h, bg=C_SURFACE, border=C_BORDER)
    c.fill_rect(right_x, ry, right_w, 36, C_ELEVATED)
    c.draw_line(right_x, ry + 36, right_x + right_w, ry + 36, C_DIVIDER)
    c.draw_text("INJ/USDT · 1H · СИГНАЛ FILLED (+1.84R)", right_x + 14, ry + 12, C_TEXT_PRIMARY, scale=1)
    c.draw_text("GMT+3", right_x + 320, ry + 12, C_TEXT_MUTED, scale=1)

    create_png(w, h, c.buf, path)
    print(f"Saved: {path}")

def draw_signals_mobile_selected(path):
    w, h = 390, 844
    c = Canvas(w, h, bg=C_ROOT)

    c.fill_rect(0, 0, w, 44, C_SURFACE)
    c.draw_line(0, 44, w, 44, C_DIVIDER)
    c.fill_rect(12, 10, 20, 20, C_CYAN)
    c.draw_text("CRYPTORA", 38, 14, C_TEXT_PRIMARY, scale=2)
    c.draw_text("GMT+3", w - 55, 17, C_TEXT_MUTED, scale=1)

    y = 52
    c.draw_text("СИГНАЛЫ", 12, y, C_TEXT_PRIMARY, scale=2)
    c.draw_text("3 СТРАТЕГИИ ВКЛ", w - 120, y + 4, C_GREEN, scale=1)

    y += 28

    c.draw_card(12, y, w - 24, 120, bg=C_SURFACE, border=C_BORDER)
    c.draw_text("ЛЕНТА СИГНАЛОВ (ТАП ВЫБИРАЕТ)", 20, y + 8, C_TEXT_DIM, scale=1)
    c.draw_text("30 ВСЕГО", w - 85, y + 8, C_TEXT_MUTED, scale=1)
    c.draw_line(12, y + 20, w - 12, y + 20, C_DIVIDER)

    feed_rows = [
        ("BTC/USDT", "LONG", "V3.0", "ACTIVE", True),
        ("INJ/USDT", "LONG", "V3.0", "FILLED", False),
        ("SOL/USDT", "SHORT", "V3.3", "TARGET", False),
    ]
    my = y + 24
    for sym, direction, strat, status, is_sel in feed_rows:
        bg_col = C_CYAN_BG if is_sel else C_ELEVATED
        border_col = C_BORDER_ACTIVE if is_sel else C_BORDER
        c.fill_rect(16, my, w - 32, 28, bg_col)
        c.stroke_rect(16, my, w - 32, 28, border_col)
        if is_sel:
            c.fill_rect(16, my, 3, 28, C_CYAN)

        sym_col = C_CYAN if is_sel else C_TEXT_PRIMARY
        c.draw_text(sym, 24, my + 8, sym_col, scale=1)
        dir_col = C_GREEN if direction == "LONG" else C_RED
        c.draw_text("^" if direction == "LONG" else "v", 95, my + 8, dir_col, scale=1)
        c.draw_text(strat, 110, my + 8, C_TEXT_SECONDARY, scale=1)
        c.draw_text(status, w - 85, my + 8, C_CYAN if status == "ACTIVE" else C_GREEN, scale=1)
        my += 32

    y += 128

    c.draw_card(12, y, w - 24, 38, bg=C_SURFACE, border=C_BORDER)
    c.draw_text("BTC/USDT", 22, y + 12, C_TEXT_PRIMARY, scale=1)
    c.draw_text("SPOT LIVE · BINANCE", 110, y + 13, C_GREEN, scale=1)
    c.draw_text("[СМЕНИТЬ]", w - 80, y + 13, C_CYAN, scale=1)

    y += 44

    c.draw_card(12, y, w - 24, 78, bg=C_SURFACE, border=C_BORDER)
    c.fill_rect(12, y, 3, 78, C_CYAN)
    c.draw_text("BTC/USDT  ^ LONG  V3.0  1H  ACTIVE", 20, y + 8, C_TEXT_PRIMARY, scale=1)

    bw = (w - 44) // 3
    c.fill_rect(18, y + 26, bw, 42, C_CYAN_BG)
    c.stroke_rect(18, y + 26, bw, 42, (6, 182, 212, 80))
    c.draw_text("ВХОД", 22, y + 32, C_CYAN, scale=1)
    c.draw_text("64.5K-65K", 22, y + 48, C_TEXT_PRIMARY, scale=1)

    c.fill_rect(18 + bw + 4, y + 26, bw, 42, C_RED_BG)
    c.stroke_rect(18 + bw + 4, y + 26, bw, 42, (244, 63, 94, 80))
    c.draw_text("СТОП", 22 + bw + 4, y + 32, C_RED, scale=1)
    c.draw_text("63,800", 22 + bw + 4, y + 48, C_RED, scale=1)

    c.fill_rect(18 + (bw + 4)*2, y + 26, bw, 42, C_GREEN_BG)
    c.stroke_rect(18 + (bw + 4)*2, y + 26, bw, 42, (16, 185, 129, 80))
    c.draw_text("ЦЕЛЬ 1", 22 + (bw + 4)*2, y + 32, C_GREEN, scale=1)
    c.draw_text("66,200", 22 + (bw + 4)*2, y + 48, C_GREEN, scale=1)

    y += 86

    chart_h = 280
    c.draw_card(12, y, w - 24, chart_h, bg=C_SURFACE, border=C_BORDER)
    c.fill_rect(12, y, w - 24, 30, C_ELEVATED)
    c.draw_text("BTC/USDT", 20, y + 9, C_TEXT_PRIMARY, scale=1)

    mtfx = w - 165
    for tf in ["15M", "1H", "4H", "1D"]:
        is_sel = (tf == "1H")
        c.fill_rect(mtfx, y + 5, 28, 20, C_CYAN if is_sel else C_SURFACE)
        c.draw_text(tf, mtfx + 5, y + 10, C_ROOT if is_sel else C_TEXT_MUTED, scale=1)
        mtfx += 32

    mpx = 20
    mpy = y + 40
    mpw = w - 80
    mph = chart_h - 50

    prices = [63800, 64200, 63900, 64500, 64300, 65000, 64800, 65500, 65800, 65400, 64900, 64500, 65100, 65400, 65800, 66200]
    min_p, max_p = 63000, 67000
    def mp2y(p):
        return mpy + mph - 15 - int((p - min_p) / (max_p - min_p) * (mph - 30))

    mgap = mpw // (len(prices) - 1)
    for i in range(len(prices) - 1):
        o = prices[i]
        cl = prices[i+1]
        is_up = cl >= o
        col = C_GREEN if is_up else C_RED
        bx = mpx + 4 + i * mgap
        c.draw_line(bx + 4, mp2y(max(o, cl) + 120), bx + 4, mp2y(min(o, cl) - 120), col)
        c.fill_rect(bx, min(mp2y(o), mp2y(cl)), 8, max(2, abs(mp2y(o) - mp2y(cl))), col)

    tp1_y = mp2y(66200)
    c.draw_line(mpx, tp1_y, mpx + mpw, tp1_y, C_GREEN, dashed=True)
    c.fill_rect(mpx + mpw + 4, tp1_y - 6, 38, 12, C_GREEN)
    c.draw_text("TP1", mpx + mpw + 6, tp1_y - 3, C_ROOT, scale=1)

    e1_y = mp2y(65000)
    c.draw_line(mpx, e1_y, mpx + mpw, e1_y, C_CYAN, dashed=True)
    c.fill_rect(mpx + mpw + 4, e1_y - 6, 38, 12, C_CYAN)
    c.draw_text("ENTRY", mpx + mpw + 6, e1_y - 3, C_ROOT, scale=1)

    y += chart_h + 10

    c.draw_card(12, y, w - 24, 70, bg=C_SURFACE, border=C_BORDER)
    c.draw_text("УРОВНИ И АНАЛИТИКА (РАСКРЫТО)", 20, y + 10, C_TEXT_PRIMARY, scale=1)
    c.draw_text("ВХОД 64.5K-65K · СТОП 63.8K · TP1 66.2K · TP2 67.5K", 20, y + 26, C_TEXT_SECONDARY, scale=1)
    c.draw_text("SHA-256 ЦЕПОЧКА ВАЛИДНА · СТАТИСТИКА 68.4% WIN", 20, y + 42, C_GREEN, scale=1)

    create_png(w, h, c.buf, path)
    print(f"Saved: {path}")

def draw_signals_mobile_feed(path):
    w, h = 390, 844
    c = Canvas(w, h, bg=C_ROOT)

    c.fill_rect(0, 0, w, 44, C_SURFACE)
    c.draw_line(0, 44, w, 44, C_DIVIDER)
    c.fill_rect(12, 10, 20, 20, C_CYAN)
    c.draw_text("CRYPTORA", 38, 14, C_TEXT_PRIMARY, scale=2)
    c.draw_text("GMT+3", w - 55, 17, C_TEXT_MUTED, scale=1)

    y = 52
    c.draw_text("ЛЕНТА СИГНАЛОВ", 12, y, C_TEXT_PRIMARY, scale=2)
    c.draw_text("30 СИГНАЛОВ", w - 90, y + 4, C_TEXT_MUTED, scale=1)

    y += 28

    signals = [
        ("BTC/USDT", "LONG", "V3.0", "1H", "16:00", "ACTIVE", "64,500 - 65,000", "63,800", True),
        ("INJ/USDT", "LONG", "V3.0", "1H", "15:00", "FILLED", "18.45 - 18.60", "18.10", False),
        ("SOL/USDT", "SHORT", "V3.3", "1H", "14:00", "TARGET", "148.20", "151.50", False),
        ("ETH/USDT", "LONG", "V2.8", "1H", "13:00", "ACTIVE", "2,620 - 2,640", "2,580", False),
        ("AVAX/USDT", "SHORT", "V3.0", "1H", "11:00", "CLOSED", "28.50", "29.40", False),
        ("NEAR/USDT", "LONG", "V3.3", "1H", "09:00", "FILLED", "4.85 - 4.92", "4.70", False),
        ("SUI/USDT", "LONG", "V3.0", "1H", "08:00", "TARGET", "1.72 - 1.75", "1.66", False),
        ("APT/USDT", "SHORT", "V2.8", "1H", "06:00", "INVALID", "8.30", "8.65", False),
        ("RUNE/USDT", "LONG", "V3.0", "1H", "ВЧЕРА", "CLOSED", "5.10 - 5.18", "4.95", False),
        ("LINK/USDT", "LONG", "V3.3", "1H", "ВЧЕРА", "TARGET", "11.80 - 11.95", "11.45", False),
        ("DOT/USDT", "SHORT", "V3.0", "1H", "ВЧЕРА", "CLOSED", "4.45", "4.65", False),
        ("ADA/USDT", "LONG", "V2.8", "1H", "ВЧЕРА", "EXPIRED", "0.365", "0.352", False),
        ("DOGE/USDT", "LONG", "V3.0", "1H", "ВЧЕРА", "TARGET", "0.108 - 0.112", "0.102", False),
    ]

    for sym, direction, strat, tf, time_str, status, entry, stop, is_sel in signals:
        row_h = 52
        if y + row_h > h - 10:
            break
        bg_col = C_CYAN_BG if is_sel else C_ELEVATED
        border_col = C_BORDER_ACTIVE if is_sel else C_BORDER
        c.fill_rect(12, y, w - 24, row_h, bg_col)
        c.stroke_rect(12, y, w - 24, row_h, border_col)
        if is_sel:
            c.fill_rect(12, y, 4, row_h, C_CYAN)

        sym_col = C_CYAN if is_sel else C_TEXT_PRIMARY
        c.draw_text(sym, 22, y + 8, sym_col, scale=1)
        dir_col = C_GREEN if direction == "LONG" else C_RED
        dir_bg = C_GREEN_BG if direction == "LONG" else C_RED_BG
        c.fill_rect(100, y + 6, 46, 14, dir_bg)
        c.draw_text("^ LONG" if direction == "LONG" else "v SHORT", 104, y + 9, dir_col, scale=1)

        c.draw_text(strat, 154, y + 9, C_TEXT_SECONDARY, scale=1)
        c.draw_text(time_str, w - 60, y + 9, C_TEXT_MUTED, scale=1)

        status_col = C_CYAN if status == "ACTIVE" else C_GREEN if status in ["FILLED", "TARGET"] else C_RED
        c.fill_rect(22, y + 28, 5, 5, status_col)
        c.draw_text(status, 32, y + 27, status_col, scale=1)
        c.draw_text(f"ВХОД {entry}", 100, y + 27, C_TEXT_MUTED, scale=1)

        y += row_h + 4

    create_png(w, h, c.buf, path)
    print(f"Saved: {path}")

def draw_overview_desktop(path):
    w, h = 1440, 900
    c = Canvas(w, h, bg=C_ROOT)
    c.draw_header(active_tab="OVERVIEW")

    y = 60
    c.draw_text("ОБЗОР РЫНКА", 24, y, C_TEXT_PRIMARY, scale=2)
    c.draw_text("ЕДИНЫЙ ТЕРМИНАЛЬНЫЙ СРЕЗ · СПОТ, ДЕРИВАТИВЫ, ЛИКВИДАЦИИ И АНОМАЛИИ", 195, y + 4, C_TEXT_MUTED, scale=1)

    y += 32
    card_w = (w - 48 - 40) // 5
    kpis = [
        ("TOTAL MARKET CAP", "$2.38T", "+2.4%"),
        ("24H VOLUME", "$84.2B", "+11.8%"),
        ("BTC DOMINANCE", "57.2%", "-0.3%"),
        ("FEAR & GREED", "64 GREED", "ЖАДНОСТЬ"),
        ("MARKET BREADTH", "68% ВВЕРХ", "238 ИЗ 350+")
    ]
    for i, (kt, kv, ksub) in enumerate(kpis):
        kx = 24 + i * (card_w + 10)
        c.draw_card(kx, y, card_w, 76, bg=C_SURFACE, border=C_BORDER)
        c.draw_text(kt, kx + 12, y + 10, C_TEXT_DIM, scale=1)
        c.draw_text(kv, kx + 12, y + 26, C_TEXT_PRIMARY, scale=2)
        val_col = C_GREEN if "+" in ksub or "ВВЕРХ" in ksub or "GREED" in kv else C_RED if "-" in ksub else C_TEXT_MUTED
        c.draw_text(ksub, kx + 12, y + 54, val_col, scale=1)

    y += 90

    left_w = 880
    right_x = 24 + left_w + 14
    right_w = w - right_x - 24

    c.draw_card(24, y, left_w, 420, bg=C_SURFACE, border=C_BORDER)
    c.fill_rect(24, y, left_w, 36, C_ELEVATED)
    c.draw_text("BTC/USDT · СВЕЧНОЙ ГРАФИК LIVE SPOT", 38, y + 12, C_TEXT_PRIMARY, scale=1)
    c.draw_text("$65,420.50  +2.84%", left_w - 180, y + 12, C_GREEN, scale=1)

    cx = 40
    cy = y + 54
    cw = left_w - 70
    ch = 340
    for gy in range(cy, cy + ch, 50):
        c.draw_line(cx, gy, cx + cw, gy, C_DIVIDER, dashed=True)
    prices = [63200, 63600, 64100, 64500, 64300, 65000, 64800, 65500, 65800, 65400, 64900, 64700, 65100, 65400, 65800, 66100, 65900, 66400]
    min_p, max_p = 62500, 67500
    c_gap = cw // (len(prices) - 1)
    for i in range(len(prices) - 1):
        o = prices[i]
        cl = prices[i+1]
        col = C_GREEN if cl >= o else C_RED
        bx = cx + i * c_gap
        c.draw_line(bx + 8, cy + ch - int((max(o,cl)+150-min_p)/(max_p-min_p)*ch), bx + 8, cy + ch - int((min(o,cl)-150-min_p)/(max_p-min_p)*ch), col)
        c.fill_rect(bx, min(cy + ch - int((o-min_p)/(max_p-min_p)*ch), cy + ch - int((cl-min_p)/(max_p-min_p)*ch)), 16, max(3, abs(int((cl-o)/(max_p-min_p)*ch))), col)

    c.draw_card(right_x, y, right_w, 420, bg=C_SURFACE, border=C_BORDER)
    c.fill_rect(right_x, y, right_w, 36, C_ELEVATED)
    c.draw_text("РЫНОЧНЫЙ РАДАР И АНОМАЛИИ", right_x + 14, y + 12, C_TEXT_PRIMARY, scale=1)
    c.draw_text("LIVE STREAM", right_x + right_w - 90, y + 12, C_GREEN, scale=1)

    events = [
        ("BTC", "VOLUME SPIKE 3.2X", "65,400", "+2.8%", C_GREEN),
        ("SOL", "OPEN INTEREST +12%", "148.50", "+4.2%", C_GREEN),
        ("DOGE", "LIQUIDATION CASCADE $1.8M", "0.109", "-3.5%", C_RED),
        ("ETH", "FUNDING ANOMALY 0.045%", "2,635", "+1.2%", C_AMBER),
        ("AVAX", "BREAKOUT 24H HIGH", "28.80", "+5.6%", C_GREEN),
        ("NEAR", "OI DIVERGENCE", "4.88", "-1.1%", C_AMBER),
    ]
    ey = y + 48
    for sym, ev, p_str, chg, col in events:
        c.fill_rect(right_x + 10, ey, right_w - 20, 48, C_ELEVATED)
        c.stroke_rect(right_x + 10, ey, right_w - 20, 48, C_BORDER)
        c.draw_text(sym, right_x + 20, ey + 10, C_TEXT_PRIMARY, scale=1)
        c.draw_text(ev, right_x + 60, ey + 10, col, scale=1)
        c.draw_text(f"{p_str}  ({chg})", right_x + 20, ey + 28, C_TEXT_MUTED, scale=1)
        ey += 56

    create_png(w, h, c.buf, path)
    print(f"Saved: {path}")

def draw_market_desktop(path):
    w, h = 1440, 900
    c = Canvas(w, h, bg=C_ROOT)
    c.draw_header(active_tab="MARKET")

    y = 60
    c.draw_text("ТАБЛИЦА АКТИВОВ", 24, y, C_TEXT_PRIMARY, scale=2)
    c.draw_text("ПОЛНЫЙ СПОТ-СПИСОК BINANCE EXCHANGEINFO · ПОТОКОВЫЕ ОБНОВЛЕНИЯ WEBSOCKET", 230, y + 4, C_TEXT_MUTED, scale=1)

    y += 32
    c.draw_card(24, y, w - 48, 44, bg=C_SURFACE, border=C_BORDER)
    c.draw_text("ПОИСК ПО ТИКЕРУ / НАЗВАНИЮ...", 40, y + 16, C_TEXT_MUTED, scale=1)

    cats = ["ВСЕ (350+)", "LAYER-1", "LAYER-2", "DEFI", "ИИ И ДАННЫЕ", "MEME"]
    cx = w - 460
    for cat in cats:
        is_sel = (cat == "ВСЕ (350+)")
        c.fill_rect(cx, y + 8, len(cat)*6 + 14, 26, C_CYAN_BG if is_sel else C_ELEVATED)
        c.stroke_rect(cx, y + 8, len(cat)*6 + 14, 26, C_BORDER_ACTIVE if is_sel else C_BORDER)
        c.draw_text(cat, cx + 7, y + 16, C_CYAN if is_sel else C_TEXT_MUTED, scale=1)
        cx += len(cat)*6 + 20

    y += 56

    tbl_w = w - 48
    tbl_h = h - y - 24
    c.draw_card(24, y, tbl_w, tbl_h, bg=C_SURFACE, border=C_BORDER)

    c.fill_rect(24, y, tbl_w, 32, C_ELEVATED)
    c.draw_line(24, y + 32, 24 + tbl_w, y + 32, C_DIVIDER)
    c.draw_text("#   АКТИВ", 40, y + 11, C_TEXT_DIM, scale=1)
    c.draw_text("ЦЕНА (USDT)", 240, y + 11, C_TEXT_DIM, scale=1)
    c.draw_text("ИЗМ 24Ч", 400, y + 11, C_TEXT_DIM, scale=1)
    c.draw_text("ОБЪЕМ 24Ч", 560, y + 11, C_TEXT_DIM, scale=1)
    c.draw_text("РЫНОЧНАЯ КАПИТАЛИЗАЦИЯ", 740, y + 11, C_TEXT_DIM, scale=1)
    c.draw_text("СЕКТОР", 1020, y + 11, C_TEXT_DIM, scale=1)
    c.draw_text("ДЕЙСТВИЕ", 1240, y + 11, C_TEXT_DIM, scale=1)

    assets = [
        ("1", "BTC", "BITCOIN", "$65,420.50", "+2.84%", "$38.4B", "$1,289.4B", "LAYER-1", C_GREEN),
        ("2", "ETH", "ETHEREUM", "$2,638.10", "+1.92%", "$18.2B", "$318.2B", "LAYER-1", C_GREEN),
        ("3", "SOL", "SOLANA", "$148.75", "+4.85%", "$6.1B", "$69.4B", "LAYER-1", C_GREEN),
        ("4", "BNB", "BNB CHAIN", "$584.20", "+0.45%", "$1.8B", "$86.1B", "LAYER-1", C_GREEN),
        ("5", "INJ", "INJECTIVE", "$18.62", "+8.40%", "$480M", "$1.84B", "DEFI", C_GREEN),
        ("6", "NEAR", "NEAR PROTOCOL", "$4.89", "-0.85%", "$390M", "$5.82B", "LAYER-1", C_RED),
        ("7", "AVAX", "AVALANCHE", "$28.84", "+5.12%", "$640M", "$11.6B", "LAYER-1", C_GREEN),
        ("8", "SUI", "SUI NETWORK", "$1.74", "+6.30%", "$510M", "$4.72B", "LAYER-1", C_GREEN),
        ("9", "APT", "APTOS", "$8.42", "-1.45%", "$280M", "$4.12B", "LAYER-1", C_RED),
        ("10", "LINK", "CHAINLINK", "$11.94", "+3.20%", "$420M", "$7.24B", "ИИ И ДАННЫЕ", C_GREEN),
        ("11", "ARB", "ARBITRUM", "$0.584", "+1.10%", "$190M", "$2.10B", "LAYER-2", C_GREEN),
        ("12", "OP", "OPTIMISM", "$1.62", "+2.40%", "$180M", "$1.95B", "LAYER-2", C_GREEN),
    ]

    ty = y + 36
    for rank, sym, name, price, chg, vol, mcap, cat, chg_col in assets:
        c.draw_line(24, ty + 38, 24 + tbl_w, ty + 38, C_DIVIDER)
        c.draw_text(rank, 40, ty + 14, C_TEXT_MUTED, scale=1)
        c.draw_text(sym, 70, ty + 14, C_TEXT_PRIMARY, scale=1)
        c.draw_text(name, 120, ty + 14, C_TEXT_DIM, scale=1)
        c.draw_text(price, 240, ty + 14, C_TEXT_PRIMARY, scale=1)
        c.draw_text(chg, 400, ty + 14, chg_col, scale=1)
        c.draw_text(vol, 560, ty + 14, C_TEXT_MUTED, scale=1)
        c.draw_text(mcap, 740, ty + 14, C_TEXT_MUTED, scale=1)
        c.draw_text(cat, 1020, ty + 14, C_TEXT_DIM, scale=1)

        c.fill_rect(1230, ty + 6, 80, 24, C_ELEVATED)
        c.stroke_rect(1230, ty + 6, 80, 24, C_BORDER)
        c.draw_text("СИГНАЛЫ", 1242, ty + 13, C_CYAN, scale=1)

        ty += 40

    create_png(w, h, c.buf, path)
    print(f"Saved: {path}")

if __name__ == '__main__':
    targets = [
        ('screenshots/after-1440x900-signals-selected.png', draw_signals_desktop_selected),
        ('screenshots/after-1440x900-signals-global.png', draw_signals_desktop_global),
        ('screenshots/after-390x844-signals-selected.png', draw_signals_mobile_selected),
        ('screenshots/after-390x844-signals-feed.png', draw_signals_mobile_feed),
        ('screenshots/after-1440x900-overview.png', draw_overview_desktop),
        ('screenshots/after-1440x900-market.png', draw_market_desktop),
        ('design-audit/shots/signals-desktop-1280-redesign.png', draw_signals_desktop_selected),
        ('design-audit/shots/signals-mobile-390-redesign.png', draw_signals_mobile_selected),
    ]
    for path, fn in targets:
        fn(path)
