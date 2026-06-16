# -*- coding: utf-8 -*-
"""
GEnius Catalogue - dynamic category assignment with manual overrides.
Override file: category_overrides.json (checked first, keywords second).
"""

import json
import os
import re

_TIER_RE = re.compile(r'\(tier\s+(\d+)\)|(?<![\d+.])\s(\d+)$', re.IGNORECASE)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OVERRIDES_FILE = os.path.join(SCRIPT_DIR, 'category_overrides.json')

def _load_overrides():
    try:
        with open(OVERRIDES_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return {
            k.lower(): ([v] if isinstance(v, str) else v)
            for k, v in data.items()
            if not k.startswith('_')
        }
    except Exception as e:
        print(f"[catalogue] Could not load overrides: {e}")
        return {}

OVERRIDES = _load_overrides()

CATEGORY_RULES = {

    # --- Rares (discontinued/event items) ---
    "rares": [
        "partyhat", "santa hat", "halloween mask", "h'ween mask",
        "half full jug of wine", "easter egg", " pumpkin",
        "tavia's fishing rod", "hazelmere's signet ring",
        "christmas cracker", "guildmaster tony's mattock",
        "disk of returning", "yo-yo", "rubber chicken",
        "rainbow scarf", "bunny ears", "dragon mask",
        "flared trousers", "pantaloons", "giant present",
        "old school bond", "burnt mystery",
    ],

    # --- Treasure Trails ---
    "treasure_trails": [
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
        # Elegant formal wear
        "elegant",
        # Fancy hats / headwear
        "boater", "cavalier", "headband", "powdered wig",
        "top hat", "sleeping cap", "highwayman mask",
        "pirate's hat", "pith helmet", "spiked helmet",
        # Full outfit sets
        "tuxedo", "pyjama", "bob shirt", "backstab cape",
        # God vestments (mitre / stole / crozier / cloak covered; robes via overrides)
        " mitre", " stole", " crozier",
        # Heraldic armour (h1–h5)
        "(h1)", "(h2)", "(h3)", "(h4)", "(h5)",
        # Canes
        " cane",
        # Limitless staves
        "staff of limitless",
        # Enchanted set
        "enchanted",
        # Briefcase / suitcase cosmetics
        "briefcase", "suitcase",
    ],

    # --- Boss drops ---
    "boss": [
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

    # --- Prayer ---
    "prayer": [
        # Bones
        "dragon bones", "frost dragon bones", "hardened dragon bones",
        "reinforced dragon bones", "airut bones", "dagannoth bones",
        "ourg bones", "wyvern bones", "fayrg bones", "raurg bones",
        "superior dragon bones", "tortured ourg bones",
        "lava dragon bones", "bones to peaches",
        # Any item ending in bones (catches most)
        " bones",
        # Named ashes (NOT base "Ashes" item)
        "infernal ashes", "impious ashes", "accursed ashes",
        "tortured ashes", "searing ashes",
        # Ensouled heads
        "ensouled ",
        # Prayer items
        "prayer potion", "super restore", "saradomin brew",
        "overload", "extreme prayer",
        "blessed flask", "blessed flask",
        "bonecrusher", "attuned ectoplasmator",
        "scripture of jas", "scripture of ful", "scripture of bik",
        "scripture of wen", "scripture of amascut",
    ],

    # --- Archaeology ---
    "archaeology": [
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

    # --- Overrides/Titles/Cosmetics ---
    "overrides": [
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

    # --- Ability Codexes / Incantations ---
    "codex": [
        "ability codex",
        "incantation codex",
        "cosmetic ability",
        "barricade cosmetic",
        " codex",
        "ability scroll",
    ],
    "runes": [
        "fire rune", "water rune", "air rune", "earth rune",
        "mind rune", "body rune", "chaos rune", "nature rune",
        "death rune", "blood rune", "soul rune", "astral rune",
        "cosmic rune", "law rune", "wrath rune",
        "pure essence", "rune essence",
        "combination rune", "mist rune", "dust rune", "mud rune",
        "smoke rune", "steam rune", "lava rune",
        "elemental rune", "catalytic rune",
        # Necromancy runes
        "spirit rune", "flesh rune", "miasma rune", "bone rune",
        "necrotic rune",
    ],

    # --- Summoning ---
    "summoning": [
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
        # Specific pouch/scroll patterns for summoning only
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

    # --- Combat: Necromancy ---
    "hybrid": [
        "anima core body of sliske", "anima core helm of sliske", "anima core legs of sliske", "shadow anima",
        "essence of finality",
        "amulet of souls",
        "reaper necklace",
        "ring of death",
        "reaper's choice",
        "cinderbane",
        "animate dead",
    ],

    # --- Combat: Necromancy ---
    "necromancy": [
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

    # --- Combat: Melee ---
    "melee": [
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

    # --- Combat: Magic ---
    "magic": [
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

    # --- Combat: Ranged ---
    "ranged": [
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

    # --- Combat: Ammo ---
    "ammo": [
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

    # --- Combat: Pocket ---
    "pocket": [
        "scrimshaw", "sign of", "god book", "illuminated",
        "portent", "sign of the porter", "holy wrench",
        "scripture", "brooch of the gods",
        "luck of the dwarves",
    ],

    # --- Skilling: Herblore ---
    "herblore": [
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
        # Herblore secondaries
        "crushed nest", "unicorn horn dust",
        "limpwurt root", "white berries", "potato cactus",
        "jangerberries", "red spiders", "snape grass",
        "mort myre fungus", "blue dragon scale",
        "eye of newt", "wine of zamorak",
        "herb tar", "clean ",
    ],

    # --- Skilling: Smithing ---
    "smithing": [
        " bar", "iron ore", "coal", "mithril ore", "adamantite ore",
        "runite ore", "gold ore", "silver ore", "luminite",
        "orichalcite", "drakolith", "necronium ore", "bane ore",
        "abyssal ore", "elder rune ore", "corrupted ore",
        "bronze bar", "iron bar", "steel bar",
        "mithril bar", "adamantite bar", "runite bar", "elder rune bar",
        "necronium bar", "bane bar",
    ],

    # --- Skilling: Crafting ---
    "crafting": [
        "uncut ", "dragonstone", "onyx", "zenyte", "hydrix",
        "diamond", "ruby", "emerald", "sapphire", "opal",
        "jade", "topaz", "red topaz",
        "leather", "dragonhide", " hide", "d'hide", "snakeskin",
        "gold necklace", "gold ring", "gold bracelet", "gold amulet",
        "necklace of", "amulet of", "ring of", "bracelet of",
        "bowstring", "chisel", "needle",
    ],

    # --- Skilling: Fletching ---
    "fletching": [
        "longbow", "shortbow", "shieldbow", "composite",
        " (u)", "strung", "unstrung",
        "crossbow stock", "limbs", "arrowhead", "arrow tip",
    ],

    # --- Skilling: Food ---
    "food": [
        "raw ", "shark", "rocktail", "monkfish", "lobster",
        "swordfish", "tuna", "salmon", "trout", "cavefish",        "manta ray", "sea turtle", "great white", "baron shark",
        "karambwan", "slimy eel", "lava eel", "cave eel",
        "pineapple", "pizza", "stew", "cake", "bread",
        "potato with", "baked potato",
        "jellyfish", "blue blubber jellyfish",
        "1/3 ", "2/3 ",
        "cooked", "ration", "chilli",
        "summer pie", "wild pie", "fish pie", "admiral pie",
        "mushroom potato", "egg and tomato",
    ],

    # --- Skilling: Farming ---
    "farming": [
        " seed", " sapling", "spore", " cutting",
        "supercompost", "ultracompost", "compost",
        "mushroom", "scarecrow",
        "(unchecked)",
    ],

    # --- Skilling: Gathering (Mining/WC/Divination/Hunter/Fishing materials) ---
    "mining": [
        " logs", "willow log", "maple log", "yew log", "magic log",
        "elder log", "crystal log", "blisterwood log",
        "rune essence", "pure essence", "zephyrium", "bathus",
        "mineral deposit",
        # Divination energies
        "pale energy", "flickering energy", "bright energy", "glowing energy",
        "sparkling energy", "gleaming energy", "vibrant energy", "lustrous energy",
        "brilliant energy", "radiant energy", "luminous energy", "incandescent energy",
        # Spirits
        "wood spirit", "stone spirit",
        # Divine charges (shared with invention)
        "divine charge",
        # Hunter
        "chinchompa", "grenwall",
        "impling jar",
    ],

    # --- Skilling: Construction ---
    "construction": [
        "plank",
        "flatpack",
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

    # --- Combat: Supplies (non-exclusive — items share their primary category) ---
    "supplies": [
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

    # --- Skilling: Invention ---
    "invention": [
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

    # --- Low Tier (T1–T69 weapons and armour — populated via build_overrides.py) ---
    "low_tier": [],

    # --- Materials (catch-all) ---
    "materials": [
        " bones", " ashes", " energy", " scale ", " shard",
        " fragment", " component", " parts", " plating",
        " dye", " thread", " sinew", " fabric",
        " pelt", " charm", " dust", " powder",
        " tooth", " teeth", " claw", " wing", " fur",
        "plank", "log ", "ore ", " herb",
        "abyssal pouch", "abyssal scroll",
        "dinosaur claw", "kebbit claw",
    ],
}

# Categories checked in priority order — first match wins for primary
CATEGORY_PRIORITY = [
    "rares", "treasure_trails", "boss",
    "prayer", "archaeology", "overrides", "codex",
    "runes", "summoning",
    "melee", "magic", "ranged", "necromancy", "hybrid", "ammo", "pocket",
    "herblore", "smithing", "crafting", "fletching", "construction",
    "food", "farming", "mining", "invention",
    "low_tier", "materials", "supplies",
]

# If any of these categories is matched, return it immediately — no secondary
# categories are added. Prevents TT items bleeding into combat tabs, etc.
EXCLUSIVE_CATEGORIES = {"rares", "overrides", "codex"}
_LOW_TIER_STRIP = {"melee", "magic", "ranged", "necromancy", "ammo", "pocket"}

_LOW_TIER_PREFIXES = (
    'bronze ', 'iron ', 'steel ', 'black ', 'white ',
    'leather ', 'hardleather', 'hard leather', 'studded ', 'snakeskin ',
    'frog-leather', 'spined ',
    'mithril ', 'batwing ', 'ghostly ', 'splitbark ', 'mystic ',
    'adamant ', 'lunar ', 'carapace ', "green d'hide", "blue d'hide",
    'rune ', "red d'hide", 'granite ', 'dragon ', 'corrupt ',
    'ricochet ', 'green dragonhide ', 'blue dragonhide ', 'red dragonhide ',
    'oak ', 'willow ', 'maple ', 'yew ', 'magic short', 'magic long',
    'magic comp', "hunter's ", "hunters' ",
)

# Name suffixes that unambiguously indicate a Treasure Trails reward.
# Checked before overrides so base-item partial matches don't intercept TT variants.
_TT_SUFFIXES = ("(g)", "(t)", "(h1)", "(h2)", "(h3)", "(h4)", "(h5)")

# Substrings that unambiguously indicate a cosmetic override item.
# Checked before override lookups for the same reason.
_OVERRIDE_PATTERNS = ("animation override", " override", "override token", "animation token", " token", " emote", "overhead")
_OVERRIDE_EXCEPTIONS = ("mimic kill token",)


def _apply_exclusive(cats, name_lower=""):
    """
    Apply exclusivity rules to a category list:
    - If the highest-priority category is exclusive, return only it.
    - If low_tier is present (or name matches a low-tier prefix), strip base combat categories.
    """
    ordered = [c for c in CATEGORY_PRIORITY if c in cats]
    if ordered and ordered[0] in EXCLUSIVE_CATEGORIES:
        return [ordered[0]]
    check_name = name_lower[len("off-hand "):] if name_lower.startswith("off-hand ") else name_lower
    tier_match = _TIER_RE.search(name_lower)
    tier_is_low = tier_match and int(next(g for g in tier_match.groups() if g is not None)) <= 69
    has_low_tier = "low_tier" in cats or (
        any(c in _LOW_TIER_STRIP for c in cats) and (
            (check_name and any(check_name.startswith(p) for p in _LOW_TIER_PREFIXES))
            or tier_is_low
        )
    )
    if has_low_tier:
        # Keep combat categories for TT items so they show in both tabs
        strip = set() if "treasure_trails" in cats else _LOW_TIER_STRIP
        result = [c for c in cats if c not in strip]
        if "low_tier" not in result:
            result.append("low_tier")
        return result
    return list(cats)


def assign_categories(name):
    """
    Assign sidebar categories to an item.
    Checks manual overrides first, then keyword rules.
    Exclusive categories (TT, Rares, Boss, Codex, Overrides) stop further matching.
    """
    name_lower = name.lower().strip()

    # 1. Exact manual overrides win over all pre-checks so that items like
    #    "rune platebody (g)" with explicit secondary categories aren't short-
    #    circuited by the TT-suffix pre-check below.
    if name_lower in OVERRIDES:
        return _apply_exclusive(list(OVERRIDES[name_lower]), name_lower)

    # 0a. TT suffix patterns — prevents base-item partial matches
    #     (e.g. "adamant platebody") from intercepting "(h1)/(g)/(t)" variants
    if any(sfx in name_lower for sfx in _TT_SUFFIXES):
        return ["treasure_trails"]

    # 0b. Override/animation patterns win unless explicitly excluded
    if (any(pat in name_lower for pat in _OVERRIDE_PATTERNS)
            and name_lower not in _OVERRIDE_EXCEPTIONS):
        return ["overrides"]

    # 0c. Unstrung bows/crossbows are always fletching materials
    if "(unstrung)" in name_lower:
        return ["fletching"]

    # 2. Partial match overrides (meaningful substrings 5+ chars)
    for override_key, cats in OVERRIDES.items():
        if len(override_key) >= 5:
            if override_key in name_lower:
                return _apply_exclusive(list(cats), name_lower)

    # 3. Keyword rules in priority order
    assigned = []
    for category in CATEGORY_PRIORITY:
        keywords = CATEGORY_RULES.get(category, [])
        for kw in keywords:
            if kw.lower() in name_lower:
                if category not in assigned:
                    assigned.append(category)
                break
        # Exclusive categories stop here — don't also tag as melee/magic/etc.
        if assigned and assigned[0] in EXCLUSIVE_CATEGORIES:
            return assigned

    if assigned:
        return _apply_exclusive(assigned, name_lower)
    return ["materials"]


def reload_overrides():
    global OVERRIDES
    OVERRIDES = _load_overrides()
    print(f"[catalogue] Reloaded {len(OVERRIDES)} overrides")


if __name__ == "__main__":
    reload_overrides()
    test_items = [
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
    ]
    print("\nCategory assignment test:")
    for item in test_items:
        cats = assign_categories(item)
        print(f"  {item:<45} -> {cats}")
