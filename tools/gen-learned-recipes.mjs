// Regenerates the LEARNED_RECIPES array inside index.html from an installed
// copy of Project Zomboid, and emits a migration map from the old
// category-scoped tick keys to the new recipe-ID keys.
//
//   node tools/gen-learned-recipes.mjs [gameDir]
//
// gameDir defaults to the standard Steam install, or set PZ_DIR.
// The script rewrites only the region between the GENERATED markers, so it is
// safe to run repeatedly. See docs/UPDATING.md.

import fs from 'node:fs';
import path from 'node:path';

const GAME = (process.argv[2] || process.env.PZ_DIR ||
  'C:/Program Files (x86)/Steam/steamapps/common/ProjectZomboid').replace(/\\/g, '/');
const TR = `${GAME}/media/lua/shared/Translate/EN`;
const SCRIPTS = `${GAME}/media/scripts`;
const APP = path.resolve(import.meta.dirname, '..', 'index.html');

if (!fs.existsSync(TR)) {
  console.error(`Cannot find the game at ${GAME}\nPass the install path as an argument or set PZ_DIR.`);
  process.exit(1);
}

const itemName = JSON.parse(fs.readFileSync(`${TR}/ItemName.json`, 'utf8'));
const recipeName = JSON.parse(fs.readFileSync(`${TR}/Recipes.json`, 'utf8'));

// Recipes that were renamed between builds. Old display name -> new display
// name, so existing ticks survive. Split recipes are deliberately absent:
// there is no single successor to map a tick onto.
const RENAMES = {
  'Forge Jar Lid': 'Forge Jar Lids',
  'Forge Short Sword Blade': 'Forge Shortsword Blade',
  'Knap Flint Saw': 'Knapp Flint Saw',
};

// -- brace-matched block scanner -------------------------------
function* blocks(txt, keyword) {
  let i = 0;
  while (true) {
    const start = txt.indexOf(keyword + ' ', i);
    if (start === -1) return;
    if (txt[start - 1] && /\w/.test(txt[start - 1])) { i = start + 1; continue; }
    const braceAt = txt.indexOf('{', start);
    if (braceAt === -1) return;
    const id = txt.slice(start + keyword.length, braceAt).trim();
    if (/\s/.test(id) || !id) { i = start + 1; continue; }
    let depth = 0, j = braceAt;
    for (; j < txt.length; j++) {
      if (txt[j] === '{') depth++;
      else if (txt[j] === '}') { depth--; if (depth === 0) break; }
    }
    yield { id, body: txt.slice(braceAt, j) };
    i = j + 1;
  }
}
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.txt')) files.push(p);
  }
})(SCRIPTS);

// -- who teaches what ------------------------------------------
const taughtBy = new Map(); // recipeId -> [teaching item display names]
for (const file of files) {
  for (const { id, body } of blocks(fs.readFileSync(file, 'utf8'), 'item')) {
    const lr = /^\s*LearnedRecipes\s*=\s*(.+?),\s*$/m.exec(body);
    if (!lr) continue;
    const display = (itemName[`Base.${id}`] || id).replace(/^Magazine:\s*/, '');
    for (const r of lr[1].split(';').map(s => s.trim()).filter(Boolean)) {
      if (!taughtBy.has(r)) taughtBy.set(r, []);
      if (!taughtBy.get(r).includes(display)) taughtBy.get(r).push(display);
    }
  }
}

// -- every recipe that must be learned -------------------------
const cats = new Map();
for (const file of files) {
  for (const { id, body } of blocks(fs.readFileSync(file, 'utf8'), 'craftRecipe')) {
    if (!/NeedToBeLearn\s*=\s*true/i.test(body)) continue;
    const name = recipeName[id];
    if (!name) { console.warn(`  skipped, no display name: ${id}`); continue; }
    let cat = (/^\s*category\s*=\s*(.+?),\s*$/m.exec(body)?.[1] || '').trim();
    if (!cat || cat === '(none)') cat = 'Miscellaneous';
    if (!cats.has(cat)) cats.set(cat, new Map());
    cats.get(cat).set(id, { id, name, from: (taughtBy.get(id) || []).sort() });
  }
}

const ordered = [...cats.entries()]
  .map(([category, m]) => ({ category, items: [...m.values()].sort((a, b) => a.name.localeCompare(b.name)) }))
  .sort((a, b) => a.category.localeCompare(b.category));

const total = ordered.reduce((a, c) => a + c.items.length, 0);
const schemOnly = ordered.reduce((a, c) => a + c.items.filter(i => !i.from.length).length, 0);

// -- migration: old category-scoped keys -> new recipe-ID keys --
const html = fs.readFileSync(APP, 'utf8');
function grabOld(name) {
  const at = html.indexOf(`const ${name} = [`);
  if (at === -1) return null;
  const from = html.indexOf('[', at);
  let depth = 0, j = from;
  for (; j < html.length; j++) {
    if (html[j] === '[') depth++;
    else if (html[j] === ']') { depth--; if (depth === 0) break; }
  }
  return eval(html.slice(from, j + 1));
}
const mid = s => s.replace(/[^a-zA-Z0-9]/g, '_');
const byName = new Map();
for (const c of ordered) for (const i of c.items) byName.set(i.name, i.id);

// This only runs while the pre-regeneration array is still in the file. Once it
// is gone the map is history, already inlined in index.html, and is left alone.
const migration = {};
let dropped = 0;
const old = grabOld('SCHEMATICS') || grabOld('OLD_SCHEMATICS_REMOVE_ME');
if (old) {
  for (const c of old) {
    for (const oldName of c.items) {
      const target = byName.get(RENAMES[oldName] ?? oldName);
      const oldKey = `schem_${mid(c.category)}_${mid(oldName)}`;
      if (target) migration[oldKey] = `schem_${target}`;
      else dropped++;
    }
  }
}

// -- emit ------------------------------------------------------
const q = s => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const lines = [];
lines.push(`// ${total} recipes with NeedToBeLearn = true, across ${ordered.length} categories.`);
lines.push(`// ${schemOnly} are taught by no literature item, so they can only come from a schematic.`);
lines.push(`// Do not edit by hand. Regenerate with: node tools/gen-learned-recipes.mjs`);
lines.push('const LEARNED_RECIPES = [');
for (const c of ordered) {
  lines.push(`  { category: ${q(c.category)}, items: [`);
  for (const i of c.items) {
    const from = i.from.length ? `[${i.from.map(q).join(', ')}]` : '[]';
    lines.push(`    { id: ${q(i.id)}, name: ${q(i.name)}, from: ${from} },`);
  }
  lines.push('  ]},');
}
lines.push('];');

const START = '// >>> GENERATED: learned recipes <<<';
const END = '// >>> END GENERATED <<<';
const a = html.indexOf(START), b = html.indexOf(END);
if (a === -1 || b === -1) {
  console.error(`Could not find the generated markers in index.html.\nExpected:\n  ${START}\n  ${END}`);
  process.exit(1);
}
const next = html.slice(0, a + START.length) + '\n' + lines.join('\n') + '\n' + html.slice(b);
fs.writeFileSync(APP, next, 'utf8');

console.log(`Wrote ${total} recipes across ${ordered.length} categories into index.html`);
console.log(`  ${schemOnly} schematic-only, ${total - schemOnly} also taught by a magazine`);

if (old) {
  // One-time artefact. Paste into index.html as SCHEM_KEY_MIGRATION, then drop
  // the old array; later runs will not regenerate this.
  const outDir = path.resolve(import.meta.dirname, '..', 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const mig = ['const SCHEM_KEY_MIGRATION = {',
    ...Object.entries(migration).sort().map(([k, v]) => `  ${q(k)}: ${q(v)},`),
    '};'].join('\n');
  fs.writeFileSync(path.join(outDir, 'migration.js'), mig + '\n', 'utf8');
  console.log(`  migration map -> out/migration.js (${Object.keys(migration).length} carried over, ${dropped} dropped)`);
}
