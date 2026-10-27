#!/usr/bin/env python3
import subprocess
import sys
import unicodedata

TMUX_TARGET = "main"


def main() -> int:
    if len(sys.argv) not in (3, 4):
        sys.exit("usage: click.py <tmux socket> <label on screen> [nth match, 1 = first]")
    socket, label = sys.argv[1], sys.argv[2]
    wanted = int(sys.argv[3]) if len(sys.argv) == 4 else 1
    matches = label_cells(screen(socket), label)
    if len(matches) < wanted:
        sys.exit(f"found {len(matches)} matches of {label!r} on screen, wanted match {wanted}")
    column, row = matches[wanted - 1]
    for action in ("M", "m"):
        press = f"\x1b[<0;{column};{row}{action}".encode()
        subprocess.run(["tmux", "-L", socket, "send-keys", "-t", TMUX_TARGET, "-H", *(f"{byte:02x}" for byte in press)], check=True)
    print(f"clicked {label!r} at column {column}, row {row}")
    return 0


def screen(socket: str) -> list[str]:
    command = ["tmux", "-L", socket, "capture-pane", "-p", "-t", TMUX_TARGET]
    return subprocess.run(command, capture_output=True, text=True, check=True).stdout.split("\n")


def label_cells(lines: list[str], label: str) -> list[tuple[int, int]]:
    found = []
    for row, line in enumerate(lines, 1):
        start = line.find(label)
        while start >= 0:
            found.append((display_width(line[:start]) + display_width(label) // 2 + 1, row))
            start = line.find(label, start + 1)
    return found


def display_width(text: str) -> int:
    return sum(2 if unicodedata.east_asian_width(char) in "WF" else 1 for char in text)


if __name__ == "__main__":
    sys.exit(main())
