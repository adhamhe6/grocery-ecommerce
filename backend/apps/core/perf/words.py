"""Word lists and per-category traits used to build realistic-looking synthetic products.

Plain data, no Django imports. Names are assembled from shared adjectives plus category nouns/variants, so many
products share tokens ("Fresh", "Sweet", "Cheddar"…) the way a real catalogue does: full-text and trigram search
therefore return multi-row, ranked result sets instead of one exact hit. Nothing here is a real brand.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CategorySpec:
    nouns: tuple[str, ...]
    variants: tuple[str, ...]
    ptype: str  # ProductType value
    storage: str  # StorageType value
    perishable: bool
    weight_capable: bool  # can be sold loose by the kilogram (variable weight)
    count_price: float  # median price of one counted unit (pack / each)
    kg_price: float  # median price per kg when sold by weight (0 when not weight-capable)
    packs: tuple[tuple[int, str], ...] = ()  # net contents (amount, unit code); () = none recorded
    units: tuple[str, ...] = ("each",)
    share: float = 1.0  # relative share of the catalogue


ADJECTIVES = (
    "Fresh", "Crisp", "Sweet", "Classic", "Golden", "Rustic", "Everyday", "Premium", "Family", "Mini", "Jumbo",
    "Select", "Harvest", "Garden", "Valley", "Hearty", "Light", "Zesty", "Smoky", "Mild", "Mature", "Extra", "Simple",
    "Tender", "Juicy", "Creamy", "Savoury", "Bold", "Gentle", "Country", "Coastal", "Meadow", "Heritage", "Daily",
    "Signature", "Traditional", "Quick", "Giant", "Petite", "Sunny",
)  # fmt: skip

ORIGINS = (
    "Spain", "Italy", "France", "Chile", "Peru", "Morocco", "Kenya", "Netherlands", "Poland", "Portugal", "Greece",
    "Egypt", "South Africa", "Ireland", "United Kingdom", "Mexico", "Costa Rica", "Turkey", "Brazil", "Argentina",
)  # fmt: skip

BRAND_WORDS_A = (
    "Alder", "Ashgrove", "Bramble", "Briar", "Cedar", "Clover", "Copper", "Dale", "Elm", "Fern", "Fieldstone",
    "Foxglove", "Garnet", "Hazel", "Heron", "Ivy", "Juniper", "Kestrel", "Larch", "Linden", "Maple", "Marigold",
    "Millstone", "Nettle", "Oakley", "Orchard", "Pebble", "Quill", "Rowan", "Sage", "Thistle", "Tidewater",
    "Willow", "Wren", "Yarrow",
)  # fmt: skip
BRAND_WORDS_B = (
    "Foods", "Farms", "Kitchen", "Larder", "Mills", "Dairy", "Bakery", "Provisions", "Growers", "Table", "Harvest",
    "Pantry", "Co", "Select", "Brothers", "Works",
)  # fmt: skip

STORAGE_TEXT = {
    "AMBIENT": "Store in a cool, dry place.",
    "CHILLED": "Keep refrigerated at 0-5C. Once opened, use within 3 days.",
    "FROZEN": "Keep frozen at -18C or below. Do not refreeze once defrosted.",
}

DESCRIPTION_OPENERS = (
    "A dependable everyday choice for the weekly shop.",
    "Packed and checked at our distribution centre for consistent quality.",
    "Popular with families and easy to work into a quick midweek meal.",
    "A good all-rounder to keep in the cupboard or fridge.",
    "Sourced from approved suppliers and labelled with the details we have on record.",
    "Simple to prepare and good value for the size of the pack.",
)
DESCRIPTION_MIDDLES = (
    "Works well on its own or as part of a larger recipe.",
    "Pairs nicely with seasonal vegetables, rice or fresh bread.",
    "Suits batch cooking, packed lunches and weekend entertaining.",
    "A handy size for one or two people, with enough left over for tomorrow.",
    "Look for the use-by or best-before date on the pack.",
    "Check the label for allergen information before serving.",
)
INGREDIENT_WORDS = (
    "water", "sugar", "salt", "wheat flour", "vegetable oil", "tomato", "onion", "garlic", "yeast", "milk powder",
    "spices", "herbs", "lemon juice", "rice", "oats", "sunflower oil", "cocoa", "pepper", "paprika", "vinegar",
)  # fmt: skip
PACKAGING_TEXT = ("Recyclable card sleeve", "Plastic tray with film lid", "Paper bag", "Glass jar", "Tin can", "Pouch")

FIRST_NAMES = (
    "Alex", "Sam", "Jordan", "Priya", "Mei", "Tomas", "Amara", "Lucas", "Noor", "Eli", "Ines", "Kofi", "Hana", "Omar",
    "Lena", "Mateo", "Zoe", "Ravi", "Chloe", "Yusuf", "Freya", "Diego", "Anika", "Theo", "Sana", "Ivan", "Rosa",
    "Jonas", "Maya", "Felix",
)  # fmt: skip
LAST_NAMES = (
    "Rivera", "Okafor", "Nair", "Lee", "Tanaka", "Novak", "Diallo", "Ferreira", "Haddad", "Larsen", "Moreau", "Patel",
    "Quinn", "Rossi", "Silva", "Takahashi", "Underwood", "Varga", "Walsh", "Xu", "Yilmaz", "Zielinski", "Brandt",
    "Costa", "Dubois", "Evans", "Fischer", "Garcia", "Hughes", "Ito",
)  # fmt: skip
STREETS = (
    "Elm", "Linden", "Quay", "Fieldgate", "Hillcrest", "Market", "Harbour", "Westbrook", "Eastfield", "Station",
    "Mill", "Orchard", "Church", "Victoria", "Park", "Bridge", "Meadow", "Cedar",
)  # fmt: skip
CANCEL_REASONS = (
    "Cancelled by customer",
    "Customer changed their mind",
    "Duplicate order",
    "Unable to reach customer",
    "Items unavailable",
)

# Shared qualifiers for the few categories that are not in the demo catalogue (user-added categories).
GENERIC = CategorySpec(
    nouns=("Selection", "Mix", "Assortment", "Blend", "Pack", "Range", "Essentials", "Favourites"),
    variants=("Original", "Classic", "Plain", "Mixed", "Seasonal", "Value", "Large", "Small"),
    ptype="PACKAGED",
    storage="AMBIENT",
    perishable=False,
    weight_capable=False,
    count_price=3.5,
    kg_price=0.0,
    packs=((250, "g"), (500, "g"), (1, "l")),
    units=("each", "pack"),
)

_V = ("Red", "Green", "Yellow", "White", "Baby", "Mixed", "Large", "Small", "Sweet", "Seasonal", "Trimmed", "Whole")
_NUTS = ("Roasted", "Salted", "Unsalted", "Smoked", "Honey", "Chilli", "Natural", "Dry-roasted", "Mixed", "Raw")
_FLAVOURS = ("Vanilla", "Strawberry", "Peach", "Plain", "Honey", "Lemon", "Blueberry", "Mango", "Coconut", "Cherry")

SPECS: dict[str, CategorySpec] = {
    "vegetables": CategorySpec(
        ("Carrots", "Broccoli", "Cauliflower", "Courgettes", "Peppers", "Cucumber", "Tomatoes", "Mushrooms", "Sweetcorn",
         "Aubergine", "Celery", "Cabbage", "Leeks", "Asparagus"), _V,
        "LOOSE_PRODUCE", "CHILLED", True, True, 1.9, 3.4, ((500, "g"), (250, "g"), (400, "g")), ("pack", "each"), 2.4,
    ),  # fmt: skip
    "fruit": CategorySpec(
        ("Apples", "Bananas", "Pears", "Grapes", "Pineapple", "Melon", "Plums", "Peaches", "Kiwi", "Cherries", "Figs",
         "Pomegranate", "Mango", "Papaya"), ("Red", "Green", "Ripe", "Ready-to-eat", "Large", "Small", "Sweet", "Seedless", "Tropical"),
        "LOOSE_PRODUCE", "CHILLED", True, True, 2.2, 3.9, ((500, "g"), (1000, "g")), ("pack", "each"), 2.4,
    ),  # fmt: skip
    "leafy-greens": CategorySpec(
        ("Spinach", "Rocket", "Lettuce", "Kale", "Watercress", "Chard", "Cos Hearts", "Salad Mix", "Pak Choi", "Lamb's Lettuce"),
        ("Baby", "Washed", "Crunchy", "Mixed", "Red", "Green", "Large", "Mild", "Peppery", "Family"),
        "LOOSE_PRODUCE", "CHILLED", True, True, 1.6, 8.0, ((100, "g"), (200, "g"), (250, "g")), ("pack", "each"), 1.0,
    ),  # fmt: skip
    "herbs": CategorySpec(
        ("Basil", "Parsley", "Coriander", "Mint", "Thyme", "Rosemary", "Chives", "Dill", "Sage", "Oregano"),
        ("Fresh", "Potted", "Bunch", "Soft", "Italian", "Curly", "Flat-leaf", "Garden"),
        "LOOSE_PRODUCE", "CHILLED", True, False, 1.2, 0.0, ((30, "g"), (50, "g")), ("bundle", "each"), 0.6,
    ),  # fmt: skip
    "citrus": CategorySpec(
        ("Oranges", "Lemons", "Limes", "Mandarins", "Clementines", "Grapefruit", "Satsumas", "Blood Oranges"),
        ("Unwaxed", "Juicing", "Easy-peel", "Seedless", "Large", "Small", "Sweet", "Tangy"),
        "LOOSE_PRODUCE", "CHILLED", True, True, 2.0, 3.2, ((500, "g"), (1000, "g")), ("pack", "each"), 0.9,
    ),  # fmt: skip
    "berries": CategorySpec(
        ("Strawberries", "Blueberries", "Raspberries", "Blackberries", "Cranberries", "Redcurrants", "Gooseberries"),
        ("Sweet", "Ripe", "Large", "Mixed", "Summer", "Plump", "Hand-picked"),
        "PACKAGED", "CHILLED", True, False, 3.2, 0.0, ((125, "g"), (150, "g"), (250, "g"), (400, "g")), ("pack",), 0.9,
    ),  # fmt: skip
    "root-vegetables": CategorySpec(
        ("Potatoes", "Onions", "Sweet Potatoes", "Garlic", "Beetroot", "Parsnips", "Swede", "Turnips", "Ginger", "Shallots"),
        ("Red", "White", "Maincrop", "Baby", "New", "Large", "Waxy", "Floury", "Brown", "Washed"),
        "LOOSE_PRODUCE", "AMBIENT", False, True, 2.3, 1.9, ((1000, "g"), (2000, "g"), (500, "g")), ("pack", "each"), 1.5,
    ),  # fmt: skip
    "rice-grains": CategorySpec(
        ("Basmati Rice", "Jasmine Rice", "Long Grain Rice", "Porridge Oats", "Couscous", "Quinoa", "Pearl Barley", "Bulgur Wheat", "Risotto Rice", "Polenta"),
        ("Wholegrain", "Easy-cook", "Fragrant", "Rolled", "Quick", "Mixed", "Tri-colour", "Giant"),
        "PACKAGED", "AMBIENT", False, False, 2.9, 0.0, ((500, "g"), (1000, "g"), (2000, "g")), ("each", "pack"), 1.4,
    ),  # fmt: skip
    "pasta": CategorySpec(
        ("Spaghetti", "Penne", "Fusilli", "Tagliatelle", "Lasagne Sheets", "Macaroni", "Farfalle", "Rigatoni", "Linguine", "Orzo"),
        ("Durum", "Wholewheat", "Egg", "Bronze-cut", "Quick-cook", "Tri-colour", "Gluten-free", "Fresh-style"),
        "PACKAGED", "AMBIENT", False, False, 1.7, 0.0, ((500, "g"), (1000, "g"), (250, "g")), ("each", "pack"), 1.3,
    ),  # fmt: skip
    "flour-baking": CategorySpec(
        ("Plain Flour", "Self-raising Flour", "Caster Sugar", "Baking Powder", "Icing Sugar", "Cocoa Powder", "Brown Sugar", "Bicarbonate of Soda", "Yeast", "Vanilla Extract"),
        ("Strong", "Wholemeal", "Fine", "Golden", "Unrefined", "Quick-acting", "Dark", "Pure"),
        "PACKAGED", "AMBIENT", False, False, 2.1, 0.0, ((500, "g"), (1000, "g"), (1500, "g"), (100, "g")), ("each", "pack"), 1.0,
    ),  # fmt: skip
    "cooking-oils": CategorySpec(
        ("Olive Oil", "Sunflower Oil", "Rapeseed Oil", "Coconut Oil", "Sesame Oil", "Vegetable Oil", "Avocado Oil", "Cooking Spray"),
        ("Extra Virgin", "Light", "Cold-pressed", "Roasting", "Toasted", "Pure", "Blended", "Everyday"),
        "PACKAGED", "AMBIENT", False, False, 5.6, 0.0, ((500, "ml"), (1, "l"), (250, "ml"), (750, "ml")), ("each",), 0.8,
    ),  # fmt: skip
    "spices-seasonings": CategorySpec(
        ("Black Pepper", "Sea Salt", "Paprika", "Ground Cumin", "Turmeric", "Cinnamon", "Chilli Flakes", "Mixed Herbs", "Garlic Granules", "Curry Powder", "Nutmeg"),
        ("Ground", "Smoked", "Whole", "Mild", "Hot", "Fine", "Coarse", "Cracked"),
        "PACKAGED", "AMBIENT", False, False, 1.9, 0.0, ((40, "g"), (60, "g"), (100, "g"), (250, "g")), ("each",), 1.0,
    ),  # fmt: skip
    "sauces-condiments": CategorySpec(
        ("Tomato Pasta Sauce", "Soy Sauce", "Mustard", "Mayonnaise", "Ketchup", "Pesto", "Curry Sauce", "Hot Sauce", "Chutney", "Salad Dressing", "Stir-fry Sauce"),
        ("Original", "Spicy", "Smooth", "Chunky", "Reduced-salt", "Garlic", "Basil", "Smoky", "Sweet"),
        "PACKAGED", "AMBIENT", False, False, 2.7, 0.0, ((300, "g"), (500, "g"), (250, "ml"), (400, "g")), ("each",), 1.4,
    ),  # fmt: skip
    "canned-goods": CategorySpec(
        ("Chopped Tomatoes", "Chickpeas", "Kidney Beans", "Sweetcorn", "Tuna Chunks", "Baked Beans", "Coconut Milk", "Lentil Soup", "Sardines", "Peaches in Juice"),
        ("No-added-sugar", "In Spring Water", "In Olive Oil", "Reduced-salt", "Value", "Large", "Premium", "Mixed"),
        "PACKAGED", "AMBIENT", False, False, 1.2, 0.0, ((400, "g"), (240, "g"), (800, "g"), (120, "g")), ("each", "pack"), 1.5,
    ),  # fmt: skip
    "cereals-breakfast": CategorySpec(
        ("Granola", "Corn Flakes", "Muesli", "Honey", "Porridge Pot", "Wheat Biscuits", "Cereal Bars", "Peanut Butter", "Jam", "Marmalade"),
        ("Crunchy", "Oat", "Honey", "Berry", "Nutty", "Chocolate", "Original", "Fruit & Nut", "Low-sugar"),
        "PACKAGED", "AMBIENT", False, False, 3.4, 0.0, ((375, "g"), (500, "g"), (750, "g"), (340, "g")), ("each", "box"), 1.4,
    ),  # fmt: skip
    "legumes-beans": CategorySpec(
        ("Red Lentils", "Green Lentils", "Chickpeas", "Black Beans", "Butter Beans", "Split Peas", "Borlotti Beans", "Pinto Beans"),
        ("Dried", "Split", "Whole", "Washed", "Quick-soak", "Large"),
        "PACKAGED", "AMBIENT", False, False, 2.4, 0.0, ((500, "g"), (1000, "g")), ("each", "pack"), 0.7,
    ),  # fmt: skip
    "milk": CategorySpec(
        ("Whole Milk", "Semi-skimmed Milk", "Skimmed Milk", "Lactose-free Milk", "Cream", "Single Cream", "Double Cream", "Buttermilk", "Evaporated Milk"),
        ("Fresh", "Farm", "Long-life", "Barista", "Light", "Full-fat"),
        "CHILLED", "CHILLED", True, False, 1.9, 0.0, ((1, "l"), (2, "l"), (500, "ml"), (250, "ml")), ("each",), 1.0,
    ),  # fmt: skip
    "cheese": CategorySpec(
        ("Cheddar", "Mozzarella", "Brie", "Parmesan", "Feta", "Edam", "Gouda", "Halloumi", "Blue Cheese", "Cream Cheese", "Red Leicester"),
        ("Mature", "Mild", "Extra Mature", "Smoked", "Grated", "Sliced", "Vintage", "Reduced-fat", "Crumbly"),
        "CHILLED", "CHILLED", True, True, 3.2, 14.5, ((200, "g"), (400, "g"), (250, "g")), ("pack", "each"), 1.5,
    ),  # fmt: skip
    "yogurt": CategorySpec(
        ("Greek Yogurt", "Natural Yogurt", "Fruit Yogurt", "Kefir", "Skyr", "Yogurt Pots", "Rice Pudding", "Custard"),
        _FLAVOURS,
        "CHILLED", "CHILLED", True, False, 2.0, 0.0, ((500, "g"), (150, "g"), (1000, "g"), (4 * 125, "g")), ("each", "pack"), 1.3,
    ),  # fmt: skip
    "butter-spreads": CategorySpec(
        ("Butter", "Spreadable Butter", "Margarine", "Olive Spread", "Hazelnut Spread", "Almond Butter", "Ghee"),
        ("Salted", "Unsalted", "Slightly Salted", "Light", "Dairy-free", "Smooth", "Crunchy"),
        "CHILLED", "CHILLED", True, False, 2.8, 0.0, ((250, "g"), (500, "g"), (400, "g")), ("each",), 0.7,
    ),  # fmt: skip
    "eggs": CategorySpec(
        ("Eggs", "Large Eggs", "Medium Eggs", "Quail Eggs", "Egg Whites"),
        ("Free-range", "Barn", "Mixed Size", "Dozen", "Half-dozen", "Large"),
        "CHILLED", "AMBIENT", True, False, 3.1, 0.0, (), ("dozen", "each", "pack"), 0.5,
    ),  # fmt: skip
    "chilled-drinks": CategorySpec(
        ("Orange Juice", "Apple Juice", "Smoothie", "Iced Coffee", "Cold Brew", "Lemonade", "Oat Drink", "Kombucha"),
        ("Fresh", "Not-from-concentrate", "Tropical", "Berry", "Smooth", "Sparkling", "Zero-sugar"),
        "CHILLED", "CHILLED", True, False, 2.6, 0.0, ((1, "l"), (750, "ml"), (330, "ml"), (250, "ml")), ("each",), 0.9,
    ),  # fmt: skip
    "bread": CategorySpec(
        ("Sourdough Loaf", "White Loaf", "Wholemeal Loaf", "Baguette", "Ciabatta", "Seeded Loaf", "Rye Bread", "Focaccia", "Pitta Bread", "Naan"),
        ("Crusty", "Sliced", "Stone-baked", "Soft", "Malted", "Artisan", "Tin", "Half"),
        "BAKERY", "AMBIENT", True, False, 2.5, 0.0, ((400, "g"), (800, "g"), (600, "g")), ("each",), 1.2,
    ),  # fmt: skip
    "rolls-buns": CategorySpec(
        ("Burger Buns", "Bread Rolls", "Brioche Rolls", "Hot Dog Rolls", "Bagels", "Finger Rolls", "Wraps"),
        ("Soft", "Sesame", "Seeded", "Floured", "Mini", "Wholemeal", "Glazed"),
        "BAKERY", "AMBIENT", True, False, 1.9, 0.0, ((4 * 60, "g"), (6 * 60, "g")), ("pack",), 0.8,
    ),  # fmt: skip
    "pastries": CategorySpec(
        ("Croissant", "Pain au Chocolat", "Cinnamon Swirl", "Danish", "Eclair", "Apple Turnover", "Almond Croissant", "Muffin", "Doughnut"),
        ("Butter", "Chocolate", "Vanilla", "Apple", "Cinnamon", "Jam", "Custard", "Mini"),
        "BAKERY", "AMBIENT", True, False, 2.3, 0.0, (), ("each", "pack"), 0.9,
    ),  # fmt: skip
    "cakes": CategorySpec(
        ("Victoria Sponge", "Chocolate Cake", "Lemon Drizzle", "Carrot Cake", "Banana Loaf", "Fruit Cake", "Brownies", "Flapjack"),
        ("Slice", "Whole", "Family", "Mini", "Iced", "Gluten-free", "Vegan"),
        "BAKERY", "AMBIENT", True, False, 4.0, 0.0, (), ("each", "pack"), 0.7,
    ),  # fmt: skip
    "meat-poultry": CategorySpec(
        ("Chicken Breast", "Chicken Thighs", "Beef Mince", "Pork Chops", "Lamb Leg", "Sausages", "Bacon", "Turkey Steaks", "Beef Steak", "Duck Breast", "Gammon"),
        ("Skinless", "Free-range", "Lean", "Smoked", "Diced", "Boneless", "Thick-cut", "Family Pack", "Trimmed"),
        "CHILLED", "CHILLED", True, True, 5.2, 11.5, ((500, "g"), (750, "g"), (1000, "g")), ("pack",), 2.2,
    ),  # fmt: skip
    "seafood": CategorySpec(
        ("Salmon Fillets", "Cod Fillets", "Prawns", "Haddock", "Sea Bass", "Mackerel", "Smoked Salmon", "Mussels", "Trout", "Tuna Steaks"),
        ("Skin-on", "Skinless", "Smoked", "Wild", "Farmed", "Large", "Peeled", "Hand-cut"),
        "CHILLED", "CHILLED", True, True, 5.8, 16.0, ((240, "g"), (300, "g"), (150, "g")), ("pack",), 1.4,
    ),  # fmt: skip
    "frozen-vegetables": CategorySpec(
        ("Garden Peas", "Broccoli Florets", "Sweetcorn", "Mixed Vegetables", "Spinach", "Green Beans", "Stir-fry Mix", "Cauliflower Rice", "Roast Potatoes"),
        ("Petit", "Steam-in-bag", "Chopped", "Whole", "Baby", "Seasoned", "Family"),
        "FROZEN", "FROZEN", True, False, 2.0, 0.0, ((500, "g"), (1000, "g"), (750, "g")), ("pack",), 1.1,
    ),  # fmt: skip
    "frozen-fruit": CategorySpec(
        ("Mixed Berries", "Mango Chunks", "Strawberries", "Raspberries", "Blueberries", "Smoothie Mix", "Cherries"),
        ("Sweet", "Whole", "Sliced", "Summer", "Tropical", "Forest"),
        "FROZEN", "FROZEN", True, False, 3.6, 0.0, ((500, "g"), (350, "g"), (1000, "g")), ("pack",), 0.7,
    ),  # fmt: skip
    "frozen-meals": CategorySpec(
        ("Margherita Pizza", "Lasagne", "Fish Fingers", "Chicken Nuggets", "Vegetable Curry", "Cottage Pie", "Ice Cream", "Fries", "Burgers", "Dumplings"),
        ("Stone-baked", "Family", "Crispy", "Spicy", "Classic", "Vanilla", "Thin", "Deep-pan"),
        "FROZEN", "FROZEN", True, False, 4.4, 0.0, ((350, "g"), (400, "g"), (500, "g"), (1000, "g")), ("each", "pack"), 1.5,
    ),  # fmt: skip
    "water": CategorySpec(
        ("Still Water", "Sparkling Water", "Spring Water", "Mineral Water", "Flavoured Water", "Tonic Water", "Soda Water"),
        ("Natural", "Lemon", "Lime", "Elderflower", "Multipack", "Large", "Light"),
        "PACKAGED", "AMBIENT", False, False, 1.3, 0.0, ((500, "ml"), (1, "l"), (2, "l"), (330, "ml")), ("each", "pack"), 0.8,
    ),  # fmt: skip
    "juices": CategorySpec(
        ("Orange Juice", "Apple Juice", "Cranberry Juice", "Pineapple Juice", "Fruit Squash", "Cola", "Ginger Beer", "Energy Drink"),
        ("Long-life", "No-added-sugar", "From Concentrate", "Zero", "Diet", "Classic", "Tropical", "Original"),
        "PACKAGED", "AMBIENT", False, False, 1.9, 0.0, ((1, "l"), (1500, "ml"), (330, "ml"), (750, "ml")), ("each", "pack"), 1.2,
    ),  # fmt: skip
    "coffee-tea": CategorySpec(
        ("Ground Coffee", "Instant Coffee", "Coffee Beans", "Coffee Pods", "Breakfast Tea", "Green Tea", "Herbal Tea", "Earl Grey", "Hot Chocolate"),
        ("Medium-roast", "Dark-roast", "Decaf", "Strong", "Smooth", "Loose-leaf", "Bags"),
        "PACKAGED", "AMBIENT", False, False, 4.6, 0.0, ((227, "g"), (250, "g"), (500, "g"), (80, "g")), ("each", "box"), 1.2,
    ),  # fmt: skip
    "nuts-seeds": CategorySpec(
        ("Almonds", "Cashews", "Walnuts", "Peanuts", "Pistachios", "Sunflower Seeds", "Pumpkin Seeds", "Mixed Nuts", "Hazelnuts", "Chia Seeds"),
        _NUTS,
        "PACKAGED", "AMBIENT", False, True, 3.6, 12.0, ((150, "g"), (200, "g"), (500, "g")), ("pack", "each"), 1.0,
    ),  # fmt: skip
    "dried-fruit": CategorySpec(
        ("Raisins", "Apricots", "Dates", "Prunes", "Mango Slices", "Cranberries", "Sultanas", "Figs"),
        ("Soft", "Sweetened", "Unsweetened", "Stoned", "Jumbo", "Chopped", "Mixed"),
        "PACKAGED", "AMBIENT", False, False, 2.6, 0.0, ((250, "g"), (500, "g"), (200, "g")), ("pack", "each"), 0.7,
    ),  # fmt: skip
    "snacks": CategorySpec(
        ("Potato Crisps", "Tortilla Chips", "Dark Chocolate", "Milk Chocolate", "Popcorn", "Pretzels", "Oat Biscuits", "Rice Cakes", "Cheese Crackers", "Fruit Bars"),
        ("Sea Salt", "Cheese & Onion", "Chilli", "Lightly Salted", "Sharing", "Mini", "Caramel", "Salted"),
        "PACKAGED", "AMBIENT", False, False, 2.2, 0.0, ((150, "g"), (200, "g"), (100, "g"), (400, "g")), ("each", "pack", "box"), 2.0,
    ),  # fmt: skip
    "plant-based": CategorySpec(
        ("Oat Drink", "Firm Tofu", "Hummus", "Soya Mince", "Almond Drink", "Vegan Sausages", "Falafel", "Coconut Yogurt"),
        ("Original", "Barista", "Smoked", "Garlic", "Roasted Pepper", "Unsweetened", "Chilled"),
        "CHILLED", "CHILLED", True, False, 2.9, 0.0, ((200, "g"), (1, "l"), (400, "g"), (500, "g")), ("each",), 0.8,
    ),  # fmt: skip
    "gluten-free": CategorySpec(
        ("Bread", "Pasta", "Flour Blend", "Crackers", "Cereal", "Cookies", "Pizza Base", "Wraps"),
        ("Seeded", "White", "Brown", "Plain", "Soft", "Crunchy", "Fusilli"),
        "PACKAGED", "AMBIENT", False, False, 3.9, 0.0, ((400, "g"), (500, "g"), (250, "g")), ("each", "pack"), 0.8,
    ),  # fmt: skip
    "baby": CategorySpec(
        ("Fruit Pouches", "Baby Wipes", "Nappies", "Baby Cereal", "Baby Snacks", "Formula Milk", "Rice Cakes", "Cotton Pads"),
        ("Stage 1", "Stage 2", "Sensitive", "Fragrance-free", "Apple", "Banana", "Size 3", "Size 4"),
        "PACKAGED", "AMBIENT", False, False, 4.5, 0.0, ((120, "g"), (4 * 90, "g"), (900, "g")), ("pack", "each", "box"), 0.7,
    ),  # fmt: skip
    "household": CategorySpec(
        ("Washing-up Liquid", "Kitchen Roll", "Bin Bags", "Laundry Detergent", "Sponges", "Toilet Tissue", "Foil", "Cling Film", "Surface Spray", "Dishwasher Tablets"),
        ("Lemon", "Fresh", "Extra Strong", "Value", "Biodegradable", "Multipack", "Large", "Sensitive"),
        "HOUSEHOLD", "AMBIENT", False, False, 3.8, 0.0, ((500, "ml"), (1, "l"), (750, "ml")), ("each", "pack", "box"), 1.5,
    ),  # fmt: skip
    "personal-care": CategorySpec(
        ("Hand Soap", "Shampoo", "Conditioner", "Toothpaste", "Shower Gel", "Deodorant", "Body Lotion", "Toothbrush", "Razor Blades"),
        ("Fresh", "Sensitive", "Mint", "Coconut", "Fragrance-free", "Family", "Travel", "Whitening"),
        "HOUSEHOLD", "AMBIENT", False, False, 3.3, 0.0, ((250, "ml"), (400, "ml"), (75, "g")), ("each", "pack"), 1.4,
    ),  # fmt: skip
}  # fmt: skip


def spec_for(slug: str) -> CategorySpec:
    return SPECS.get(slug, GENERIC)
