"""Demo operations data: store settings, branches, delivery zones, slots, suppliers, purchase orders, stock scenarios,
promotions, coupons and collections. Plain data (no Django imports); dates are expressed as offsets from today."""

from __future__ import annotations

import datetime as dt

# --------------------------------------------------------------------------- store settings
STORE = {
    "name": "Orchard Row",
    "tagline": "Fresh, honestly labelled.",
    "legal_name": "",
    "support_email": "hello@orchardrow.example",
    "support_phone": "+1 555 0100",
    "support_hours": "Mon-Sat 8am-8pm, Sun 10am-5pm (demo hours)",
    "address": "Orchard Row Central, 1 Market Lane, Riverton RW1 1AA (fictional demo address)",
    "currency": "USD",
    "locale": "en-US",
    "timezone": "America/New_York",
    "tax_label": "Tax",
    "complaint_window_hours": 24,
    "demo_mode": True,
    "instagram_url": "https://instagram.com/orchardrow-demo",
    "facebook_url": "https://facebook.com/orchardrow-demo",
    "x_url": "https://x.com/orchardrow_demo",
    "youtube_url": "https://youtube.com/@orchardrow-demo",
    "tiktok_url": "https://tiktok.com/@orchardrow-demo",
    "socials_are_placeholders": True,
}
DEFAULT_SUPPORT_EMAIL = "hello@example.invalid"  # StoreSettings default: a row still carrying it is safe to fill in

# --------------------------------------------------------------------------- branches
T = dt.time
BRANCHES = [
    {
        "code": "central",
        "name": "Orchard Row Central",
        "slug": "central",
        "address_line1": "1 Market Lane",
        "address_line2": "",
        "city": "Riverton",
        "area": "Old Town",
        "postal_code": "RW1 1AA",
        "phone": "+1 555 0110",
        "email": "central@orchardrow.example",
        "is_default": True,
        "prep_minutes": 120,
        "pickup_instructions": "Collect from the pickup desk by the main entrance and give your order number. "
        "(Demonstration store: no real pickup desk exists.)",
        # weekday 0=Mon .. 6=Sun -> (opens, closes) or None when closed
        "hours": {
            0: (T(7), T(21)),
            1: (T(7), T(21)),
            2: (T(7), T(21)),
            3: (T(7), T(21)),
            4: (T(7), T(21)),
            5: (T(7), T(21)),
            6: (T(9), T(18)),
        },
        "pickup_hours": (9, 20),  # first start hour, last end hour (Mon-Sat); Sunday uses sunday_pickup_hours
        "sunday_pickup_hours": (10, 17),
        "closure": None,
    },
    {
        "code": "north",
        "name": "Orchard Row Northside",
        "slug": "north",
        "address_line1": "40 Fieldgate Road",
        "address_line2": "",
        "city": "Riverton",
        "area": "Northside",
        "postal_code": "RW3 2NB",
        "phone": "+1 555 0120",
        "email": "north@orchardrow.example",
        "is_default": False,
        "prep_minutes": 90,
        "pickup_instructions": "Collect from the side counter on Fieldgate Road. (Demonstration store: no real pickup "
        "counter exists.)",
        "hours": {
            0: (T(8), T(20)),
            1: (T(8), T(20)),
            2: (T(8), T(20)),
            3: (T(8), T(20)),
            4: (T(8), T(20)),
            5: (T(8), T(18)),
            6: None,
        },
        "pickup_hours": (9, 17),
        "sunday_pickup_hours": None,
        "closure": "Staff training day (demo)",
    },
]

DELIVERY_WINDOWS = [(9, 12), (12, 15), (15, 18), (18, 21)]

# branch code -> zones; capacities are per delivery window in order of DELIVERY_WINDOWS
ZONES = {
    "central": [
        {
            "name": "Old Town and Market Quarter",
            "postcode_prefixes": ["RW1"],
            "areas": ["old town", "market quarter", "harbourside"],
            "delivery_fee": "3.99",
            "free_delivery_threshold": "60.00",
            "min_order_value": "20.00",
            "priority": 10,
            "capacity": [12, 12, 10, 8],
        },
        {
            "name": "Central Outer",
            "postcode_prefixes": ["RW2"],
            "areas": ["linden park", "westbrook"],
            "delivery_fee": "5.99",
            "free_delivery_threshold": "80.00",
            "min_order_value": "30.00",
            "priority": 20,
            "capacity": [8, 8, 6, 6],
        },
    ],
    "north": [
        {
            "name": "Northside",
            "postcode_prefixes": ["RW3"],
            "areas": ["northside", "fieldgate"],
            "delivery_fee": "4.49",
            "free_delivery_threshold": "70.00",
            "min_order_value": "25.00",
            "priority": 10,
            "capacity": [8, 8, 6, 6],
        },
        {
            "name": "Northside Outer",
            "postcode_prefixes": ["RW4"],
            "areas": ["eastfield", "hillcrest"],
            "delivery_fee": "6.49",
            "free_delivery_threshold": "90.00",
            "min_order_value": "35.00",
            "priority": 20,
            "capacity": [6, 6, 6, 6],
        },
    ],
}
PICKUP_CAPACITY = {"central": 8, "north": 6}

# --------------------------------------------------------------------------- suppliers (fictional)
SUPPLIERS = [
    {
        "code": "fernhill-wholesale",
        "name": "Fernhill Wholesale Produce",
        "contact_name": "Dana Whitcombe",
        "email": "orders@fernhill-wholesale.example",
        "phone": "+1 555 0131",
        "address": "Unit 4, Quay Industrial Estate, Riverton RW5 1XX (fictional)",
        "lead_time_days": 1,
        "prefix": "FWP",
        "categories": ["vegetables", "fruit", "leafy-greens", "herbs", "citrus", "berries", "root-vegetables"],
    },
    {
        "code": "millbrook-supply",
        "name": "Millbrook Dairy Supply",
        "contact_name": "Rhys Ashdown",
        "email": "orders@millbrook-supply.example",
        "phone": "+1 555 0132",
        "address": "Dairy Yard, Mill Road, Riverton RW6 2DD (fictional)",
        "lead_time_days": 1,
        "prefix": "MDS",
        "categories": ["milk", "cheese", "yogurt", "butter-spreads", "eggs", "chilled-drinks", "plant-based"],
    },
    {
        "code": "hollow-oak-wholesale",
        "name": "Hollow Oak Wholesale Bakery",
        "contact_name": "Marit Ellery",
        "email": "orders@hollow-oak-wholesale.example",
        "phone": "+1 555 0133",
        "address": "Bakehouse Lane, Riverton RW5 3BK (fictional)",
        "lead_time_days": 1,
        "prefix": "HOW",
        "categories": ["bread", "rolls-buns", "pastries", "cakes"],
    },
    {
        "code": "tideline-chilled",
        "name": "Tideline Chilled & Frozen Distribution",
        "contact_name": "Ines Carrow",
        "email": "orders@tideline-chilled.example",
        "phone": "+1 555 0134",
        "address": "Cold Store 2, Harbour Trading Park, Riverton RW1 9HP (fictional)",
        "lead_time_days": 2,
        "prefix": "TCF",
        "categories": ["meat-poultry", "seafood", "frozen-vegetables", "frozen-fruit", "frozen-meals"],
    },
    {
        "code": "brightfield-dist",
        "name": "Brightfield Distribution",
        "contact_name": "Owen Tarrant",
        "email": "orders@brightfield-dist.example",
        "phone": "+1 555 0135",
        "address": "Depot 9, Ashgrove Business Park, Riverton RW4 7LT (fictional)",
        "lead_time_days": 3,
        "prefix": "BFD",
        "categories": [
            "rice-grains",
            "pasta",
            "flour-baking",
            "cooking-oils",
            "spices-seasonings",
            "sauces-condiments",
            "canned-goods",
            "cereals-breakfast",
            "legumes-beans",
            "water",
            "juices",
            "coffee-tea",
            "nuts-seeds",
            "dried-fruit",
            "snacks",
            "gluten-free",
        ],  # fmt: skip
    },
    {
        "code": "wrenfield-trade",
        "name": "Wrenfield Trade Supply",
        "contact_name": "Petra Lowden",
        "email": "orders@wrenfield-trade.example",
        "phone": "+1 555 0136",
        "address": "Warehouse C, Ashgrove Business Park, Riverton RW4 7LT (fictional)",
        "lead_time_days": 4,
        "prefix": "WTS",
        "categories": ["baby", "household", "personal-care"],
    },
]
SUPPLIER_NOTE = "Demo supplier (fictional). Replace with real supplier records before use."

# purchase orders: number, supplier code, branch, status, expected in N days, submitted N days ago, lines
PURCHASE_ORDERS = [
    {
        "number": "PO-DEMO-0001",
        "supplier": "fernhill-wholesale",
        "branch": "central",
        "status": "DRAFT",
        "expected_in": 2,
        "submitted_ago": None,
        "notes": "Draft weekly produce order (demo).",
        "lines": [("Vine Tomatoes", 40), ("Bananas", 60), ("Gala Apples", 40), ("Carrots", 50), ("Baby Spinach", 30)],
    },
    {
        "number": "PO-DEMO-0002",
        "supplier": "millbrook-supply",
        "branch": "central",
        "status": "SUBMITTED",
        "expected_in": 1,
        "submitted_ago": 1,
        "notes": "Dairy top-up submitted to the supplier (demo).",
        "lines": [
            ("Whole Milk", 48),
            ("2% Milk", 24),
            ("Large White Eggs", 36),
            ("Unsalted Butter", 30),
            ("Greek-Style Yogurt", 24),
        ],
    },
    {
        "number": "PO-DEMO-0003",
        "supplier": "brightfield-dist",
        "branch": "north",
        "status": "CONFIRMED",
        "expected_in": 3,
        "submitted_ago": 2,
        "notes": "Pantry restock confirmed by the supplier (demo).",
        "lines": [
            ("Basmati Rice", 24),
            ("Spaghetti", 48),
            ("Olive Oil", 18),
            ("Diced Tomatoes", 60),
            ("Rolled Oats", 24),
            ("Red Lentils", 30),
        ],
    },
]

# --------------------------------------------------------------------------- stock scenarios
# Defaults come from the loader (healthy two-batch stock for batch-tracked products, one lot for shelf-stable ones).
# Overrides: product name -> {branch code: spec}. Spec keys:
#   skip (no stock row), on_hand + threshold (low stock / zero stock), batches = [explicit batch specs]
#   batch spec: suffix, received_ago, days_left (None = no expiry), qty, status, quality, note, waste (qty written off)
SINGLE_BRANCH = ["Whole Chicken", "Salmon Fillets", "Sweet Potatoes", "Firm Tofu", "Diapers Size 4 30 Count"]

STOCK_SCENARIOS: dict[str, dict[str, dict]] = {
    # ~11 low-stock products (on hand at or below the alert threshold)
    "Avocados": {"central": {"on_hand": 9, "threshold": 12}, "north": {"on_hand": 4, "threshold": 6}},
    "Large White Eggs": {"central": {"on_hand": 5, "threshold": 10}},
    "Unsalted Butter": {"central": {"on_hand": 6, "threshold": 12}},
    "Baby Spinach": {
        "central": {
            "threshold": 15,
            "batches": [
                {"suffix": "A", "received_ago": 5, "days_left": 1, "qty": 3},
                {"suffix": "B", "received_ago": 1, "days_left": 5, "qty": 5},
            ],
        }
    },
    "Olive Oil": {"central": {"on_hand": 6, "threshold": 10}, "north": {"on_hand": 3, "threshold": 6}},
    "Basmati Rice": {"central": {"on_hand": 5, "threshold": 10}},
    "Tomato Pasta Sauce": {"central": {"on_hand": 7, "threshold": 12}},
    "Medium-Roast Ground Coffee": {"central": {"on_hand": 4, "threshold": 8}},
    "Whole Milk": {"central": {"on_hand": 11, "threshold": 18}},
    "Strawberries": {"central": {"on_hand": 7, "threshold": 12}},
    "Garden Peas": {"north": {"on_hand": 5, "threshold": 10}},
    # ~7 products with zero stock
    "Dark Chocolate Bar": {"central": {"on_hand": 0, "threshold": 10}, "north": {"on_hand": 0, "threshold": 6}},
    "Mango Chunks": {"central": {"on_hand": 0, "threshold": 8}, "north": {"on_hand": 0, "threshold": 6}},
    "Black Beans": {"central": {"on_hand": 0, "threshold": 10}},
    "Sourdough Loaf": {"central": {"on_hand": 0, "threshold": 8}, "north": {"on_hand": 0, "threshold": 5}},
    "Raspberries": {
        "central": {
            "batches": [
                {
                    "suffix": "A",
                    "received_ago": 6,
                    "days_left": -1,
                    "qty": 14,
                    "status": "EXPIRED",
                    "waste": 14,
                    "note": "Whole lot written off after expiry (demo).",
                }
            ],
            "threshold": 10,
        },
        "north": {"on_hand": 0, "threshold": 6, "batches": []},
    },
    "Cod Fillets": {
        "central": {
            "batches": [
                {
                    "suffix": "A",
                    "received_ago": 5,
                    "days_left": -1,
                    "qty": 9,
                    "status": "EXPIRED",
                    "waste": 9,
                    "note": "Whole lot written off after expiry (demo).",
                }
            ],
            "threshold": 4,
        }
    },
    # near-expiry (1-3 days left) batches, alongside a healthy second batch
    "Cremini Mushrooms": {
        "north": {
            "batches": [
                {"suffix": "A", "received_ago": 4, "days_left": 2, "qty": 6},
                {"suffix": "B", "received_ago": 1, "days_left": 5, "qty": 12},
            ]
        }
    },
    "Greek-Style Yogurt": {
        "central": {
            "batches": [
                {"suffix": "A", "received_ago": 15, "days_left": 3, "qty": 10},
                {"suffix": "B", "received_ago": 2, "days_left": 16, "qty": 26},
            ]
        }
    },
    "Mozzarella Ball": {
        "north": {
            "batches": [
                {"suffix": "A", "received_ago": 12, "days_left": 2, "qty": 7},
                {"suffix": "B", "received_ago": 1, "days_left": 11, "qty": 12},
            ]
        }
    },
    "Chicken Breast Fillets": {
        "central": {
            "batches": [
                {"suffix": "A", "received_ago": 4, "days_left": 1, "qty": 4.5},
                {"suffix": "B", "received_ago": 1, "days_left": 4, "qty": 14},
            ]
        }
    },
    "Butter Croissant": {
        "central": {
            "batches": [
                {"suffix": "A", "received_ago": 1, "days_left": 1, "qty": 10},
                {"suffix": "B", "received_ago": 0, "days_left": 2, "qty": 24},
            ]
        }
    },
    "Brie": {
        "central": {
            "batches": [
                {"suffix": "A", "received_ago": 36, "days_left": 3, "qty": 8},
                {"suffix": "B", "received_ago": 6, "days_left": 33, "qty": 20},
            ]
        }
    },
    "Orange Juice": {
        "central": {
            "batches": [
                {"suffix": "A", "received_ago": 12, "days_left": 2, "qty": 9},
                {"suffix": "B", "received_ago": 3, "days_left": 11, "qty": 30},
            ]
        }
    },
    # expired lots still on the shelf (to be written off) and one written-off bakery lot
    "Basil": {
        "central": {
            "batches": [
                {
                    "suffix": "A",
                    "received_ago": 7,
                    "days_left": -1,
                    "qty": 6,
                    "status": "EXPIRED",
                    "note": "Past use-by; awaiting write-off (demo).",
                },
                {"suffix": "B", "received_ago": 1, "days_left": 5, "qty": 18},
            ]
        }
    },
    "Romaine Lettuce": {
        "north": {
            "batches": [
                {
                    "suffix": "A",
                    "received_ago": 8,
                    "days_left": -2,
                    "qty": 5,
                    "status": "EXPIRED",
                    "note": "Past use-by; awaiting write-off (demo).",
                },
                {"suffix": "B", "received_ago": 1, "days_left": 5, "qty": 14},
            ]
        }
    },
    "Cooked Peeled Shrimp": {
        "central": {
            "batches": [
                {
                    "suffix": "A",
                    "received_ago": 6,
                    "days_left": -1,
                    "qty": 4,
                    "status": "EXPIRED",
                    "note": "Past use-by; awaiting write-off (demo).",
                },
                {"suffix": "B", "received_ago": 1, "days_left": 4, "qty": 11},
            ]
        }
    },
    "Baguette": {
        "central": {
            "batches": [
                {
                    "suffix": "A",
                    "received_ago": 3,
                    "days_left": -1,
                    "qty": 12,
                    "status": "EXPIRED",
                    "waste": 12,
                    "note": "Unsold lot written off (demo).",
                },
                {"suffix": "B", "received_ago": 0, "days_left": 2, "qty": 20},
            ]
        }
    },
    # blocked lots: one quarantined, one that failed inspection
    "Ground Beef": {
        "north": {
            "batches": [
                {"suffix": "A", "received_ago": 1, "days_left": 4, "qty": 10},
                {
                    "suffix": "B",
                    "received_ago": 1,
                    "days_left": 4,
                    "qty": 6,
                    "status": "QUARANTINED",
                    "quality": "PENDING",
                    "note": "Held pending supplier temperature-log review (demo).",
                },
            ]
        }
    },
    "Cucumbers": {
        "central": {
            "batches": [
                {"suffix": "A", "received_ago": 2, "days_left": 5, "qty": 36},
                {
                    "suffix": "B",
                    "received_ago": 1,
                    "days_left": 6,
                    "qty": 12,
                    "quality": "FAILED",
                    "note": "Failed incoming inspection: bruising on delivery (demo).",
                },
            ]
        }
    },
}

# --------------------------------------------------------------------------- promotions and coupons
# starts / ends are offsets in days from local midnight today (ends: exclusive, i.e. the start of that day)
PROMOTIONS = [
    {
        "name": "Berries: 15% off",
        "label": "15% off",
        "kind": "PERCENT_OFF",
        "scope": "CATEGORIES",
        "categories": ["berries"],
        "percent": "15",
        "starts": -2,
        "ends": 10,
        "active": True,
    },
    {
        "name": "Price drop: apples and onions",
        "label": "Save $0.50",
        "kind": "AMOUNT_OFF",
        "scope": "PRODUCTS",
        "products": ["Gala Apples", "Granny Smith Apples", "Yellow Onions"],
        "amount_off": "0.50",
        "starts": -5,
        "ends": 16,
        "active": True,
    },
    {
        "name": "Price drop: orange juice",
        "label": "Save $0.50",
        "kind": "AMOUNT_OFF",
        "scope": "PRODUCTS",
        "products": ["Orange Juice"],
        "amount_off": "0.50",
        "starts": -3,
        "ends": 12,
        "active": True,
    },
    {
        "name": "Pasta: 3 for $5",
        "label": "3 for $5",
        "kind": "MULTIBUY",
        "scope": "PRODUCTS",
        "products": ["Spaghetti", "Penne Rigate"],
        "multibuy_qty": 3,
        "multibuy_price": "5.00",
        "starts": -4,
        "ends": 20,
        "active": True,
    },
    {
        "name": "Citrus: 10% off (ends soon)",
        "label": "10% off",
        "kind": "PERCENT_OFF",
        "scope": "CATEGORIES",
        "categories": ["citrus"],
        "percent": "10",
        "starts": -5,
        "ends": 3,  # ends in two days (the end of the day after tomorrow)
        "active": True,
    },
    {
        "name": "Potato offer (expired)",
        "label": "20% off",
        "kind": "PERCENT_OFF",
        "scope": "PRODUCTS",
        "products": ["Russet Potatoes"],
        "percent": "20",
        "starts": -20,
        "ends": -3,
        "active": True,
    },
    {
        "name": "Bakery: 10% off (paused)",
        "label": "10% off",
        "kind": "PERCENT_OFF",
        "scope": "CATEGORIES",
        "categories": ["bakery"],
        "percent": "10",
        "starts": 0,
        "ends": 30,
        "active": False,
    },
]

COUPONS = [
    {
        "code": "WELCOME10",
        "description": "10% off your first order over $25 (up to $15 off).",
        "kind": "PERCENT",
        "value": "10",
        "max_discount": "15.00",
        "min_order_value": "25.00",
        "first_order_only": True,
        "per_customer_limit": 1,
        "starts": -30,
        "ends": None,
    },
    {
        "code": "FRESH5",
        "description": "$5 off baskets over $40.",
        "kind": "FIXED",
        "value": "5.00",
        "min_order_value": "40.00",
        "per_customer_limit": 2,
        "starts": -30,
        "ends": None,
    },
    {
        "code": "FREESHIP",
        "description": "Free delivery on orders over $30.",
        "kind": "FREE_DELIVERY",
        "value": "0",
        "min_order_value": "30.00",
        "per_customer_limit": 3,
        "starts": -30,
        "ends": None,
    },
    {
        "code": "BAKERY15",
        "description": "15% off bakery items (up to $10 off).",
        "kind": "PERCENT",
        "value": "15",
        "max_discount": "10.00",
        "min_order_value": "15.00",
        "scope": "CATEGORIES",
        "categories": ["bakery", "bread", "rolls-buns", "pastries", "cakes"],
        "per_customer_limit": 2,
        "starts": -10,
        "ends": 45,
    },
    {
        "code": "SPRING20",
        "description": "20% off (expired demo code).",
        "kind": "PERCENT",
        "value": "20",
        "min_order_value": "30.00",
        "starts": -60,
        "ends": -10,
    },
    {
        "code": "LASTONE",
        "description": "$3 off (single-use demo code, already redeemed).",
        "kind": "FIXED",
        "value": "3.00",
        "min_order_value": "10.00",
        "usage_limit": 1,
        "used_count": 1,
        "starts": -20,
        "ends": None,
    },
]

# --------------------------------------------------------------------------- collections
COLLECTIONS = [
    {
        "slug": "seasonal-produce",
        "name": "Seasonal produce",
        "description": "Apples, pears, roots and hearty greens for roasting, baking and slow cooking.",
        "show_on_home": True,
        "sort_order": 10,
        "products": [
            "Gala Apples",
            "Granny Smith Apples",
            "Bartlett Pears",
            "Sweet Potatoes",
            "Carrots",
            "Russet Potatoes",
            "Cauliflower",
            "Broccoli",
            "Curly Kale",
            "Yellow Onions",
            "Garlic",
            "Navel Oranges",
        ],
    },  # fmt: skip
    {
        "slug": "pantry-staples",
        "name": "Pantry staples",
        "description": "Rice, pasta, flour, oil, tins and seasonings to keep the cupboard stocked.",
        "show_on_home": True,
        "sort_order": 20,
        "products": [
            "Long-Grain White Rice",
            "Basmati Rice",
            "Rolled Oats",
            "Spaghetti",
            "Penne Rigate",
            "All-Purpose Flour",
            "Granulated Sugar",
            "Olive Oil",
            "Diced Tomatoes",
            "Chickpeas in Water",
            "Red Lentils",
            "Fine Sea Salt",
            "Ground Black Pepper",
        ],
    },  # fmt: skip
    {
        "slug": "weeknight-dinners",
        "name": "Weeknight dinners",
        "description": "Pasta, sauces, vegetables and proteins for quick evening meals.",
        "show_on_home": True,
        "sort_order": 30,
        "products": [
            "Chicken Breast Fillets",
            "Ground Beef",
            "Spaghetti",
            "Tomato Pasta Sauce",
            "Vine Tomatoes",
            "Baby Spinach",
            "Cheddar",
            "Garden Peas",
            "Margherita Pizza",
            "Corn Tortillas 8-Pack",
            "Red Bell Peppers",
            "Yellow Onions",
        ],
    },  # fmt: skip
    {
        "slug": "plant-based-kitchen",
        "name": "Plant-based kitchen",
        "description": "Oat drink, tofu, hummus, pulses and grains for meat-free cooking.",
        "show_on_home": False,
        "sort_order": 40,
        "products": [
            "Oat Drink",
            "Firm Tofu",
            "Chickpea Hummus",
            "Chickpeas in Water",
            "Red Lentils",
            "Black Beans",
            "Dried Chickpeas",
            "Brown Rice Penne",
            "Baby Spinach",
            "Avocados",
            "Sunflower Seeds",
        ],
    },  # fmt: skip
    {
        "slug": "breakfast-table",
        "name": "Breakfast table",
        "description": "Eggs, milk, oats, fruit, pastries and coffee for the morning.",
        "show_on_home": True,
        "sort_order": 50,
        "products": [
            "Large White Eggs",
            "Whole Milk",
            "Unsalted Butter",
            "Crunchy Granola",
            "Rolled Oats",
            "Clear Honey",
            "Greek-Style Yogurt",
            "Blueberries",
            "Bananas",
            "Butter Croissant",
            "Orange Juice",
            "Medium-Roast Ground Coffee",
        ],
    },  # fmt: skip
]
