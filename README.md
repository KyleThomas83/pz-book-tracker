# PZ Book & Magazine Tracker

A single-page checklist for Project Zomboid Build 42. Tick off the skill books,
recipe magazines and schematics you have found, and keep a couple of editable
routine lists for the things that are easy to forget between sessions.

Live at **https://kylethomas83.github.io/pz-book-tracker/**

## What it does

The app is styled as an in-world PDA. A collapsible sidebar switches between pages,
and the header carries a search box and a filter (All / Remaining / Found).

**Stuff**

| Page | Contents |
| --- | --- |
| Skill Books | 120 volumes, 24 skills, five volumes each, grouped by skill and labelled with the level range they cover |
| Magazines | 87 recipe magazines grouped by category |
| Learned Recipes | 345 recipes you cannot level into, grouped by the game's own recipe category and collapsed by default |

Every row on Learned Recipes names its source. If a magazine teaches it, that magazine
is listed under the recipe and the row is tagged `MAG`. If nothing teaches it, the row
is tagged `SCHEM` and can only come from one of the eight schematic items. 55 of the
345 fall into that second group.

**To Do List**

| Page | Contents |
| --- | --- |
| Adventure Gear | Daily / Weekly / Monthly kit checks before you head out |
| Chores | Daily / Weekly base upkeep, plus a monthly reflection prompt |

Both to-do pages are editable in the browser. Add an item with an optional line of
flavour text, or remove one with the cross that appears on hover.

**Planning & RPG**

Map Notes and Lore Journal are placeholders, visible in the sidebar but not yet built.

## Running it

There is no build step, no dependencies and no server. It is one HTML file plus a
folder of icons.

Open the hosted page above, or open the file directly:

```bash
start firefox "file:///C:/Claude/Code/PZ_Booktracker/index.html"
```

Only the Google Fonts import needs the network. Without it the page falls back to
system serif and monospace and everything still works.

## Where your progress is stored

Everything lives in the browser's `localStorage`, under three keys:

| Key | Holds |
| --- | --- |
| `pz-tracker-v4` | Every tick, plus which groups you have collapsed |
| `pz-gear-items` | Your Adventure Gear list, once you have edited it |
| `pz-chores-items` | Your Chores list, once you have edited it |

Nothing is sent anywhere and there is no account. Two consequences worth knowing:

- `localStorage` is scoped per origin, so progress saved on the hosted page and
  progress saved from a local file are separate stores. Pick one and stay on it.
- Clearing site data for the origin wipes your progress. There is no export yet.

The **Reset All Progress** button at the foot of the Books, Magazines and
Schematics pages clears `pz-tracker-v4` entirely, which includes your to-do ticks.

## Keeping the data current

`SKILL_BOOKS` and `MAGAZINES` are hand-maintained near the top of the script block in
`index.html`. `LEARNED_RECIPES` is **generated** and sits between marker comments. Do
not edit it by hand.

When a new Build 42 patch lands, regenerate rather than editing:

```bash
node tools/gen-learned-recipes.mjs
```

Then check the other two lists against your install:

```bash
node tools/diff-vs-game.mjs out/diff.md
```

See [docs/UPDATING.md](docs/UPDATING.md) for what that script reads and what it can and
cannot determine. The report is generated on demand and not committed, because it goes
stale the moment the game or the lists change. `out/` is gitignored.

Findings are tracked as GitHub issues, not in a file:

```bash
gh issue list
```

## Layout

```
index.html                    the whole app
icons/                        sidebar sprites
tools/gen-learned-recipes.mjs regenerates LEARNED_RECIPES from an installed copy of the game
tools/diff-vs-game.mjs        checks the books and magazines lists against the same source
docs/UPDATING.md              how to refresh the lists for a new build
```
