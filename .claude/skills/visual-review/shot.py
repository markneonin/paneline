#!/usr/bin/env python3
import html
import re
import subprocess
import sys
import tempfile
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path

FONT_PX = 14
CELL_PX = FONT_PX * 0.602
LINE_PX = int(FONT_PX * 1.25)
PAD_X_PX = 16
PAD_Y_PX = 12
SCALE = 2
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SCREENSHOT_WAIT_S = 0.5
SCREENSHOT_TRIES = 40
TMUX_TARGET = "main"
PALETTE = [
    "#1e1e1e", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5",
    "#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#ffffff",
]
CUBE_LEVELS = (0, 95, 135, 175, 215, 255)
GREY_START = 232
DEFAULT_FG = "#d4d4d4"
DEFAULT_BG = "#1a1a1a"
GRID_GLYPHS = "─│┌┐└┘├┤┬┴┼╌▌▐▛▜▝▘▀█▄▁▂▃▅▆▇▰▱━"
FIRST_SYMBOL = 0x2300
ESCAPE = re.compile(r"\x1b\[([0-9;:]*)m|\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")


@dataclass
class Pen:
    fg: str | None = None
    bg: str | None = None
    bold: bool = False
    dim: bool = False
    italic: bool = False
    underline: bool = False
    strike: bool = False
    reverse: bool = False

    def css(self) -> str:
        fg, bg = (self.bg or DEFAULT_BG, self.fg or DEFAULT_FG) if self.reverse else (self.fg, self.bg)
        rules = [f"color:{fg}" if fg else "", f"background:{bg}" if bg else ""]
        rules += ["font-weight:700" if self.bold else "", "opacity:.6" if self.dim else ""]
        rules += ["font-style:italic" if self.italic else "", "text-decoration:underline" if self.underline else ""]
        rules += ["text-decoration:line-through" if self.strike else ""]
        return ";".join(rule for rule in rules if rule)

    def apply(self, params: str) -> None:
        codes = [int(code) if code else 0 for code in re.split(r"[;:]", params)] if params else [0]
        index = 0
        while index < len(codes):
            index += self.apply_code(codes, index)

    def apply_code(self, codes: list[int], index: int) -> int:
        code = codes[index]
        if code == 0:
            self.__init__()
        elif code in (1, 2, 3, 4, 7, 9):
            setattr(self, {1: "bold", 2: "dim", 3: "italic", 4: "underline", 7: "reverse", 9: "strike"}[code], True)
        elif code == 22:
            self.bold = self.dim = False
        elif code in (23, 24, 27, 29):
            setattr(self, {23: "italic", 24: "underline", 27: "reverse", 29: "strike"}[code], False)
        elif 30 <= code <= 37 or 90 <= code <= 97:
            self.fg = PALETTE[code - 30 if code < 90 else code - 90 + 8]
        elif 40 <= code <= 47 or 100 <= code <= 107:
            self.bg = PALETTE[code - 40 if code < 100 else code - 100 + 8]
        elif code in (39, 49):
            setattr(self, "fg" if code == 39 else "bg", None)
        elif code in (38, 48):
            colour, used = extended_colour(codes[index + 1:])
            setattr(self, "fg" if code == 38 else "bg", colour)
            return 1 + used
        return 1


def extended_colour(rest: list[int]) -> tuple[str | None, int]:
    if len(rest) >= 2 and rest[0] == 5:
        return colour_256(rest[1]), 2
    if len(rest) >= 4 and rest[0] == 2:
        return "#%02x%02x%02x" % tuple(rest[1:4]), 4
    return None, 0


def colour_256(number: int) -> str:
    if number < len(PALETTE):
        return PALETTE[number]
    if number < GREY_START:
        cube = number - len(PALETTE)
        return "#%02x%02x%02x" % (CUBE_LEVELS[cube // 36], CUBE_LEVELS[cube // 6 % 6], CUBE_LEVELS[cube % 6])
    grey = 8 + (number - GREY_START) * 10
    return "#%02x%02x%02x" % (grey, grey, grey)


def main() -> int:
    if len(sys.argv) != 3:
        sys.exit("usage: shot.py <tmux socket> <output path without extension>")
    socket, out = sys.argv[1], Path(sys.argv[2])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.with_suffix(".txt").write_text(capture(socket, coloured=False))
    ansi = capture(socket, coloured=True)
    out.with_suffix(".ansi").write_text(ansi)
    render(ansi, out.with_suffix(".png"))
    print(out.with_suffix(".png"))
    return 0


def capture(socket: str, coloured: bool) -> str:
    flags = ["-e", "-N"] if coloured else []
    command = ["tmux", "-L", socket, "capture-pane", "-p", "-t", TMUX_TARGET, *flags]
    return subprocess.run(command, capture_output=True, text=True, check=True).stdout


def render(ansi: str, png: Path) -> None:
    pen = Pen()
    rows = [cells_of(line, pen) for line in ansi.rstrip("\n").split("\n")]
    columns = max((len(row) for row in rows), default=1)
    width = int(CELL_PX * columns) + 2 * PAD_X_PX
    height = LINE_PX * len(rows) + 2 * PAD_Y_PX
    body = "\n".join(row_html(row) for row in rows)
    page = (
        f"<!doctype html><meta charset=utf-8><style>html,body{{margin:0;background:{DEFAULT_BG}}}"
        f"pre{{margin:0;padding:{PAD_Y_PX}px {PAD_X_PX}px;color:{DEFAULT_FG};"
        f"font:{FONT_PX}px/{LINE_PX}px Menlo,'SF Mono',Monaco,'Apple Symbols',monospace;font-variant-ligatures:none}}"
        f"span{{display:inline-block;vertical-align:top;white-space:pre;height:{LINE_PX}px}}</style><pre>{body}</pre>"
    )
    with tempfile.TemporaryDirectory() as scratch:
        page_file = Path(scratch) / "shot.html"
        page_file.write_text(page)
        screenshot(page_file, png, width, height, Path(scratch) / "profile")


def cells_of(line: str, pen: Pen) -> list[tuple[str, str]]:
    cells: list[tuple[str, str]] = []
    position = 0
    for match in ESCAPE.finditer(line):
        cells += text_cells(line[position:match.start()], pen.css())
        position = match.end()
        if match.group(1) is not None:
            pen.apply(match.group(1))
    return cells + text_cells(line[position:], pen.css())


def text_cells(text: str, css: str) -> list[tuple[str, str]]:
    cells = []
    for char in text:
        cells.append((char, css))
        if is_wide(char):
            cells.append(("", css))
    return cells


def is_wide(char: str) -> bool:
    return unicodedata.east_asian_width(char) in "WF"


def row_html(row: list[tuple[str, str]]) -> str:
    spans = []
    for char, css in row:
        if char == "":
            continue
        cells_wide = 2 if is_wide(char) else 1
        pinned = cells_wide == 2 or (ord(char) > FIRST_SYMBOL and char not in GRID_GLYPHS)
        width = f";width:{cells_wide * CELL_PX:.2f}px;text-align:center;overflow:hidden" if pinned else ""
        spans.append(f'<span style="{css}{width}">{html.escape(char)}</span>')
    return "".join(spans)


def screenshot(page: Path, png: Path, width: int, height: int, profile: Path) -> None:
    png.unlink(missing_ok=True)
    chrome = subprocess.Popen(
        [
            CHROME, "--headless=new", f"--user-data-dir={profile}", "--virtual-time-budget=2000",
            "--disable-gpu", "--hide-scrollbars", f"--force-device-scale-factor={SCALE}",
            f"--window-size={width},{height}", f"--screenshot={png}", page.as_uri(),
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(SCREENSHOT_TRIES):
        if png.is_file():
            break
        time.sleep(SCREENSHOT_WAIT_S)
    time.sleep(SCREENSHOT_WAIT_S)
    chrome.kill()
    if not png.is_file():
        sys.exit(f"chrome wrote no screenshot: {png}")


if __name__ == "__main__":
    sys.exit(main())
