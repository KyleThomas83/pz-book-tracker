# Updating the lists for a new build

The three data arrays in `index.html` (`SKILL_BOOKS`, `MAGAZINES`, `SCHEMATICS`)
are hardcoded. This document records where that data actually comes from, so that
refreshing it for a new patch is a repeatable job rather than a re-derivation.

## Use the game files, not the wiki

The authoritative source is the installed copy of the game. It is exact, it matches
the build you are personally running, and it needs no scraping. The wiki lags patches
and is only worth consulting for the one thing the files do not expose (see
[Known gap](#known-gap) below).

Default install path:

```
C:\Program Files (x86)\Steam\steamapps\common\ProjectZomboid
```

### Files that matter

| File | Provides |
| --- | --- |
| `media/lua/shared/Translate/EN/ItemName.json` | Display names for every item, keyed by item ID |
| `media/lua/shared/Translate/EN/Recipes.json` | Display names for every craft recipe, keyed by recipe ID |
| `media/scripts/**/*.txt` | The item and `craftRecipe` definitions themselves (1004 files) |
| `steamapps/appmanifest_108600.acf` | The Steam build id, recorded in the report header |

### The key patterns

**Skill books.** `Base.Book<Skill><1-5>` in `ItemName.json`. The value carries
everything the app needs in one line:

```json
"Base.BookFarming1": "Agriculture I: \"Better Gardening\""
```

Skill name, volume as a Roman numeral, and title. Note the skill in the *key*
(`Farming`) can differ from the skill in the *value* (`Agriculture`). The value wins,
because that is what the game shows the player. One title is not fully quoted
(`Long Blade III: "Old Sword-Play" by Alfred Hutton`), so strip the wrapping quotes
only when they enclose the whole string.

**Recipe magazines.** Item IDs are inconsistent and all three forms are in use:

```
Base.ArmorMag5           most categories
Base.EngineerMagazine1   Engineer
Base.HerbalistMag        Herbalist, no trailing digit
```

The regex `^Base\.(.+?)Mag(?:azine)?(\d*)$` covers all three. Matching on the
display prefix `"Magazine: "` alone is not enough: `Base.TVMagazine` ("TV Monthly")
is a boredom item, not a recipe magazine. The real test is whether the item
definition in `media/scripts` carries a `LearnedRecipes` field.

**Schematics.** A recipe must be learned when its `craftRecipe` block sets
`NeedToBeLearn = true`. Cross-referencing those against every `LearnedRecipes` field
splits them cleanly:

- taught by a literature item, so already covered by the Magazines page
- taught by nothing, so it must come from one of the six schematic items

## Regenerating the recipe list

`LEARNED_RECIPES` in `index.html` is generated, and lives between these markers:

```
// >>> GENERATED: learned recipes <<<
// >>> END GENERATED <<<
```

Rewrite it from the install with:

```bash
node tools/gen-learned-recipes.mjs
```

The generator only touches the marked region, so it is safe to run repeatedly. It
takes every recipe flagged `NeedToBeLearn = true`, groups them by the game's own
`category` field, and records which literature items teach each one so the app can
show the source on the row.

Ticks are keyed on the game's recipe ID (`schem_<RecipeId>`), not on the display name,
so a recipe being renamed upstream no longer orphans your progress. If a rename does
happen, add it to the `RENAMES` map at the top of the generator.

`SCHEM_KEY_MIGRATION` in `index.html` is a one-time artefact from the move off the old
category-scoped keys. It is not regenerated and can be deleted once everyone has
loaded the app at least once.

## Running the books and magazines diff

```bash
node tools/diff-vs-game.mjs out/diff.md
```

This still covers `SKILL_BOOKS` and `MAGAZINES`, which are hand-maintained.

Pass a different install path as a second argument, or set `PZ_DIR`. The script needs
no dependencies. It parses the arrays straight out of `index.html`, so it always
compares against what is actually shipping.

The report is deliberately not committed. `out/` is gitignored. Regenerate it whenever
you need it rather than trusting a stored copy, which cannot tell you whether it was
run before or after the last data change.

## Known gap

There are eight schematic-type items, and they map one to one onto the app's eight
Schematics categories. Note that two of them are not named "Schematic", which is easy
to miss when searching:

| App category | Item ID | In game |
| --- | --- | --- |
| Armor | `ArmorSchematic` | Hand-drawn Armor Schematic |
| Cookware | `CookwareSchematic` | Cookware Forging Recipe |
| Explosives | `ExplosiveSchematic` | Explosives Diagram |
| Melee Weapon | `MeleeWeaponSchematic` | Melee Weapon Plan |
| Cooking | `RecipeClipping` | Cooking Recipe Clipping |
| Sewing | `SewingPattern` | Sewing Pattern |
| Survival | `SurvivalSchematic` | Survival Magazine Page |
| Tool | `BSToolsSchematic` | Tool Forging Plan |

Each one rolls its taught recipe at spawn time through
`OnCreate = ItemCodeOnCreate.onCreate<X>`. That function is compiled into
`projectzomboid.jar` rather than living in `media/lua`, so **which specific recipes
sit in each schematic's pool cannot be read from the files.**

The wiki does not close this gap either. Its Schematics table lists the Recipes column
as `Randomized` for all eight items. Individual recipe pages sometimes name the source
under "Learned from", which is the only route short of decompiling the jar.

Two consequences for reading the diff:

- The script can prove a recipe **must** be schematic-taught, when it is
  `NeedToBeLearn = true` and no literature item lists it under `LearnedRecipes`.
  It cannot say which schematic teaches it, so it infers the grouping from the
  recipe's `category` field and source folder.
- The reverse does not hold. A recipe being magazine-taught does **not** prove it is
  absent from a schematic pool. Plenty of recipes are obtainable both ways, so the
  overlap between the Magazines and Schematics pages is expected, not an error.

Tracked as issue #4.

## Current findings

Findings are **not** recorded here. They live in the GitHub issues list, which is the
only place they are kept up to date:

```bash
gh issue list --repo KyleThomas83/pz-book-tracker
```

Anything this document said about a specific build would be wrong the moment an issue
was closed. The stable facts are above; the live state is in the issues.
