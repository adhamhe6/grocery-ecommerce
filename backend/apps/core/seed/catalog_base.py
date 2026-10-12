"""Departments, categories, brands and the product-record helper used by the demo catalogue.

This module is plain data: it must stay importable without Django (the illustration generator imports it).
Everything here is demonstration content. Brand names are invented; no trademark search has been done.
"""

from __future__ import annotations

from decimal import Decimal

# --------------------------------------------------------------------------- departments and categories
# (slug, name, description, sort_order, show_on_home)
DEPARTMENTS = [
    (
        "fresh-produce",
        "Fresh Produce",
        "Fruit, vegetables, salad leaves and herbs, sold loose by weight, by the piece or in packs.",
        10,
        True,
    ),
    (
        "pantry",
        "Pantry",
        "Cupboard staples: rice, pasta, flour, oils, spices, sauces, tinned goods and breakfast foods.",
        20,
        True,
    ),
    ("chilled-dairy", "Chilled & Dairy", "Milk, cheese, yogurt, butter, eggs and chilled drinks.", 30, True),
    ("bakery", "Bakery", "Loaves, rolls, pastries and cakes, some made to order.", 40, True),
    (
        "meat-fish-frozen",
        "Meat, Fish & Frozen",
        "Chilled meat, poultry and seafood, plus frozen vegetables, fruit and ready meals.",
        50,
        True,
    ),
    ("drinks-snacks", "Drinks & Snacks", "Water, juices, coffee and tea, nuts, dried fruit and snacks.", 60, True),
    (
        "specialty-home",
        "Specialty & Home",
        "Plant-based and gluten-free lines, baby items, and household and personal-care basics.",
        70,
        False,
    ),
]

# department slug -> [(slug, name, description, sku_prefix)]
CATEGORIES = {
    "fresh-produce": [
        ("vegetables", "Vegetables", "Everyday vegetables sold loose by weight, by the piece or in packs.", "VEG"),
        ("fruit", "Fruit", "Apples, bananas, pears, avocados and grapes.", "FRU"),
        ("leafy-greens", "Leafy Greens", "Spinach, lettuce and kale, sold by the pack, head or bunch.", "LGR"),
        ("herbs", "Herbs", "Bunches of soft herbs for cooking and garnish.", "HRB"),
        ("citrus", "Citrus", "Oranges, lemons, limes and mandarins.", "CIT"),
        ("berries", "Berries", "Strawberries, blueberries and raspberries in pre-packed punnets.", "BRY"),
        ("root-vegetables", "Root Vegetables", "Carrots, onions, potatoes, sweet potatoes and garlic.", "ROT"),
    ],
    "pantry": [
        ("rice-grains", "Rice & Grains", "Rice and rolled oats in bags.", "RIC"),
        ("pasta", "Pasta", "Dried pasta in boxes and nests.", "PST"),
        ("flour-baking", "Flour & Baking", "Flour, sugar and raising agents for home baking.", "FLR"),
        ("cooking-oils", "Cooking Oils", "Oils for cooking and dressing.", "OIL"),
        ("spices-seasonings", "Spices & Seasonings", "Salt, pepper and ground spices.", "SPC"),
        ("sauces-condiments", "Sauces & Condiments", "Pasta sauce, soy sauce and mustard.", "SAU"),
        ("canned-goods", "Canned Goods", "Tinned tomatoes, pulses and fish.", "CAN"),
        ("cereals-breakfast", "Cereals & Breakfast", "Granola, corn flakes and honey.", "CER"),
        ("legumes-beans", "Legumes & Beans", "Dried lentils, chickpeas and beans.", "LEG"),
    ],
    "chilled-dairy": [
        ("milk", "Milk", "Milk in bottles and cartons.", "MLK"),
        ("cheese", "Cheese", "Cheese cut to order by weight, plus pre-packed cheese.", "CHE"),
        ("yogurt", "Yogurt", "Plain and flavoured yogurt in tubs and multipacks.", "YOG"),
        ("butter-spreads", "Butter & Spreads", "Butter and nut spreads.", "BUT"),
        ("eggs", "Eggs", "Eggs by the dozen or half dozen.", "EGG"),
        ("chilled-drinks", "Chilled Drinks", "Juice and ready-to-drink coffee kept in the fridge.", "CDR"),
    ],
    "bakery": [
        ("bread", "Bread", "Loaves and baguettes.", "BRD"),
        ("rolls-buns", "Rolls & Buns", "Burger buns and rolls in packs.", "ROL"),
        ("pastries", "Pastries", "Croissants and sweet pastries.", "PAS"),
        ("cakes", "Cakes", "Loaf cakes and cakes made to order.", "CAK"),
    ],
    "meat-fish-frozen": [
        ("meat-poultry", "Meat & Poultry", "Chicken and beef, priced by weight.", "MEA"),
        ("seafood", "Seafood", "Fish fillets by weight and packs of shrimp.", "SEA"),
        ("frozen-vegetables", "Frozen Vegetables", "Frozen peas, broccoli and sweetcorn.", "FVG"),
        ("frozen-fruit", "Frozen Fruit", "Frozen berries, mango and strawberries.", "FFR"),
        ("frozen-meals", "Frozen Meals", "Pizza, lasagne and fish sticks.", "FML"),
    ],
    "drinks-snacks": [
        ("water", "Water", "Still and sparkling water.", "WAT"),
        ("juices", "Juices", "Long-life juices and juice drinks.", "JUI"),
        ("coffee-tea", "Coffee & Tea", "Ground coffee and tea bags.", "COF"),
        ("nuts-seeds", "Nuts & Seeds", "Almonds, cashews and seeds in packs.", "NUT"),
        ("dried-fruit", "Dried Fruit", "Raisins, apricots and dates.", "DRF"),
        ("snacks", "Snacks", "Chips, tortilla chips and chocolate.", "SNK"),
    ],
    "specialty-home": [
        ("plant-based", "Plant-Based", "Oat drink, tofu and hummus.", "PLB"),
        (
            "gluten-free",
            "Gluten-Free",
            "Products whose ingredient lists contain no gluten-containing cereals. Dietary claims are shown only "
            "when verified.",
            "GLF",
        ),
        ("baby", "Baby", "Fruit pouches, wipes and diapers.", "BBY"),
        ("household", "Household", "Cleaning and kitchen basics.", "HOU"),
        ("personal-care", "Personal Care", "Soap, shampoo and toothpaste.", "PCR"),
    ],
}

# --------------------------------------------------------------------------- brands (all fictional)
# name, slug, mark (short wordmark used on packs), colour, description
BRANDS = [
    ("Orchard Row", "orchard-row", "Orchard Row", "#1F3D2B", "Orchard Row own-label range. Demonstration brand."),
    ("Millbrook Dairy", "millbrook-dairy", "Millbrook", "#3E6FB0", "Milk, yogurt, butter, cheese and eggs. Fictional demo brand."),
    ("Hollow Oak Bakehouse", "hollow-oak-bakehouse", "Hollow Oak", "#8A5A2E", "Bread, rolls, pastries and cakes. Fictional demo brand."),
    ("Brightfield Pantry", "brightfield-pantry", "Brightfield", "#C98A1E", "Cupboard staples: grains, pasta, oils and tins. Fictional demo brand."),
    ("Larkspur Spice House", "larkspur-spice-house", "Larkspur", "#6B4A8F", "Salt, pepper and ground spices. Fictional demo brand."),
    ("Saltmarsh Fisheries", "saltmarsh-fisheries", "Saltmarsh", "#2A7F8F", "Fish and shellfish. Fictional demo brand."),
    ("Marrowfield Meats", "marrowfield-meats", "Marrowfield", "#9C2F2F", "Chicken and beef. Fictional demo brand."),
    ("Fernhill Greens", "fernhill-greens", "Fernhill", "#3F7D4E", "Pre-packed leaves, herbs and berries. Fictional demo brand."),
    ("Kettlewick Tea & Coffee", "kettlewick-tea-coffee", "Kettlewick", "#2F3A33", "Coffee and tea. Fictional demo brand."),
    ("Brindle Springs", "brindle-springs", "Brindle Springs", "#2E7BBF", "Water and juices. Fictional demo brand."),
    ("Cobble Lane Snacks", "cobble-lane-snacks", "Cobble Lane", "#D9622B", "Snacks, nuts and dried fruit. Fictional demo brand."),
    ("Frostmere Kitchen", "frostmere-kitchen", "Frostmere", "#3E8DB5", "Frozen vegetables, fruit and meals. Fictional demo brand."),
    ("Tinywren", "tinywren", "Tinywren", "#C9992F", "Baby food and care items. Fictional demo brand."),
    ("Wrenfield Home", "wrenfield-home", "Wrenfield", "#5E8F6E", "Household basics. Fictional demo brand."),
    ("Birchwater Care", "birchwater-care", "Birchwater", "#7C62A8", "Personal-care basics. Fictional demo brand."),
    ("Sunhollow Plant Kitchen", "sunhollow-plant-kitchen", "Sunhollow", "#7A8A3A", "Plant-based foods. Fictional demo brand."),
]
BRAND_BY_NAME = {b[0]: {"slug": b[1], "mark": b[2], "color": b[3], "description": b[4]} for b in BRANDS}

# --------------------------------------------------------------------------- category defaults
# unit, product_type, storage_type, perishable, tracks_batches, sell_buffer_days, expiry kind, shelf life (days),
# storage instructions, packaging text
CAT = {
    "vegetables": ("kg", "LOOSE_PRODUCE", "AMBIENT", True, True, 1, "BEST_BEFORE", 7, "Store at room temperature, or in the fridge for longer life.", "Loose or in a paper bag"),
    "fruit": ("kg", "LOOSE_PRODUCE", "AMBIENT", True, True, 1, "BEST_BEFORE", 7, "Store at room temperature; refrigerate once ripe.", "Loose or in a paper bag"),
    "leafy-greens": ("pack", "LOOSE_PRODUCE", "CHILLED", True, True, 1, "USE_BY", 6, "Keep refrigerated. Wash before eating.", "Loose or in a pack"),
    "herbs": ("bundle", "LOOSE_PRODUCE", "CHILLED", True, True, 1, "USE_BY", 6, "Keep refrigerated, stems in a little water or wrapped in damp paper.", "Tied bunch"),
    "citrus": ("kg", "LOOSE_PRODUCE", "AMBIENT", True, True, 1, "BEST_BEFORE", 12, "Store at room temperature or in the fridge.", "Loose"),
    "berries": ("pack", "LOOSE_PRODUCE", "CHILLED", True, True, 1, "USE_BY", 5, "Keep refrigerated. Wash just before eating.", "Cardboard punnet"),
    "root-vegetables": ("kg", "LOOSE_PRODUCE", "AMBIENT", True, True, 1, "BEST_BEFORE", 14, "Store in a cool, dry, dark place.", "Loose or in a paper bag"),
    "rice-grains": ("pack", "PACKAGED", "AMBIENT", False, False, 1, "BEST_BEFORE", 365, "Store in a cool, dry place. Close the bag after opening.", "Paper or plastic bag"),
    "pasta": ("pack", "PACKAGED", "AMBIENT", False, False, 1, "BEST_BEFORE", 540, "Store in a cool, dry place.", "Cardboard box or bag"),
    "flour-baking": ("pack", "PACKAGED", "AMBIENT", False, False, 1, "BEST_BEFORE", 365, "Store in a cool, dry place.", "Paper bag or box"),
    "cooking-oils": ("each", "PACKAGED", "AMBIENT", False, False, 1, "BEST_BEFORE", 540, "Store in a cool, dark place. Close the cap after use.", "Glass or plastic bottle"),
    "spices-seasonings": ("each", "PACKAGED", "AMBIENT", False, False, 1, "BEST_BEFORE", 540, "Store in a cool, dry place away from light.", "Jar or tin"),
    "sauces-condiments": ("each", "PACKAGED", "AMBIENT", False, False, 1, "BEST_BEFORE", 540, "Store in a cool, dry place. Refrigerate after opening.", "Glass jar or bottle"),
    "canned-goods": ("each", "PACKAGED", "AMBIENT", False, False, 1, "BEST_BEFORE", 720, "Store in a cool, dry place. Once opened, transfer to a container and refrigerate.", "Steel tin"),
    "cereals-breakfast": ("pack", "PACKAGED", "AMBIENT", False, False, 1, "BEST_BEFORE", 365, "Store in a cool, dry place. Close the pack after opening.", "Cardboard box or jar"),
    "legumes-beans": ("pack", "PACKAGED", "AMBIENT", False, False, 1, "BEST_BEFORE", 540, "Store in a cool, dry place.", "Plastic bag"),
    "milk": ("each", "CHILLED", "CHILLED", True, True, 2, "USE_BY", 12, "Keep refrigerated. Use within 3 days of opening.", "Plastic bottle or carton"),
    "cheese": ("100g", "CHILLED", "CHILLED", True, True, 3, "USE_BY", 40, "Keep refrigerated. Wrap tightly after opening.", "Cut and wrapped to order"),
    "yogurt": ("each", "CHILLED", "CHILLED", True, True, 3, "USE_BY", 18, "Keep refrigerated. Use within 3 days of opening.", "Plastic tub"),
    "butter-spreads": ("each", "CHILLED", "CHILLED", True, True, 5, "BEST_BEFORE", 60, "Keep refrigerated.", "Paper wrapper"),
    "eggs": ("dozen", "CHILLED", "CHILLED", True, True, 5, "BEST_BEFORE", 21, "Keep refrigerated.", "Fibre carton"),
    "chilled-drinks": ("each", "CHILLED", "CHILLED", True, True, 2, "USE_BY", 14, "Keep refrigerated. Use within 3 days of opening.", "Plastic bottle"),
    "bread": ("each", "BAKERY", "AMBIENT", True, True, 1, "BEST_BEFORE", 3, "Store in a cool, dry place. Freeze to keep longer.", "Paper bag"),
    "rolls-buns": ("pack", "BAKERY", "AMBIENT", True, True, 1, "BEST_BEFORE", 4, "Store in a cool, dry place. Freeze to keep longer.", "Paper or plastic bag"),
    "pastries": ("each", "BAKERY", "AMBIENT", True, True, 0, "BEST_BEFORE", 2, "Best eaten on the day. Store in a cool, dry place.", "Paper bag"),
    "cakes": ("each", "BAKERY", "AMBIENT", True, True, 1, "BEST_BEFORE", 4, "Store in a cool place. Refrigerate cream-filled cakes.", "Box"),
    "meat-poultry": ("kg", "CHILLED", "CHILLED", True, True, 1, "USE_BY", 5, "Keep refrigerated at or below 4 C. Cook thoroughly.", "Tray with film"),
    "seafood": ("kg", "CHILLED", "CHILLED", True, True, 1, "USE_BY", 4, "Keep refrigerated at or below 4 C. Cook thoroughly.", "Tray with film"),
    "frozen-vegetables": ("each", "FROZEN", "FROZEN", False, False, 1, "BEST_BEFORE", 365, "Keep frozen at -18 C or below. Do not refreeze once thawed.", "Plastic bag"),
    "frozen-fruit": ("each", "FROZEN", "FROZEN", False, False, 1, "BEST_BEFORE", 365, "Keep frozen at -18 C or below. Do not refreeze once thawed.", "Plastic bag"),
    "frozen-meals": ("each", "FROZEN", "FROZEN", False, False, 1, "BEST_BEFORE", 270, "Keep frozen at -18 C or below. Cook from frozen following pack instructions.", "Cardboard box"),
    "water": ("each", "PACKAGED", "AMBIENT", False, False, 1, "BEST_BEFORE", 540, "Store in a cool place away from direct sunlight.", "Plastic bottle or can"),
    "juices": ("each", "PACKAGED", "AMBIENT", False, False, 1, "BEST_BEFORE", 270, "Store in a cool, dry place. Refrigerate after opening.", "Plastic bottle"),
    "coffee-tea": ("pack", "PACKAGED", "AMBIENT", False, False, 1, "BEST_BEFORE", 365, "Store in a cool, dry place. Reseal after opening.", "Bag or box"),
    "nuts-seeds": ("pack", "PACKAGED", "AMBIENT", False, False, 1, "BEST_BEFORE", 270, "Store in a cool, dry place. Reseal after opening.", "Resealable pouch"),
    "dried-fruit": ("pack", "PACKAGED", "AMBIENT", False, False, 1, "BEST_BEFORE", 270, "Store in a cool, dry place. Reseal after opening.", "Resealable pouch"),
    "snacks": ("pack", "PACKAGED", "AMBIENT", False, False, 1, "BEST_BEFORE", 180, "Store in a cool, dry place. Reseal after opening.", "Bag or carton"),
    "plant-based": ("each", "PACKAGED", "CHILLED", True, True, 2, "USE_BY", 21, "Keep refrigerated. Use within 3 days of opening.", "Carton or tub"),
    "gluten-free": ("pack", "PACKAGED", "AMBIENT", False, False, 1, "BEST_BEFORE", 365, "Store in a cool, dry place.", "Box or bag"),
    "baby": ("each", "PACKAGED", "AMBIENT", False, False, 1, "BEST_BEFORE", 365, "Store in a cool, dry place.", "Pouch or pack"),
    "household": ("each", "HOUSEHOLD", "AMBIENT", False, False, 1, "BEST_BEFORE", 730, "Store out of reach of children.", "Bottle or pack"),
    "personal-care": ("each", "HOUSEHOLD", "AMBIENT", False, False, 1, "BEST_BEFORE", 730, "Store in a cool, dry place.", "Bottle, tube or wrapper"),
}

UNIT_QTY = {  # default (min, step, max) per sale unit
    "kg": ("0.5", "0.25", "10"),
    "100g": ("1", "1", "20"),
    "each": ("1", "1", "12"),
    "pack": ("1", "1", "12"),
    "box": ("1", "1", "12"),
    "bundle": ("1", "1", "10"),
    "dozen": ("1", "1", "6"),
}


def _d(value) -> Decimal:
    return Decimal(str(value))


def P(cat: str, name: str, price, *, short: str, desc: str, art: tuple, alt: str, **kw) -> dict:
    """Build one product record. Anything not given falls back to the category defaults in `CAT`."""
    unit, ptype, stor, perish, batches, buffer, expiry, shelf, storage, pack = CAT[cat]
    rec = {
        "cat": cat,
        "name": name,
        "price": _d(price),
        "unit": kw.pop("unit", unit),
        "brand": kw.pop("brand", None),
        "nc": kw.pop("nc", None),  # (amount, unit code)
        "qty": kw.pop("qty", None),
        "short": short,
        "desc": desc,
        "art": art,
        "alt": alt,
        "ptype": kw.pop("ptype", ptype),
        "stor": kw.pop("stor", stor),
        "perish": kw.pop("perish", perish),
        "batches": kw.pop("batches", batches),
        "buffer": kw.pop("buffer", buffer),
        "expiry": kw.pop("expiry", expiry),
        "shelf": kw.pop("shelf", shelf),
        "storage": kw.pop("storage", storage),
        "pack": kw.pop("pack", pack),
        "vw": kw.pop("vw", None),
        "ingr": kw.pop("ingr", None),
        "alg": kw.pop("alg", None),  # None = allergen info not confirmed
        "may": kw.pop("may", ()),
        "diet": kw.pop("diet", None),  # plain | veg | pending-vegan
        "claims": kw.pop("claims", ()),  # certificate-type claims, always seeded UNVERIFIED
        "origin": kw.pop("origin", None),  # (country, note)
        "ean": kw.pop("ean", False),
        "feat": kw.pop("feat", False),
        "new": kw.pop("new", None),
        "state": kw.pop("state", None),  # inactive | archived | unavailable
        "mto": kw.pop("mto", False),
        "cost": kw.pop("cost", None),
    }
    if kw:
        raise TypeError(f"unknown product fields for {name!r}: {sorted(kw)}")
    return rec
