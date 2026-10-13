"""Which products appear in each banner illustration (cut-outs are composed by scripts/generate_demo_images.py)."""

from __future__ import annotations

# key -> (product names, gradient top, gradient bottom, mirror horizontally?)
BANNER_ART = {
    "hero-seasonal-produce": (
        ["Gala Apples", "Bartlett Pears", "Sweet Potatoes", "Carrots", "Navel Oranges", "Garlic"],
        "#EFE6CC",
        "#D8CFA6",
        False,
    ),
    "hero-weeknight-dinners": (
        ["Vine Tomatoes", "Spaghetti", "Basil", "Olive Oil", "Cheddar", "Yellow Onions"],
        "#F2E4CC",
        "#E3C8A0",
        False,
    ),
    "hero-bakery": (
        [
            "Sourdough Loaf",
            "Butter Croissant",
            "Baguette",
            "Seeded Burger Buns 4-Pack",
            "Lemon Drizzle Loaf",
            "Brioche Rolls 6-Pack",
        ],
        "#F5E3CA",
        "#E6C497",
        False,
    ),
    "promo-berries": (
        ["Strawberries", "Blueberries", "Raspberries", "Greek-Style Yogurt"],
        "#F3DDE0",
        "#E5B9C0",
        False,
    ),
    "promo-pasta": (
        ["Spaghetti", "Penne Rigate", "Tomato Pasta Sauce", "Basil"],
        "#F2E2C2",
        "#E5C98F",
        False,
    ),
}

# article slug -> three products shown on its card illustration
ARTICLE_ART = {
    "roasted-tomato-basil-pasta": ["Vine Tomatoes", "Basil", "Spaghetti"],
    "lemon-garlic-roast-chicken": ["Whole Chicken", "Lemons", "Russet Potatoes"],
    "vegetable-fried-rice": ["Long-Grain White Rice", "Large White Eggs", "Carrots"],
    "overnight-oats-blueberries": ["Rolled Oats", "Blueberries", "Plain Whole-Milk Yogurt"],
    "red-lentil-dal": ["Red Lentils", "Basmati Rice", "Cilantro"],
    "baked-salmon-kale-potatoes": ["Salmon Fillets", "Curly Kale", "Sweet Potatoes"],
    "choosing-ripe-avocados": ["Avocados", "Lemons", "Romaine Lettuce"],
    "storing-fresh-herbs": ["Basil", "Flat-Leaf Parsley", "Cilantro"],
    "reading-unit-prices": ["Olive Oil", "Spaghetti", "Sunflower Oil"],
    "how-weighed-items-are-priced": ["Gala Apples", "Bananas", "Chicken Breast Fillets"],
}
