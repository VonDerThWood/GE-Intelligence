"""
GEnius Catalogue — dynamically built from RS3 GE data.
Category assignments for the sidebar tabs.
"""

# Sidebar category keywords — item names containing these strings
# get assigned to that category. Order matters (first match wins for primary).
CATEGORY_RULES = {
    "melee": [
        "whip", "rapier", "longsword", "scimitar", "mace", "maul", "claws",
        "halberd", "spear", "sword", "dagger", "battleaxe", "warhammer",
        "drygore", "noxious scythe", "torva", "masterwork", "malevolent",
        "chaotic rapier", "chaotic longsword", "chaotic maul", "chaotic claws",
        "abyssal", "berserker", "seercull", "zamorakian spear",
    ],
    "magic": [
        "wand", "orb", "staff", "virtus", "tectonic", "seasinger",
        "seismic", "ahrim", "arcane", "subjugation", "zuriel",
        "soulbound", "fractured staff",
    ],
    "ranged": [
        "bow", "crossbow", "ascension", "eldritch", "pernix", "sirenic",
        "armadyl helm", "armadyl chest", "armadyl chain", "armadyl body",
        "karil", "death lotus", "hexhunter",
    ],
    "ammo": [
        "arrow", "bolt", "cannonball", "javelin", "dart", "throwing",
        "arrowhead", "bolt tip", "feather", "broad bolt", "broad arrow",
    ],
    "pocket": [
        "scrimshaw", "sign of", "god book", "illuminated", "lucky", "portent",
    ],
    "herblore": [
        "overload", "extreme ", "super restore", "saradomin brew",
        "prayer potion", "grimy", "herb", "potion", "vial", "unf potion",
        "clean ", "torstol", "snapdragon", "ranarr", "lantadyme",
        "dwarf weed", "kwuarm", "cadantine", "avantoe", "irit", "toadflax",
        "harralander", "tarromin", "guam", "marrentill",
    ],
    "smithing": [
        " bar", " ore", "smelting", "elder rune", "necronium", "bane ore",
        "orichalcite", "drakolith", "luminite", "corrupted ore",
    ],
    "crafting": [
        "uncut ", "dragonstone", "onyx", "zenyte", "hydrix", "diamond",
        "ruby", "emerald", "sapphire", "opal", "jade", "topaz", "red topaz",
        "leather", "dragonhide", "hide", "d'hide", "snakeskin",
        "gold necklace", "gold ring", "gold bracelet", "gold amulet",
        "necklace", "amulet", "ring of", "bracelet",
    ],
    "fletching": [
        "longbow", "shortbow", "shieldbow", "composite", "arrow shaft",
        "fletch", "strung", "unstrung", "bowstring", "crossbow stock",
    ],
    "cooking": [
        "raw ", "shark", "rocktail", "monkfish", "lobster", "swordfish",
        "tuna", "salmon", "trout", "cavefish", "manta ray", "sea turtle",
        "great white", "baron shark", "karambwan",
    ],
    "farming": [
        "seed", "sapling", "spore", "cutting", "plant", "mushroom",
        "compost", "supercompost", "ultracompost",
    ],
    "mining": [
        "log", "logs", "coal", "iron ore", "gold ore", "mithril ore",
        "adamantite ore", "runite ore", "essence", "willow", "maple",
        "yew log", "magic log", "elder log", "crystal", "corrupted",
    ],
    "materials": [
        "bones", "ashes", "rune", "energy", "scale", "shard", "fragment",
        "component", "parts", "plating", "dye", "paint", "thread",
        "fabric", "hide ", "skin", "tooth", "claw ", "wing", "fur",
        "pelt", "charm", "soul", "dust", "powder", "stone", "gem",
        "ore ", "bar ", "plank", "log ", "herb ", "seed ",
    ],
}

def assign_categories(name):
    """Assign sidebar categories to an item based on its name."""
    name_lower = name.lower()
    assigned = []
    for category, keywords in CATEGORY_RULES.items():
        for kw in keywords:
            if kw in name_lower:
                if category not in assigned:
                    assigned.append(category)
                break
    return assigned if assigned else ["materials"]