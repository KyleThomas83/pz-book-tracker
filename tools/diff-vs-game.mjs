import fs from 'node:fs';
import path from 'node:path';

// Usage: node tools/diff-vs-game.mjs <out.md> [gameDir]
// gameDir defaults to the standard Steam install, or set PZ_DIR.
const GAME = (process.argv[3] || process.env.PZ_DIR ||
  'C:/Program Files (x86)/Steam/steamapps/common/ProjectZomboid').replace(/\\/g, '/');
const TR = `${GAME}/media/lua/shared/Translate/EN`;
const SCRIPTS = `${GAME}/media/scripts`;
const APP = path.resolve(import.meta.dirname, '..', 'index.html');

if (!fs.existsSync(TR)) {
  console.error(`Cannot find the game at ${GAME}\nPass the install path as the second argument or set PZ_DIR.`);
  process.exit(1);
}

const itemName = JSON.parse(fs.readFileSync(`${TR}/ItemName.json`, 'utf8'));
const recipeName = JSON.parse(fs.readFileSync(`${TR}/Recipes.json`, 'utf8'));

// -- helper: brace-matched block scanner -----------------------
function* blocks(txt, keyword) {
  let i = 0;
  while (true) {
    const start = txt.indexOf(keyword + ' ', i);
    if (start === -1) return;
    // keyword must start a token
    const before = txt[start - 1];
    if (before && /[\w]/.test(before)) { i = start + 1; continue; }
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
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.txt')) out.push(p);
  }
  return out;
}
const SCRIPT_FILES = walk(SCRIPTS);

// -- 1. Game truth: skill books --------------------------------
const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5 };
const gameBooks = new Map();
for (const [key, val] of Object.entries(itemName)) {
  const m = /^Base\.Book(.+?)([1-5])$/.exec(key);
  if (!m) continue;
  const v = /^(.+?)\s+(I{1,3}|IV|V):\s*(.+)$/.exec(val);
  if (!v) { console.log(`  !! unparsed book: ${key} = ${val}`); continue; }
  const [, skill, rom, raw] = v;
  const title = /^"[^"]*"$/.test(raw) ? raw.slice(1, -1) : raw;
  if (!gameBooks.has(skill)) gameBooks.set(skill, new Map());
  gameBooks.get(skill).set(ROMAN[rom], title);
}

// -- 2. Game truth: literature items that teach recipes --------
// A "recipe magazine" is a literature item with LearnedRecipes.
const teachers = new Map();        // itemId -> {display, recipes:[ids]}
const recipeTaughtBy = new Map();  // recipeId -> [itemId]
for (const file of SCRIPT_FILES) {
  const txt = fs.readFileSync(file, 'utf8');
  for (const { id, body } of blocks(txt, 'item')) {
    const lr = /^\s*LearnedRecipes\s*=\s*(.+?),\s*$/m.exec(body);
    if (!lr) continue;
    const recipes = lr[1].split(';').map(s => s.trim()).filter(Boolean);
    teachers.set(id, { display: itemName[`Base.${id}`] || id, recipes });
    for (const r of recipes) {
      if (!recipeTaughtBy.has(r)) recipeTaughtBy.set(r, []);
      recipeTaughtBy.get(r).push(id);
    }
  }
}
// magazines = teachers whose display name starts with "Magazine: "
const gameMags = new Map(); // category -> Set(title)
for (const [id, t] of teachers) {
  if (!t.display.startsWith('Magazine: ')) continue;
  const m = /^(.+?)Mag(?:azine)?\d*$/.exec(id);
  const cat = m ? m[1] : '(uncategorised)';
  const title = t.display.slice('Magazine: '.length);
  if (!gameMags.has(cat)) gameMags.set(cat, new Set());
  gameMags.get(cat).add(title);
}

// -- 3. Game truth: recipes that must be learned ---------------
const learned = new Map(); // recipeId -> {category, file, name}
for (const file of SCRIPT_FILES) {
  const txt = fs.readFileSync(file, 'utf8');
  for (const { id, body } of blocks(txt, 'craftRecipe')) {
    if (!/NeedToBeLearn\s*=\s*true/i.test(body)) continue;
    const cm = /^\s*category\s*=\s*(.+?),\s*$/m.exec(body);
    learned.set(id, {
      category: cm ? cm[1].trim() : '(none)',
      file: path.relative(SCRIPTS, file).replace(/\\/g, '/'),
      name: recipeName[id] || null,
    });
  }
}
// schematic-taught = NeedToBeLearn and not taught by any literature item
const schemTaught = new Map();
const magTaught = new Map();
for (const [id, r] of learned) {
  (recipeTaughtBy.has(id) ? magTaught : schemTaught).set(id, r);
}

// -- 4. App's current lists ------------------------------------
const html = fs.readFileSync(APP, 'utf8');
function grab(constName) {
  const start = html.indexOf(`const ${constName} = [`);
  const from = html.indexOf('[', start);
  let depth = 0, j = from;
  for (; j < html.length; j++) {
    if (html[j] === '[') depth++;
    else if (html[j] === ']') { depth--; if (depth === 0) break; }
  }
  return eval(html.slice(from, j + 1));
}
const appBooks = grab('SKILL_BOOKS');
const appMags = grab('MAGAZINES');
const appSchem = grab('SCHEMATICS');

const out = [];
const P = s => out.push(s);

// Read the Steam build id so the report always states what it was run against.
let build = 'unknown';
try {
  const acf = fs.readFileSync(path.resolve(GAME, '../../appmanifest_108600.acf'), 'utf8');
  build = /"buildid"\s+"(\d+)"/.exec(acf)?.[1] ?? 'unknown';
} catch { /* not a Steam install */ }

P('# PZ Book Tracker: game data diff\n');
P(`Source of truth: ${GAME}`);
P(`Steam build id: ${build}`);
P('Generated by `tools/diff-vs-game.mjs`.\n');

// -- 5. Books --------------------------------------------------
P('## Skill books\n');
P(`Game: ${[...gameBooks.values()].reduce((a, m) => a + m.size, 0)} volumes / ${gameBooks.size} skills`);
P(`App:  ${appBooks.reduce((a, s) => a + s.items.length, 0)} volumes / ${appBooks.length} skills\n`);
const appBookMap = new Map(appBooks.map(s => [s.skill, new Map(s.items.map(i => [i.vol, i.title]))]));
const bookIssues = [];
for (const [skill, vols] of gameBooks) {
  if (!appBookMap.has(skill)) { bookIssues.push(`MISSING SKILL  ${skill} (${vols.size} vols)`); continue; }
  const av = appBookMap.get(skill);
  for (const [vol, title] of vols) {
    if (!av.has(vol)) bookIssues.push(`MISSING VOL    ${skill} ${vol}: "${title}"`);
    else if (av.get(vol) !== title) bookIssues.push(`TITLE CHANGED  ${skill} ${vol}\n                 app:  "${av.get(vol)}"\n                 game: "${title}"`);
  }
}
for (const [skill, vols] of appBookMap) {
  if (!gameBooks.has(skill)) { bookIssues.push(`EXTRA SKILL    ${skill}`); continue; }
  for (const vol of vols.keys()) if (!gameBooks.get(skill).has(vol)) bookIssues.push(`EXTRA VOL      ${skill} ${vol}`);
}
P(bookIssues.length ? bookIssues.join('\n') : '**No differences.**');

// -- 6. Magazines ----------------------------------------------
P('\n## Recipe magazines\n');
P(`Game: ${[...gameMags.values()].reduce((a, s) => a + s.size, 0)} magazines / ${gameMags.size} categories`);
P(`App:  ${appMags.reduce((a, c) => a + c.items.length, 0)} magazines / ${appMags.length} categories\n`);
const appMagMap = new Map(appMags.map(c => [c.category, new Set(c.items)]));
const flat = s => s.toLowerCase().replace(/[\s_]/g, '').replace(/s$/, '');
const catAlias = new Map();
for (const gc of gameMags.keys()) for (const ac of appMagMap.keys()) if (flat(ac) === flat(gc)) { catAlias.set(gc, ac); break; }
const magIssues = [];
for (const [gc, titles] of gameMags) {
  const ac = catAlias.get(gc);
  if (!ac) { magIssues.push(`MISSING CATEGORY  ${gc} (${titles.size}): ${[...titles].join(' | ')}`); continue; }
  for (const t of titles) if (!appMagMap.get(ac).has(t)) magIssues.push(`MISSING MAG       [${ac}] ${t}`);
  for (const t of appMagMap.get(ac)) if (!titles.has(t)) magIssues.push(`EXTRA MAG         [${ac}] ${t}`);
}
for (const ac of appMagMap.keys()) if (![...catAlias.values()].includes(ac)) magIssues.push(`EXTRA CATEGORY    ${ac}`);
P(magIssues.length ? magIssues.join('\n') : '**No differences.**');

// -- 7. Schematics ---------------------------------------------
P('\n## Schematics page (recipes with NeedToBeLearn = true)\n');
P(`Game: ${learned.size} learnable recipes total`);
P(`      ${magTaught.size} taught by a magazine (already covered by the Magazines page)`);
P(`      ${schemTaught.size} not taught by any literature item → schematic-taught`);
P(`App:  ${appSchem.reduce((a, c) => a + c.items.length, 0)} entries (${new Set(appSchem.flatMap(c => c.items)).size} unique) / ${appSchem.length} categories\n`);

const appSchemAll = new Set(appSchem.flatMap(c => c.items));
const schemByName = new Map();
for (const [id, r] of schemTaught) if (r.name) schemByName.set(r.name, { id, ...r });
const magByName = new Map();
for (const [id, r] of magTaught) if (r.name) magByName.set(r.name, { id, ...r });

const missing = [...schemByName.entries()].filter(([n]) => !appSchemAll.has(n));
const extraMagSourced = [...appSchemAll].filter(n => magByName.has(n));
const extraUnknown = [...appSchemAll].filter(n => !schemByName.has(n) && !magByName.has(n));

P(`### Schematic-taught in 42.20, absent from the app (${missing.length})\n`);
const byCat = new Map();
for (const [name, r] of missing) {
  const k = `${r.category}: ${r.file}`;
  if (!byCat.has(k)) byCat.set(k, []);
  byCat.get(k).push(name);
}
for (const [k, names] of [...byCat].sort()) {
  P(`**${k}** (${names.length})`);
  for (const n of names.sort()) P(`  - ${n}`);
  P('');
}

P(`### Listed on the app's Schematics page but actually magazine-taught (${extraMagSourced.length})\n`);
for (const n of extraMagSourced.sort()) P(`  - ${n}  ←  ${magByName.get(n).id} via ${recipeTaughtBy.get(magByName.get(n).id).join(', ')}`);

P(`\n### In the app but not learnable in 42.20 at all (${extraUnknown.length})\n`);
for (const n of extraUnknown.sort()) P(`  - ${n}`);

P('\n### Duplicated across app categories\n');
const seen = new Map();
for (const c of appSchem) for (const n of c.items) {
  if (!seen.has(n)) seen.set(n, []);
  seen.get(n).push(c.category);
}
let dupes = 0;
for (const [n, cats] of seen) if (cats.length > 1) { P(`  - ${n} → ${cats.join(', ')}`); dupes++; }
if (!dupes) P('  none');

fs.writeFileSync(process.argv[2], out.join('\n') + '\n', 'utf8');
console.log(out.slice(0, 40).join('\n'));
