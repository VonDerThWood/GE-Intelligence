/**
 * GEnius Catalogue - dynamic category assignment with manual overrides.
 * Override files (checked first, keywords second):
 *   category_overrides.json - bulk/dev-curated, edited directly in the
 *     project (e.g. via build_overrides.js or hand edits).
 *   personal_overrides.json - Ben's individual per-item edits made
 *     through the in-app Settings category editor. Kept in a SEPARATE
 *     file specifically so the two never collide — one whole-file copy
 *     used to carry personal edits forward into new builds, which once
 *     silently clobbered a whole session's worth of bulk catalogue
 *     fixes (see SESSION_LOG.md, 2026-06-26). Personal entries always
 *     win when both files have the same item.
 *
 * Faithful JS port of python/catalogue.py (Python-to-JS backend
 * migration, see TODO.txt / SESSION_LOG.md, 2026-06-26). Verify against
 * the Python original on the full live item catalogue before trusting
 * this over it — this module is pure string-matching logic with no
 * network calls, so it can (and should) be checked against every item,
 * not just a sample.
 */

const fs = require('fs');
const path = require('path');

// Python: re.compile(r'\(tier\s+(\d+)\)|(?<![\d+.])\s(\d+)$', re.IGNORECASE)
const _TIER_RE = /\(tier\s+(\d+)\)|(?<![\d+.])\s(\d+)$/i;

const SCRIPT_DIR = __dirname;
const OVERRIDES_FILE = path.join(SCRIPT_DIR, 'data', 'category_overrides.json');
const PERSONAL_OVERRIDES_FILE = path.join(SCRIPT_DIR, 'data', 'personal_overrides.json');

function _loadOverridesFile(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith('_')) continue;
      out[k.toLowerCase()] = Array.isArray(v) ? v : [v];
    }
    return out;
  } catch (e) {
    console.log(`[catalogue] Could not load overrides from ${filePath}: ${e.message}`);
    return {};
  }
}

function _loadOverrides() {
  const base = _loadOverridesFile(OVERRIDES_FILE);
  const personal = _loadOverridesFile(PERSONAL_OVERRIDES_FILE);
  return { ...base, ...personal };
}

let OVERRIDES = _loadOverrides();

const CATEGORY_RULES = {

  // --- Rares (discontinued/event items) ---
  rares: [
    "partyhat", "santa hat", "halloween mask", "h'ween mask",
    "half full jug of wine", "easter egg", " pumpkin",
    "tavia's fishing rod", "hazelmere's signet ring",
    "christmas cracker", "guildmaster tony's mattock",
    "disk of returning", "yo-yo", "rubber chicken",
    "rainbow scarf", "bunny ears", "dragon mask",
    "flared trousers", "pantaloons", "giant present",
    "old school bond", "burnt mystery",
  ],

  // --- Treasure Trails ---
  treasure_trails: [
    "3rd age", "third age",
    "shadow dye", "blood dye", "ice dye", "barrows dye",
    "third age dye", "guthix dye", "saradomin dye", "zamorak dye",
    "armadyl dye", "bandos dye", "seren dye", "ancient dye",
    "gilded ", "trimmed rune", "trimmed adamant", "trimmed dragon",
    "ornament kit",
    "fortunate component",
    "ranger boots", "robin hood",
    "medium clue", "hard clue", "elite clue", "master clue",
    "clue scroll",
    "ring of coins", "ring of trees",
    "blessed dragonhide", "blessed d'hide",
    "(t) ", "(g) ", " (t)", " (g)",
    "morrigan's",
    "statius's", "statius'",
    "vesta's",
    "zuriel's",
    "composite bow",
    "wizard boots",
    "climbing boots (g)",
    "mime", "zombie", "jester",
    "second age",
    "orlando smith",
    "strung rabbit's foot",
    "elegant",
    "boater", "cavalier", "headband", "powdered wig",
    "top hat", "sleeping cap", "highwayman mask",
    "pirate's hat", "pith helmet", "spiked helmet",
    "tuxedo", "pyjama", "bob shirt", "backstab cape",
    " mitre", " stole", " crozier",
    "(h1)", "(h2)", "(h3)", "(h4)", "(h5)",
    " cane",
    "staff of limitless",
    "enchanted",
    "briefcase", "suitcase",
  ],

  // --- Boss drops ---
  boss: [
    "araxxi", "araxxor",
    "telos", "anima",
    "solak", "laceration boots", "blast diffusion boots",
    "erethdor's grimoire", "merciless kiteshield",
    "vorago", "seismic wand", "seismic singularity",
    "nex:", "nex -", "pernix", "torva", "virtus",
    "ancient emblem", "ancient statuette", "ancient medallion",
    "ancient effigy", "ancient artwork", "ancient totem",
    "helwyr", "cywir",
    "twin furies", "blade of avaryss", "blade of nymora",
    "gregorovic", "shadow glaive", "off-hand shadow glaive",
    "beastmaster durzag", "kethsi",
    "yakamaru", "blightbound crossbow",
    "ambassador", "eldritch crossbow",
    "seiryu", "azure crystal",
    "berserk aura", "mahjarrat aura",
    "raids",
    "glacor", "glacyte",
    "kalphite king",
    "tormented demon",
    "divine sigil", "arcane sigil", "elysian sigil", "spectral sigil",
    "armadyl hilt", "bandos hilt", "zamorak hilt", "saradomin hilt",
    "godsword shard",
    "zaros godsword", "seren godbow", "staff of sliske",
    "dragonrider",
    "fractured staff of armadyl",
    "soulbound lantern",
    "hexhunter bow",
    "inquisitor's",
  ],

  // --- Prayer ---
  prayer: [
    "dragon bones", "frost dragon bones", "hardened dragon bones",
    "reinforced dragon bones", "airut bones", "dagannoth bones",
    "ourg bones", "wyvern bones", "fayrg bones", "raurg bones",
    "superior dragon bones", "tortured ourg bones",
    "lava dragon bones", "bones to peaches",
    " bones",
    "infernal ashes", "impious ashes", "accursed ashes",
    "tortured ashes", "searing ashes",
    "ensouled ",
    "prayer potion", "super restore", "saradomin brew",
    "overload", "extreme prayer",
    "blessed flask", "blessed flask",
    "bonecrusher", "attuned ectoplasmator",
    "scripture of jas", "scripture of ful", "scripture of bik",
    "scripture of wen", "scripture of amascut",
  ],

  // --- Archaeology ---
  archaeology: [
    "ancient vis", "blood of orcus", "hellfire metal",
    "goldrune", "zemphurite", "orthenglass", "quintessence",
    "silvthril", "everlight silvthril", "third age iron",
    "mark of the kyzaj",
    "qualite", "vulcanite",
    "saradominist", "zamorakian", "kharidian",
    " soil", "archaeological soil",
    "artefact", "mystery",
    "chronotes",
    "tetracompass",
    "warped gem",
    "ancient cogwheel",
    "pontifex shadow ring",
    "guildmaster tony",
    "mattock",
    "ancient casket",
    "xp lamp (archaeology)",
  ],

  // --- Cosmetics (renamed from Overrides/Titles) ---
  // The keyword list itself was fine as a broad catch-all (tokens,
  // titles, makeover, hairstyle, etc.) — Ben's actual ask was narrower:
  // among items that are ALSO Treasure Trails rewards, only the dyes
  // should keep the Cosmetics tag too; every other TT reward that
  // happens to match one of these generic keywords (e.g. "blessed"
  // matching the "Blessed dragonhide (god)" TT armor) should show up
  // as Treasure Trails ONLY. That's enforced in the matching loop below
  // (see the cosmetics+treasure_trails guard), not by trimming this list.
  cosmetics: [
    " title", "title scroll", " token",
    "cosmetic override", "override token", "cosmetic token",
    "outfit token", "makeover", "hairstyle",
    "interface token", "prismatic token", "golden token",
    "silver token", "loyalty point",
    "cape token", "weapon token", "armour token",
    "cosmetic", "override",
    "premier club", "membership card",
    "penguin token", "character token",
    "pet token", "companion pet",
    "blessed",
  ],

  // --- Ability Codexes / Incantations ---
  codex: [
    "ability codex",
    "incantation codex",
    "cosmetic ability",
    "barricade cosmetic",
    " codex",
    "ability scroll",
  ],
  runes: [
    "fire rune", "water rune", "air rune", "earth rune",
    "mind rune", "body rune", "chaos rune", "nature rune",
    "death rune", "blood rune", "soul rune", "astral rune",
    "cosmic rune", "law rune", "wrath rune",
    "pure essence", "rune essence",
    "combination rune", "mist rune", "dust rune", "mud rune",
    "smoke rune", "steam rune", "lava rune",
    "elemental rune", "catalytic rune",
    "spirit rune", "flesh rune", "miasma rune", "bone rune",
    "necrotic rune",
  ],

  // --- Summoning ---
  summoning: [
    "gold charm", "green charm", "crimson charm", "blue charm",
    "spirit gem",
    "wolf bones", "big bones", "bat bones",
    "raw chicken", "raw bird meat",
    "spirit shard", "summoning potion",
    "talon beast", "void ravager", "iron titan",
    "steel titan", "lava titan", "swamp titan",
    "moss titan", "ice titan", "fire titan",
    "unicorn stallion", "bunyip", "geyser titan",
    "smoke devil", "stranger plant",
    "pack yak", "war tortoise", "spirit terrorbird",
    "mammoth",
    "compost mound",
    "granite lobster",
    "barker toad",
    "jackalope",
    "titan pouch", "titan scroll",
    "stallion pouch", "stallion scroll",
    "terrorbird pouch", "terrorbird scroll",
    "bunyip pouch", "bunyip scroll",
    "yak pouch", "yak scroll",
    "tortoise pouch", "tortoise scroll",
    "mammoth pouch", "mammoth scroll",
    "geyser titan pouch", "geyser titan scroll",
    "smoke devil pouch", "smoke devil scroll",
  ],

  // --- Combat: Necromancy (hybrid) ---
  hybrid: [
    "anima core body of sliske", "anima core helm of sliske", "anima core legs of sliske", "shadow anima",
    "essence of finality",
    "amulet of souls",
    "reaper necklace",
    "ring of death",
    "reaper's choice",
    "cinderbane",
    "animate dead",
  ],

  // --- Combat: Necromancy ---
  necromancy: [
    "deathwarden", "deathdealer",
    "omni guard", "death guard",
    "skull lantern",
    "necrotic", "necromancy",
    "bloat", "invoke death", "threads of fate",
    "darkness sigil",
    "communion", "conjure",
    "undead slayer",
    "ascended", "cryptbloom",
    "ancient lantern",
    "ward of subjugation",
    "necroplasm",
    "glacyte remains",
    "memento",
    "ghostly ink",
  ],

  // --- Combat: Melee ---
  melee: [
    "drygore", "noxious scythe",
    "torva full helm", "torva platebody", "torva platelegs",
    "chaotic rapier", "chaotic longsword", "chaotic maul", "chaotic claws",
    "abyssal whip", "abyssal vine whip", "lava whip", "frost whip",
    "godsword", "saradomin sword",
    "dragon scimitar", "dragon sword", "dragon dagger", "dragon mace",
    "dragon halberd", "dragon warhammer", "dragon battleaxe",
    "obsidian maul", "obsidian sword",
    "elder rune sword", "elder rune mace", "elder rune warhammer",
    "elder rune halberd", "elder rune battleaxe", "elder rune dagger",
    "elder rune scimitar", "elder rune claws",
    "necronium sword", "necronium mace", "necronium warhammer",
    "bane sword", "bane mace", "bane warhammer",
    "spear of annihilation",
    "masterwork helm", "masterwork platebody", "masterwork platelegs",
    "masterwork gloves", "masterwork boots",
    "trimmed masterwork helm", "trimmed masterwork platebody",
    "trimmed masterwork platelegs", "trimmed masterwork gloves",
    "trimmed masterwork boots",
    "tumeken's light", "ek-zekkil",
    "blade of avaryss", "blade of nymora",
    "inquisitor's staff", "inquisitor's hauberk", "inquisitor's plateskirt",
    "inquisitor's great helm",
  ],

  // --- Combat: Magic ---
  magic: [
    "seismic wand", "seismic singularity",
    "tectonic mask", "tectonic robe",
    "virtus wand", "virtus book", "virtus mask", "virtus robe",
    "noxious staff", "chaotic staff",
    "abyssal wand", "abyssal orb",
    "soulbound lantern", "fractured staff",
    "staff of light", "staff of darkness", "ancient staff",
    "armadyl battlestaff", "saradomin's staff",
    "mystic", "war mage", "battle robe",
    "subjugation", "ahrim",
    "arcane spirit shield",
    "masterwork staff of armadyl",
  ],

  // --- Combat: Ranged ---
  ranged: [
    "crossbow", "ascension crossbow", "eldritch crossbow",
    "noxious longbow",
    "pernix cowl", "pernix body", "pernix chaps",
    "sirenic mask", "sirenic hauberk", "sirenic chaps",
    "chaotic crossbow",
    "death lotus",
    "royal crossbow", "zaryte bow",
    "armadyl helmet", "armadyl chestplate", "armadyl chainskirt",
    "karil",
    "bow of the last guardian",
    "blightbound crossbow", "off-hand blightbound crossbow",
    "hexhunter bow",
    "masterwork bow",
  ],

  // --- Combat: Ammo ---
  ammo: [
    "bolt tips", "arrowhead", "arrow shaft",
    "bolt ", " bolts", "cannonball", "javelin", "dart ",
    " arrow", "broad bolt", "broad arrow",
    "ascension shard", "hydrix bolts", "onyx bolts",
    "bakriminel bolts", "ascendri bolts", "dragon bolts",
    "rune arrow", "dragon arrow",
    "feather of ma'at",
    "silverhawk feather",
    "deathspore arrow",
    "unfinished bolt",
    "mechanized chinchompa",
  ],

  // --- Combat: Pocket ---
  pocket: [
    "scrimshaw", "sign of", "god book", "illuminated",
    "portent", "sign of the porter", "holy wrench",
    "scripture", "brooch of the gods",
    "luck of the dwarves",
  ],

  // --- Skilling: Herblore ---
  herblore: [
    "grimy ", "overload", "extreme attack", "extreme strength",
    "extreme defence", "extreme magic", "extreme ranging",
    "super restore", "saradomin brew", "prayer potion",
    "super attack", "super strength", "super defence",
    "super ranging", "super magic", "super prayer",
    "elder overload", "divine super", "enhanced excalibur",
    " potion (", " mix (", "unfinished",
    "torstol", "snapdragon", "ranarr", "lantadyme",
    "dwarf weed", "kwuarm", "cadantine", "avantoe",
    "irit leaf", "toadflax", "harralander", "tarromin",
    "guam leaf", "marrentill", "vial of water", "vial",
    "morchella",
    "powerburst",
    "aggroverload", "holy aggroverload",
    "overload recipe", "overload ingredient",
    "crushed nest", "unicorn horn dust",
    "limpwurt root", "white berries", "potato cactus",
    "jangerberries", "red spiders", "snape grass",
    "mort myre fungus", "blue dragon scale",
    "eye of newt", "wine of zamorak",
    "herb tar", "clean ",
  ],

  // --- Skilling: Artisan (Smithing + Crafting + Fletching +
  // Construction merged — Ben's call: all four are "make stuff out of
  // raw materials" and didn't need to be four separate tabs. Herblore
  // and Archaeology are technically the same kind of skill but Ben
  // wants those kept as their own tabs — they're "involved enough to
  // deserve it.") ---
  artisan: [
    " bar", "iron ore", "coal", "mithril ore", "adamantite ore",
    "runite ore", "gold ore", "silver ore", "luminite",
    "orichalcite", "drakolith", "necronium ore", "bane ore",
    "abyssal ore", "elder rune ore", "corrupted ore",
    "bronze bar", "iron bar", "steel bar",
    "mithril bar", "adamantite bar", "runite bar", "elder rune bar",
    "necronium bar", "bane bar",
    "uncut ", "dragonstone", "onyx", "zenyte", "hydrix",
    "diamond", "ruby", "emerald", "sapphire", "opal",
    "jade", "topaz", "red topaz",
    "leather", "dragonhide", " hide", "d'hide", "snakeskin",
    "gold necklace", "gold ring", "gold bracelet", "gold amulet",
    "necklace of", "amulet of", "ring of", "bracelet of",
    "bowstring", "chisel", "needle",
    "longbow", "shortbow", "shieldbow", "composite",
    " (u)", "strung", "unstrung",
    "crossbow stock", "limbs", "arrowhead", "arrow tip",
    "plank",
    "flatpack",
    "frame",
    " nails",
    "limestone brick",
    "gold leaf",
    "marble block",
    "magic stone",
    "clockwork",
    "bagged plant",
    "bagged tree",
    "bagged bush",
    "bolt of cloth",
  ],

  // --- Skilling: Food ---
  food: [
    "raw ", "shark", "rocktail", "monkfish", "lobster",
    "swordfish", "tuna", "salmon", "trout", "cavefish", "manta ray", "sea turtle", "great white", "baron shark",
    "karambwan", "slimy eel", "lava eel", "cave eel",
    "pineapple", "pizza", "stew", "cake", "bread",
    "potato with", "baked potato",
    "jellyfish", "blue blubber jellyfish",
    "1/3 ", "2/3 ",
    "cooked", "ration", "chilli",
    "summer pie", "wild pie", "fish pie", "admiral pie",
    "mushroom potato", "egg and tomato",
  ],

  // --- Skilling: Farming ---
  farming: [
    " seed", " sapling", "spore", " cutting",
    "supercompost", "ultracompost", "compost",
    "mushroom", "scarecrow",
    "(unchecked)",
  ],

  // --- Skilling: Gathering (Mining/WC/Divination/Hunter/Fishing materials) ---
  mining: [
    " logs", "willow log", "maple log", "yew log", "magic log",
    "elder log", "crystal log", "blisterwood log",
    "rune essence", "pure essence", "zephyrium", "bathus",
    "mineral deposit",
    "pale energy", "flickering energy", "bright energy", "glowing energy",
    "sparkling energy", "gleaming energy", "vibrant energy", "lustrous energy",
    "brilliant energy", "radiant energy", "luminous energy", "incandescent energy",
    "wood spirit", "stone spirit",
    "divine charge",
    "chinchompa", "grenwall",
    "impling jar",
    "wood box", "ore box",
  ],


  // --- Combat: Supplies (non-exclusive — items share their primary category) ---
  supplies: [
    "saradomin brew",
    "aggression potion",
    "vulnerability bomb",
    "prayer potion",
    "super restore",
    "super guthix rest",
    "overload ingredient",
    "super prayer renewal",
    "prayer renewal",
  ],

  // --- Skilling: Invention ---
  invention: [
    "blueprint",
    "siphon",
    "capacitor",
    "divine charge",
    "accumulator",
    "mechanized chinchompa",
    "component crate",
    "augmentor",
    "augmentation kit",
    "charge pack",
    "junk refiner",
    "extreme invention",
    "invention potion",
    "inventor's",
  ],

  // --- Low Tier (T1–T69 weapons and armour — populated via build_overrides.py) ---
  low_tier: [],

  // --- Materials (catch-all) ---
  materials: [
    " bones", " ashes", " energy", " scale ", " shard",
    " fragment", " component", " parts", " plating",
    " dye", " thread", " sinew", " fabric",
    " pelt", " charm", " dust", " powder",
    " tooth", " teeth", " claw", " wing", " fur",
    "plank", "log ", "ore ", " herb",
    "abyssal pouch", "abyssal scroll",
    "dinosaur claw", "kebbit claw",
  ],
};

// Categories checked in priority order — first match wins for primary
const CATEGORY_PRIORITY = [
  "rares", "treasure_trails", "boss",
  "prayer", "archaeology", "cosmetics", "codex",
  "runes", "summoning",
  "melee", "magic", "ranged", "necromancy", "hybrid", "ammo", "pocket",
  "herblore", "artisan",
  "food", "farming", "mining", "invention",
  "low_tier", "materials", "supplies",
];

// If any of these categories is matched, return it immediately — no secondary
// categories are added. Prevents TT items bleeding into combat tabs, etc.
const EXCLUSIVE_CATEGORIES = new Set(["rares", "cosmetics", "codex"]);
const _LOW_TIER_STRIP = new Set(["melee", "magic", "ranged", "necromancy", "ammo", "pocket"]);

const _LOW_TIER_PREFIXES = [
  'bronze ', 'iron ', 'steel ', 'black ', 'white ',
  'leather ', 'hardleather', 'hard leather', 'studded ', 'snakeskin ',
  'frog-leather', 'spined ',
  'mithril ', 'batwing ', 'ghostly ', 'splitbark ', 'mystic ',
  'adamant ', 'lunar ', 'carapace ', "green d'hide", "blue d'hide",
  'rune ', "red d'hide", 'granite ', 'dragon ', 'corrupt ',
  'ricochet ', 'green dragonhide ', 'blue dragonhide ', 'red dragonhide ',
  'oak ', 'willow ', 'maple ', 'yew ', 'magic short', 'magic long',
  'magic comp', "hunter's ", "hunters' ",
];

// Name suffixes that unambiguously indicate a Treasure Trails reward.
// Checked before overrides so base-item partial matches don't intercept TT variants.
const _TT_SUFFIXES = ["(g)", "(t)", "(h1)", "(h2)", "(h3)", "(h4)", "(h5)"];

// Substrings that unambiguously indicate a cosmetic override item.
// Checked before override lookups for the same reason.
const _OVERRIDE_PATTERNS = ["animation override", " override", "override token", "animation token", " token", " emote", "overhead"];
const _OVERRIDE_EXCEPTIONS = new Set(["mimic kill token"]);

function _applyExclusive(cats, nameLower = "") {
  // Apply exclusivity rules to a category list:
  // - If the highest-priority category is exclusive, return only it.
  // - If low_tier is present (or name matches a low-tier prefix), strip base combat categories.
  const catsSet = new Set(cats);
  const ordered = CATEGORY_PRIORITY.filter(c => catsSet.has(c));
  if (ordered.length && EXCLUSIVE_CATEGORIES.has(ordered[0])) {
    return [ordered[0]];
  }
  const checkName = nameLower.startsWith("off-hand ") ? nameLower.slice("off-hand ".length) : nameLower;
  const tierMatch = nameLower.match(_TIER_RE);
  let tierIsLow = false;
  if (tierMatch) {
    const g = tierMatch[1] !== undefined ? tierMatch[1] : tierMatch[2];
    tierIsLow = g !== undefined && parseInt(g, 10) <= 69;
  }
  const hasLowTier = catsSet.has("low_tier") || (
    cats.some(c => _LOW_TIER_STRIP.has(c)) && (
      (checkName && _LOW_TIER_PREFIXES.some(p => checkName.startsWith(p))) || tierIsLow
    )
  );
  if (hasLowTier) {
    // Keep combat categories for TT items so they show in both tabs
    const strip = catsSet.has("treasure_trails") ? new Set() : _LOW_TIER_STRIP;
    const result = cats.filter(c => !strip.has(c));
    if (!result.includes("low_tier")) result.push("low_tier");
    return result;
  }
  return [...cats];
}


function assignCategories(name) {
  // Assign sidebar categories to an item.
  // Checks manual overrides first, then keyword rules.
  // Exclusive categories (Rares, Codex, Cosmetics) stop further matching
  // as soon as THEY are the one that just matched, not just when first.
  const nameLower = name.toLowerCase().trim();

  // 1. Exact manual overrides win over all pre-checks so that items like
  //    "rune platebody (g)" with explicit secondary categories aren't short-
  //    circuited by the TT-suffix pre-check below.
  if (nameLower in OVERRIDES) {
    return _applyExclusive([...OVERRIDES[nameLower]], nameLower);
  }

  // 0a. TT suffix patterns — prevents base-item partial matches
  //     (e.g. "adamant platebody") from intercepting "(h1)/(g)/(t)" variants
  if (_TT_SUFFIXES.some(sfx => nameLower.includes(sfx))) {
    return ["treasure_trails"];
  }

  // 0b. Override/animation patterns win unless explicitly excluded
  if (_OVERRIDE_PATTERNS.some(pat => nameLower.includes(pat)) && !_OVERRIDE_EXCEPTIONS.has(nameLower)) {
    return ["cosmetics"];
  }

  // 0c. Unstrung bows/crossbows are always fletching (now Artisan) materials
  if (nameLower.includes("(unstrung)")) {
    return ["artisan"];
  }

  // 0d. Storage boxes (Ore box, Wood box) are Gathering tools, not the raw
  // material itself — without this, "Iron ore box" etc. would also match
  // smithing's "iron ore"/"mithril ore"/etc. keywords below and pick up a
  // misleading secondary smithing tag.
  if (nameLower.includes("ore box") || nameLower.includes("wood box")) {
    return ["mining"];
  }

  // 2. Partial match overrides (meaningful substrings 5+ chars)
  for (const [overrideKey, cats] of Object.entries(OVERRIDES)) {
    if (overrideKey.length >= 5 && nameLower.includes(overrideKey)) {
      return _applyExclusive([...cats], nameLower);
    }
  }

  // 3. Keyword rules in priority order
  const assigned = [];
  for (const category of CATEGORY_PRIORITY) {
    // Ben: TT items shouldn't bleed into Artisan specifically — e.g.
    // "Ring of trees" (TT reward) also matches artisan's generic "ring
    // of" jewelry keyword, "Ruby Cane" matches artisan's "ruby" gem
    // keyword. Other TT+category combos (Construction via "Gilded ...
    // (flatpack)", low_tier, etc.) are left alone — those look
    // intentional/useful, not reported as wrong, so this is scoped to
    // just the one pairing that was actually flagged.
    if (category === "artisan" && assigned.includes("treasure_trails")) continue;
    // Same idea for Cosmetics: its keyword list is intentionally broad
    // (tokens/titles/makeover/"blessed"/etc, kept as-is per Ben — "all
    // of those tokens and stuff were fine before"). But a TT reward
    // that happens to match one of those generic words (e.g. "Blessed
    // dragonhide body (Zamorak)" matching "blessed") should show as
    // Treasure Trails ONLY, not also Cosmetics — dyes are the one
    // exception Ben wants kept, and dyes are handled entirely through
    // manual category_overrides.json entries (not this keyword list at
    // all), so blocking the keyword path here doesn't affect them.
    if (category === "cosmetics" && assigned.includes("treasure_trails")) continue;
    const keywords = CATEGORY_RULES[category] || [];
    let matchedThisCategory = false;
    for (const kw of keywords) {
      if (nameLower.includes(kw.toLowerCase())) {
        if (!assigned.includes(category)) assigned.push(category);
        matchedThisCategory = true;
        break;
      }
    }
    // Exclusive categories stop the loop the moment THEY match, not only
    // when one happens to be first — e.g. "Blessed dragonhide body
    // (Zamorak)" matches treasure_trails first (not itself exclusive),
    // then overrides (which IS exclusive): checking only assigned[0]
    // never caught this, so the loop kept going and also picked up
    // "dragonhide" -> artisan, bleeding a pure TT cosmetic into a
    // gameplay materials tab. Checking the category just matched fixes
    // it while leaving deliberate treasure_trails+gameplay-category
    // pairings (e.g. "Armadyl robe" -> treasure_trails+prayer, set via
    // manual override, a different code path) untouched.
    if (matchedThisCategory && EXCLUSIVE_CATEGORIES.has(category)) {
      return assigned;
    }
  }

  if (assigned.length) {
    return _applyExclusive(assigned, nameLower);
  }
  return ["materials"];
}


function reloadOverrides() {
  OVERRIDES = _loadOverrides();
  console.log(`[catalogue] Reloaded ${Object.keys(OVERRIDES).length} overrides`);
}

module.exports = { assignCategories, reloadOverrides, _applyExclusive };

if (require.main === module) {
  reloadOverrides();
  const testItems = [
    "Swordfish", "Masterwork thread", "Masterwork platebody",
    "Masterwork staff of armadyl", "Tumeken's light", "Ek-Zekkil",
    "Bow of the Last Guardian",
    "Blue partyhat", "Santa hat", "H'ween mask",
    "Dragon bones", "Frost dragon bones", "Infernal ashes",
    "Ashes",
    "3rd age full helmet", "Shadow dye", "Gilded platebody",
    "Noxious scythe", "Noxious staff", "Noxious longbow",
    "Araxxor", "Araxxi's fang",
    "Chronotes", "Goldrune", "Third age iron",
    "Blue blubber jellyfish", "2/3 blue blubber jellyfish",
    "1/3 blue blubber jellyfish",
    "Title: The Completionist",
    "Cosmetic override token",
  ];
  console.log("\nCategory assignment test:");
  for (const item of testItems) {
    const cats = assignCategories(item);
    console.log(`  ${item.padEnd(45)} -> [${cats.join(', ')}]`);
  }
}
