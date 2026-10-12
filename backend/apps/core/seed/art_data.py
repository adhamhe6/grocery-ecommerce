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
    "promo-plant-based": (
        ["Oat Drink", "Chickpea Hummus", "Firm Tofu", "Chickpeas in Water"],
        "#E7EBD2",
        "#CCD6A5",
        False,
    ),
}
