# Pane style

The house look of the side pane tabs. It is taken from the tabs the owner accepted: Activity, Files, Agents, Context. A new tab copies them. The owner judges the look, not the tests.

## Frame (the shell owns it)

- The tab bar, the selected tab (filled with the `/color` accent, dark bold text) and the one blank row under the bar come from `tab-bar.tsx`. With no `/color` set, the fill is the theme's `paneInk().tabFill` (light-ansi: black fill, white label, `clawd_background` / `promptBorder`, because the default grey `promptBorder` is the same ansi white as the pane there). A tab never draws its own title chip or tab highlight.
- A control's active choice inside a tab body (Review scope) is drawn as a `tabFill` / `tabText` chip; that is not a title chip.
- Under light-ansi the default chat and status row accent is `clawd_background`, because `promptBorder` is ansi white there.
- The shell adds one cell of left padding and passes `view.width` = `bodyColumns` minus that cell. Lay every row out to `view.width`. Add no padding of your own.

## Colours

- Take every colour from `paneInk()` (`pane-ink.ts`). It already holds the right colour for dark, light, ANSI and auto. No hex, no colour names, no `palette.*` keys read directly in a draw file, no `if (isDark)` colour choice. A status mark in the status band (`● waiting`) comes from `paneInk()` too.
- Colour carries a meaning, never decoration. Item names stay `text` or `muted` (tool names and hook matchers are `tool`); colour goes on the status mark, the status word next to it, the number or the bar.
- At most four hues on one screen, plus one data-series legend (Activity Tool mix, Context legend).
- Meaning is never carried by colour alone: every coloured state also has a glyph, a word or a sign (`✓ ✗ ● ○ ✎ +N -N !`). In light and light-ansi `tool` = `text`; in light-ansi `muted` = `text` too, so rank there comes from weight, glyphs and position.

| Meaning | Key | Paired with |
| --- | --- | --- |
| Headings, item names, values, the key number | `text` | bold for headings and the key number |
| What explains a value: units, labels, times, reasons, hints, zero values, rows that need no action | `muted` | |
| Rules, tree guides, the review comment rail, empty bar cells | `rule`, `meterEmpty` (via `bar`) | |
| Done, allowed, live, added | `ok` | ✓ ✔ `+N` |
| Failed, removed, a destructive confirm | `failed` | ✗ `-N`, the word |
| Denied (a past refusal, not a failure) | `alert` | ⊘ |
| Needs you: waiting, dirty, open review comments, 80 % full or more | `alert` | ● + the word, ✎, `!` |
| The work: running items, tool names, hook matchers, a one-series bar | `tool` | ● |
| Data series (one legend per screen) | `mix` / `hues` | the legend word beside each swatch |

- One meaning per hue across tabs: a tool name is `tool` wherever it is drawn.
- `paneInk().section` (periwinkle) and the `/color` accent are not used in a tab body. `sectionLook` and `accentLook` belong to the chat, not the pane. The status band meters are the one exception: owner decision, they draw in the session accent only, with no level colour.

## Hierarchy

- Three steps, weight before hue: bold `text` (headings, the key number), `text` (names, values), `muted` (everything that explains them). Never a fourth grey.
- A tab with a total has one key number, bold `text`, in its first summary row or header: Activity total time, Files `N files changed`, Agents session cost, Plan `done/total`, Context fill %, Spend `$ this session`, Shells `N running`, Review `N files`.
- In a value-with-unit run the number is `text` and the unit and the ` · ` are `muted`: `$0.24 · 225.5k tokens · 12s`.
- A path shows its parent part in `muted` and its last segment in `text`. It truncates at the start, so the last segment stays.
- A row that needs no action draws in `muted`, except its status mark and status word, which keep their colour (`done` ok, `failed` failed, a killed shell muted), and a click target, which keeps its name in `text`: an ended shell that finished well or was killed, a resolved review comment, a `$0.00 0%` Spend row. A row that needs the eye stays `text`: failed, denied, running.
- A long run of low-information rows folds behind one dim toggle row, `▸ N <what>` (Plan `▸ ✓ 3 done`, Activity `▸ 8 auto-allowed`).

## Block headings

- White bold text with a thin rule to the right edge: `header(ui, "Title", paneHeaderLook(), view.width)`. In a light theme the same call draws black bold text. Never write your own heading row.
- A detail view (Activity call details) keeps one blank row between its `[ back ]` row and its first heading or title.
- One blank row (`<Box height={1} />`) before every heading except the first.
- A tab-wide title with a count under it is allowed when it mirrors an engine screen (MCP: "Manage MCP servers" bold `text`, "3" `text`, "servers" `muted`). Context mirrors `/context`: bold title, ` · hint` in `muted`, no rule.

```
good                                      bad (first Skills tab)
User ──────────────────────────────       User ──────────────────   periwinkle heading
```

## Item rows

- One row per item, `height={1}`. Every `Text` has `wrap="truncate-end"` (paths: `truncate-start` or `clipStart`, so the file name stays). Nothing wraps to a second row.
- Secondary text sits on the same row in `muted`: after ` · ` (`main · opus 5.5`), or in a column. Use `paneRow` (prefix, `dot`, `label`, `middle`, `right`) before writing a row by hand.
- Columns: the name column is as wide as the longest name, clamped (Activity: 6 to 16 cells; MCP: longest name). The flexible part is `flexGrow={1} flexShrink={1} minWidth={0}` and truncates; fixed parts (counts, durations, `+N -N`) are `flexShrink={0}` and stay right-aligned at the edge.
- A status mark comes first, one cell: `statusDot(status)` or the marks in `## Status marks`.
- A card (Agents) is the only multi-row item: a title row in `text`, then one to three detail rows indented under it (numbers in `text`, words in `muted`, the status word and its mark sit on the title row, and the first detail row starts with the type), then a guide-only spacer row (`gapRow`). Use it only when the owner asked for cards.
- A sub-group inside a block (Setup sources in Permissions and Plugins, Setup hook events) is a row of its own: bold `text` with a `muted` count at the right edge; the items are indented 2 cells under it. No rule, no blank row. A Setup hook row is its name (click target) · matcher (`tool`) · source (`muted`, right edge); the name opens the hook detail.

```
good: one row, dim description on the same row
code-style     Use when writing or editing ANY code - f…
council        Use for a decision with several credibl…

bad: "полотно текста", a name row plus an indented description row
code-style
  Use when writing or editing ANY code - functions, cla…
council
  Use for a decision with several credible paths and n…
```

## Indentation

- 2 cells per level, never more. Trees use `treeGlyphs`, `guideUnder` and `guideBetween` (`├─ └─ │` in `rule`).
- Rows that belong to an item (MCP actions, Agents details) are indented 2 cells under it.

## Numbers

- Always `${n} ${plural(noun, n)}`. Numbers via `formatTokens` and `formatDuration`.
- Right-aligned in fixed `flexShrink={0}` columns, padded to the widest value (`padStart`), so numbers and units line up: `  8 tools   1.2k tokens   3 uses`.
- Two numbers with different meanings on one row are two columns, not one ` · ` string (MCP tools/tokens/uses, Review `+N`/`-N`).
- A non-zero number is `text`, a zero is `muted`. In a summary line a zero part is left out (`0 files read`, `0 agents`); in a column it stays as a dim `0`.
- An outlier stands out by weight, not hue: an Activity duration of 10 s or more is bold in its `muted` column.
- Totals go in one summary row at the top, parts joined by ` · ` (MCP "3 servers", Files "2 files changed", the Activity chip line, the Shells "1 running · 2 ended" row).
- Changes are `+N` in `ok` and `-N` in `failed`, never one colour; a zero side is `muted`.

## Bars

- A bar only for a share of a whole or a ranking of two or more comparable items: Spend rows, Agents spend (2 or more agents), Plan progress. Never for one value with no max, never for durations.
- Draw it with `bar()`: `▰` filled, `▱` empty in `meterEmpty`. These are the same cells the status band uses (owner pick). No sparklines or eighth blocks: they misalign in common fonts.
- Bars in one list form one aligned column: the name column has a fixed width, padded to the widest name and clamped, so every bar starts at the same cell (Spend: name | bar | cost | %; Agents spend: bar | name | tokens).
- The plain number always sits beside the bar. Colour: `tool` for a series, `ok` for progress done.

## Status marks

| State | Glyph | Key |
| --- | --- | --- |
| done, allowed | ✓ | `ok` |
| live, connected, clean (MCP, Setup plugins, Files worktree) | ✔ | `ok` |
| failed, a killed agent | ✗ | `failed` |
| denied | ⊘ | `alert` |
| a killed shell | ■ | `muted` |
| running, in progress | ● | `tool` |
| waiting, dirty | ● and the word `waiting` / `dirty` on the row (Sessions: `!`) | `alert` |
| idle, stopped, pending | ○ | `muted` |
| folded / open | ▸ / ▾ | as the row |

- `✓` and `✔` never share a column; the column tells them apart.
- `▸` means folded only, never "in progress" (Plan draws an in-progress task with `●`).
- A status word beside a mark takes the mark's colour (Shells `done` `ok`, `failed` `failed`).

## Click targets

- The whole name is the click target: `labelButton(ui, { key, label, onPress })`. It draws the name in the text colour in every theme, never dim. Never a name in `Text` plus a one-glyph `Button`.
- A command with its own word uses `button(ui, …)`, drawn `[ back ]`.
- A yes/no confirm replaces the button that asked, on the same row, so nothing shifts: the question bold `failed` (`revert hunk?`), `[ yes ]` with its label in `failed`, `[ no ]` with its label in `text` (Review). A one-button confirm (Shells `kill` -> `confirm kill`, Files remove) stays a dim `Button`.
- Item actions (MCP `reconnect  disable`) are plain dim `Button`s, 2 cells apart, on one row indented 2 cells, shown only for the selected item.
- Draw functions never call `update`. Clicks go through callbacks in the view.
- The pane box marks a cut with a `muted` `… N more lines` on its last row; a tab never draws its own.

## Expand and collapse

- A foldable row starts with `▾` (open) or `▸` (folded) and is one `Button` with the name (Files folders). A folded row shows its summed counts on the right.
- An open item shows its extra rows under it, indented 2 cells, in `muted`, one line each, truncated. Long text that needs more opens a detail view with `[ back ]` (Activity call details). Exception, an owner decision: an item whose text must open in full (a Skills description) shows it as `muted` rows, wrapped and indented 2 cells.
- In a detail view a plain-text line that wraps continues 2 cells in (hanging indent), so a wrapped line never looks like a new one.

## Empty state

- One `muted` row in lowercase, no full stop: `no calls yet`, `idle`, `no subagents yet`, `no MCP servers`. Data not loaded yet: `no <thing> data yet`.
- Draw the headings that frame the empty part and leave out blocks that have nothing to show.

## Width

- Check at about 60 and about 120 columns. At 60 every row still fits on one line by truncation; at 120 the extra width goes to the flexible part and the rules reach the edge.
- A layout change by width happens at one named constant (Context: grid beside the summary from `SIDE_BY_SIDE_WIDTH = 60`, stacked below it).
- `paneRow` caps its parts: prefix half, label a third, right part a quarter of the width.

## Before you call a tab done

1. Live check (skill `live-check`): capture the new tab next to an accepted one (Files or Agents) in the dark, light, light-ansi and dark-ansi themes, with the default colour and after `/color red`, at about 60 and about 120 columns.
2. Put the screenshots side by side and compare: heading colour and weight, rule, blank rows, one row per item, dim secondary text, right column, indentation, key number bold, numbers right-aligned in padded columns, zero values dim.
3. Look for a `38;2` code in an ANSI theme: a hardcoded colour leaked.
4. Show the screenshots to the owner. He judges the look; green tests do not make a tab done.
