"""Dev-only demo accounts, addresses and sample reviews. NEVER load these into a production database."""

from __future__ import annotations

DEMO_DOMAIN = "demo.orchardrow.test"
DEFAULT_PASSWORD = "OrchardDemo-2024!"  # documented dev default; override with --password or DEMO_PASSWORD

# local part, full name, role, branch codes, all_branches
STAFF = [
    ("superadmin", "Demo Super Admin", "SUPER_ADMIN", [], False),
    ("admin", "Demo Admin", "ADMIN", [], False),
    ("manager.central", "Demo Store Manager (Central)", "STORE_MANAGER", ["central"], False),
    ("manager.north", "Demo Store Manager (Northside)", "STORE_MANAGER", ["north"], False),
    ("inventory", "Demo Inventory Manager (Central)", "INVENTORY_MANAGER", ["central"], False),
    ("purchasing", "Demo Purchasing Manager", "PURCHASING_MANAGER", ["central", "north"], False),
    ("picker", "Demo Picker (Central)", "FULFILMENT_STAFF", ["central"], False),
    ("support", "Demo Support Agent", "CUSTOMER_SUPPORT", [], True),
    ("marketing", "Demo Marketing Manager", "MARKETING_MANAGER", [], True),
]

# local part, full name, phone, addresses [(label, line1, line2, area, postcode, instructions)]; the first is the default
CUSTOMERS = [
    ("alex", "Alex Rivera", "+1 555 0141", [("Home", "12 Linden Court", "", "Linden Park", "RW2 4AB", ""), ("Work", "3 Quay Street", "Floor 2", "Harbourside", "RW1 2QS", "Reception desk takes parcels.")]),
    ("sam", "Sam Okafor", "+1 555 0142", [("Home", "58 Fieldgate Road", "", "Fieldgate", "RW3 5DE", "Leave with the neighbour at no. 60 if out (demo).")]),
    ("priya", "Priya Nair", "+1 555 0143", [("Home", "7 Market Quarter Walk", "Flat 3", "Market Quarter", "RW1 3HX", ""), ("Parents", "21 Hillcrest Drive", "", "Hillcrest", "RW4 1PL", "Ring twice.")]),
    ("jordan", "Jordan Lee", "+1 555 0144", [("Home", "101 Old Town Row", "", "Old Town", "RW1 1BT", "")]),
    ("mei", "Mei Tanaka", "+1 555 0145", [("Home", "24 Westbrook Mews", "", "Westbrook", "RW2 7LN", ""), ("Office", "9 Quay Street", "", "Harbourside", "RW1 2QT", "")]),
    ("tomas", "Tomas Novak", "+1 555 0146", [("Home", "15 Eastfield Close", "", "Eastfield", "RW4 3GF", "")]),
    ("amara", "Amara Diallo", "+1 555 0147", [("Home", "33 Northside Terrace", "", "Northside", "RW3 1KD", ""), ("Studio", "2 Fieldgate Mews", "", "Fieldgate", "RW3 5DG", "Side door.")]),
    ("lucas", "Lucas Ferreira", "+1 555 0148", [("Home", "66 Harbour Steps", "Flat 9", "Harbourside", "RW1 4ZZ", "")]),
]  # fmt: skip

# product name, reviewer, rating, title, body, days ago
REVIEWS = [
    ("Bananas", "alex", 5, "Good for the week", "Picked a kilo and they were a good mix of ripeness. They lasted most of the week."),
    ("Bananas", "sam", 4, "Fine for smoothies", "A couple were greener than I expected, but they ripened on the counter in two days."),
    ("Bananas", "priya", 5, "Reliable", "Same as every week. The picked weight came out close to what I ordered."),
    ("Whole Milk", "jordan", 5, "Always the same", "No complaints. The date was more than a week out when it arrived."),
    ("Whole Milk", "mei", 4, "Handy big bottle", "The 2 L bottle suits the family. The handle is a little awkward to pour from."),
    ("Whole Milk", "tomas", 3, "Date was short", "Tastes fine, but the use-by date was only four days away when it arrived."),
    ("Large White Eggs", "amara", 5, "No cracks", "All twelve were intact and the yolks held up well when frying."),
    ("Large White Eggs", "lucas", 4, "Good for baking", "Used them for a sponge cake and breakfast. The carton was slightly crushed at one corner."),
    ("Large White Eggs", "alex", 5, "Good value", "A dozen goes a long way in our house. Nothing to report."),
    ("Gala Apples", "sam", 5, "Sweet and firm", "Crunchy and sweet, and the right size for lunchboxes."),
    ("Gala Apples", "priya", 4, "Good everyday apple", "Nice flavour. Two of them had small bruises but they were fine once cut."),
    ("Gala Apples", "mei", 2, "A few soft ones", "Two of the six apples had soft patches and went straight in the bin. The rest were fine."),
    ("Vine Tomatoes", "jordan", 5, "Good on toast", "Ripe, juicy and still on the vine. Used them within a couple of days."),
    ("Vine Tomatoes", "tomas", 4, "Tasty", "Good in salads. A bit pricey per kilo but they tasted like tomatoes."),
    ("Vine Tomatoes", "lucas", 3, "Mixed batch", "Some were great, a couple were pale and watery inside."),
    ("Avocados", "amara", 4, "Ripened in a couple of days", "Ordered four. Three were ready within two days and one took longer."),
    ("Avocados", "alex", 3, "Hard to judge", "Two were ready to eat and two needed several more days. The ripeness guide helped."),
    ("Avocados", "sam", 5, "Good for toast", "Creamy and not stringy. Will order again."),
    ("Sourdough Loaf", "priya", 5, "Chewy crust", "Lovely crust and an open crumb. Good for toast the next day too."),
    ("Sourdough Loaf", "mei", 4, "Good loaf", "Tastes good and slices well. A little pricey but it is a big loaf."),
    ("Sourdough Loaf", "jordan", 2, "Stale on day two", "The crust went hard quickly. Better eaten on the day it arrives."),
    ("Carrots", "tomas", 4, "Nice and crunchy", "Good size for roasting. A bit of soil on them, but nothing a rinse does not fix."),
    ("Carrots", "lucas", 5, "Sweet and crisp", "Used them raw and in soup. Good all round."),
    ("Baby Spinach", "amara", 3, "A bit damp", "The leaves were fine but there was moisture in the bag, so I used it quickly."),
    ("Baby Spinach", "alex", 5, "Clean and ready to use", "Good in omelettes and salads. Used the whole bag in two days."),
    ("Cheddar", "sam", 5, "Proper cheddar", "Firm with a good tang. They cut it to the weight I ordered."),
    ("Cheddar", "priya", 4, "Good cheese", "Good for sandwiches and grating. Wish I could pick a stronger one."),
    ("Cheddar", "mei", 5, "Melts well", "Used it for a toastie and macaroni cheese. Good flavour."),
    ("Strawberries", "jordan", 4, "Sweet berries", "Mostly ripe and sweet. One or two had white shoulders."),
    ("Strawberries", "tomas", 5, "Great with yogurt", "A full punnet that did not last the weekend."),
    ("Strawberries", "amara", 3, "Hit and miss", "Half were lovely and half were a bit sour. Fine for baking."),
    ("Olive Oil", "lucas", 5, "Good everyday oil", "Mild and fruity enough for dressings and cooking. Bottle pours cleanly."),
    ("Olive Oil", "alex", 4, "Good for the price", "Nice on salads. I would like a larger bottle size."),
    ("Basmati Rice", "sam", 5, "Fluffy grains", "Long grains that stay separate. Rinsed twice and it came out well."),
    ("Basmati Rice", "priya", 5, "Our usual rice", "Cooks evenly and smells good. The bag reseals well."),
    ("Greek-Style Yogurt", "mei", 4, "Thick and creamy", "Good with fruit and honey. Slightly tangy."),
    ("Greek-Style Yogurt", "jordan", 5, "Useful in cooking", "Stirred it into a curry and used it as a topping. Stays thick."),
    ("Butter Croissant", "tomas", 4, "Flaky", "Warmed it for five minutes and it was good. Best on the day."),
    ("Butter Croissant", "amara", 5, "Buttery", "Light layers and a good bake. Wish they were a little bigger."),
    ("Chicken Breast Fillets", "lucas", 4, "Good quality", "Clean fillets with little trimming needed. Cooked evenly."),
    ("Chicken Breast Fillets", "alex", 2, "Uneven thickness", "Two of the fillets were very thick at one end and thin at the other, so they cooked unevenly."),
    ("Salmon Fillets", "sam", 5, "Good salmon", "Even portions and no bones that I found. Baked for twelve minutes."),
    ("Salmon Fillets", "priya", 4, "Nice, a bit pricey", "Cooked well and tasted fine. It is an expensive item, so I buy it occasionally."),
    ("Crunchy Granola", "mei", 4, "Good crunch", "Lots of oats and almonds. Good with yogurt."),
    ("Crunchy Granola", "jordan", 3, "A little sweet", "Good texture but sweeter than I like. Fine mixed with plain oats."),
    ("Medium-Roast Ground Coffee", "tomas", 4, "Smooth", "Works well in my filter machine. Not bitter."),
    ("Medium-Roast Ground Coffee", "amara", 2, "Too weak for me", "Needed a lot of grounds to get a strong cup. May suit lighter drinkers."),
    ("Spaghetti", "lucas", 5, "Cooks well", "Holds its texture and does not stick together. Ready in nine minutes."),
    ("Spaghetti", "sam", 4, "Reliable", "Does what it should. Good value at this price."),
    ("Blueberries", "alex", 4, "Plump", "Good size and sweet. The punnet was full."),
]  # fmt: skip
