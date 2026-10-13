"""Demo content: policy pages (template wording), FAQs, recipes, grocery guides and banners.

All policy pages are TEMPLATE TEXT that the business and its legal adviser must review. Nothing here states legal
compliance, certification or guarantees.
"""

from __future__ import annotations

TEMPLATE_NOTICE = (
    "> **Template text.** This page is placeholder wording supplied with the Orchard Row demonstration store. "
    "It must be reviewed and adapted by the business and its legal adviser before launch. It is not legal advice and "
    "makes no statement of legal compliance, certification or guarantee. Items in [square brackets] are blanks to fill in."
)

PAGES = [
    {
        "slug": "about",
        "title": "About Orchard Row",
        "summary": "What this store is, how its product information works and how to reach us (template text).",
        "body": TEMPLATE_NOTICE
        + """

## Who we are

Orchard Row is an online grocer: fruit and vegetables, pantry goods, dairy, bakery, meat, fish, frozen food and
household basics, delivered from our branches or ready to collect in store.

**This site is currently a demonstration store.** Products, prices, reviews, brands and illustrations are
sample data created to show how the shop works. Nothing here can be ordered for real delivery.

## How we describe our products

- Every product page shows how it is sold (per kilogram, per pack, each) and a unit price so you can compare.
- Details such as origin, ingredients, allergens and nutrition appear **only when we have them**. If a detail is
  missing the page says it is not provided rather than guessing.
- Dietary and quality claims (for example vegan or gluten-free) are shown only once the claim has been checked and
  recorded by our team.

## Contact

Email: hello@orchardrow.example
Phone: +1 555 0100 (demo number)
Business name and registered address: [to be completed by the business]
""",
    },
    {
        "slug": "sourcing-and-freshness",
        "title": "Sourcing and freshness",
        "summary": "How we show origin, dates and quality information, and what we do not claim (template text).",
        "body": TEMPLATE_NOTICE
        + """

## What we say, and what we do not

We do not make blanket statements about where our food comes from or how it was grown. Where a product page shows an
origin, it comes from the supplier record for that product. In this demonstration store the origins shown on a few
products are examples only and are labelled as demo data.

## Dates and shelf life

- Chilled and fresh products are tracked in batches, each with a best-before or use-by date.
- We stop selling a batch a set number of days before its date. That margin depends on the product and is
  [to be confirmed by the business].
- The date printed on the pack you receive is the one that applies.

## Weighed and loose items

Loose fruit, vegetables, meat, fish and deli items are priced per kilogram or per 100 g. Appearance and size vary from
item to item.

## Quality problems

If something arrives damaged, spoiled or different from what you ordered, tell us within the complaint window described
in our refund and cancellation page and we will review it.
""",
    },
    {
        "slug": "delivery-policy",
        "title": "Delivery and pickup",
        "summary": "Delivery windows, zones, fees, minimum orders and store pickup (template text).",
        "body": TEMPLATE_NOTICE
        + """

## Delivery windows

Delivery is in time windows, for example 9:00 to 12:00 or 18:00 to 21:00. At checkout you choose from the windows
that are still open for your address. Each window has limited capacity, so busy windows can fill up.

## Where we deliver

Delivery is available inside our delivery zones, matched by postcode or area. Enter your address at checkout; if it is
outside a zone the checkout will say so and you can choose store pickup instead.

## Fees and minimum order

Each zone has its own delivery fee, a minimum order value and, in some zones, a basket value above which delivery is
free. The figures that apply to you are shown at checkout before you pay. Current values:
[to be confirmed by the business].

## Preparation time

We need time to prepare your order, so the earliest window you can choose starts after the branch's preparation time.

## Store pickup

Choose pickup at checkout and pick an hourly slot. Bring your order number. Pickup instructions for each branch are
shown on the stores page.

## If nobody is home

[Describe what happens when delivery cannot be completed: re-delivery, storage, and any charges.]
""",
    },
    {
        "slug": "refund-and-cancellation",
        "title": "Refunds and cancellation",
        "summary": "When you can cancel, how complaints about damaged or missing items work, and how refunds are paid (template text).",
        "body": TEMPLATE_NOTICE
        + """

## Cancelling an order

You can cancel yourself until we start picking your order. After that, contact support and we will see what is still
possible.

## Fresh food

Fresh and chilled food cannot be returned once delivered. This does not affect your right to raise a problem with
an item that is damaged, spoiled, incorrect or missing.

## Complaints

Report a problem within **24 hours of delivery or collection** (the complaint window shown in the store settings).
Include your order number and, where possible, a photo. Support will review it and may offer a refund of the affected
items or a credit.

## Weighed items

Weighed items are charged on their actual weight, up to the amount authorised at checkout. If a weighed item is lighter
than ordered you are charged less.

## How refunds are paid

Approved refunds go back to the original payment method. Timing depends on the payment provider:
[to be confirmed by the business].
""",
    },
    {
        "slug": "substitutions",
        "title": "Substitutions",
        "summary": "What happens when an item is out of stock while we pick your order (template text).",
        "body": TEMPLATE_NOTICE
        + """

## Your choice

When you check out you choose one of three options for items we cannot find:

1. **Allow substitutes** - we may replace the item with a similar one.
2. **Contact me first** - we ask you to approve or decline before anything is replaced.
3. **No substitutes** - we do not replace anything and refund the missing item.

You can also set a different choice for individual items.

## How a replacement is chosen

A substitute must be available at the branch, sold in the same way (by weight, by volume or by count) and come from
the same category. Its allergen information must not add allergens that the original did not have.

## What you pay

You never pay more for a substitute than you would have paid for the item it replaces.

## Records

Every substitution decision is recorded on your order so you can see what changed.
""",
    },
    {
        "slug": "privacy",
        "title": "Privacy",
        "summary": "Outline of the personal information a store like this handles; a legal adviser must complete it (template text).",
        "body": TEMPLATE_NOTICE
        + """

This page is an outline only. It does **not** describe a complete privacy notice and must not be published as one.

## Information we handle

- Account details: name, email address, phone number.
- Delivery details: addresses and delivery instructions.
- Order and payment records. Card details are handled by the payment provider and are not stored in this system.
- Support messages and review text you choose to submit.

## Why we use it

To take and deliver orders, take payment, handle support requests and keep the shop running safely.
[Complete the lawful bases and any marketing purposes.]

## How long we keep it

[Retention periods to be set by the business.]

## Your choices

[Describe access, correction, deletion and marketing preferences, and how to make a request.]

## Contact

Privacy contact: [to be completed]. Demo email: hello@orchardrow.example
""",
    },
    {
        "slug": "terms",
        "title": "Terms of use",
        "summary": "Outline of terms for using the shop; a legal adviser must complete it (template text).",
        "body": TEMPLATE_NOTICE
        + """

This page is an outline only. It does **not** form a complete set of terms and must not be published as one.

## Using the shop

You must give accurate details when you register and order. [Add account and acceptable-use rules.]

## Orders and prices

Prices are shown in US dollars. Prices, offers and availability can change. For items sold by weight, the final price is
based on the weight picked, up to the amount authorised at checkout.

## Payment

[Describe accepted payment methods, when your payment is authorised and when it is taken.] In the demonstration store,
payments use a sandbox page and no real money moves.

## Delivery, refunds and substitutions

See the delivery, refund and substitution pages. [Confirm they are consistent with these terms.]

## Liability and governing law

[To be completed by the business and its legal adviser.]
""",
    },
]

FAQS = [
    # (topic, sort, question, answer)
    ("Delivery", 10, "How do delivery windows work?", "You pick a delivery window at checkout, for example 12:00 to 15:00. Each window has a limited number of places, and only windows that are still open for your address are shown. Orders need preparation time, so the earliest window starts after the branch's preparation time."),
    ("Delivery", 20, "Do you deliver to my address?", "Delivery is available inside our delivery zones, matched by postcode or area. Enter your address at checkout; if it is outside every zone you will be told, and you can choose store pickup instead."),
    ("Delivery", 30, "What does delivery cost?", "Each zone has its own delivery fee and minimum order, and some zones offer free delivery above a basket value. The figures for your address are shown at checkout before you pay."),
    ("Pickup", 10, "Can I collect my order from a store?", "Yes. Choose pickup at checkout and book an hourly slot at either branch. Bring your order number; pickup instructions for each branch are on the stores page."),
    ("Substitutions", 10, "What happens if something is out of stock?", "You choose a policy at checkout: allow substitutes, contact me first, or no substitutes. With no substitutes the missing item is simply refunded. You can also set a different choice for individual items."),
    ("Substitutions", 20, "Will I pay more for a substitute?", "No. You never pay more for a substitute than for the item it replaces. Substitutes must also be sold in the same way and must not add allergens that the original item did not have."),
    ("Weighed items", 10, "How are weighed items priced?", "Loose fruit, vegetables, meat, fish and deli items are priced per kilogram or per 100 g. You order an expected weight and see an estimated price. Our picker weighs what goes in your order and you are charged for the actual weight."),
    ("Weighed items", 20, "Why is my final total different from the estimate?", "Weights vary item by item, so the picked weight is rarely exactly what you ordered. We authorise a little extra on your card to cover this, never charge more than the authorised amount, and charge less if the items weigh less."),
    ("Refunds", 10, "What if an item arrives damaged or wrong?", "Report it within 24 hours of delivery or collection, with your order number and a photo if you can. Support will review the complaint and may refund the affected items."),
    ("Refunds", 20, "Can I cancel my order?", "You can cancel yourself until we start picking your order. After that, contact support and we will check what is still possible."),
    ("Refunds", 30, "Can I return fresh food?", "Fresh and chilled food cannot be returned once delivered, but you can still report a problem within the complaint window if an item is damaged, spoiled, incorrect or missing."),
    ("Payments", 10, "How does payment work in this demo?", "This is a demonstration store. Card payments use a sandbox page where you can choose to succeed, fail or cancel, and no real money moves. Pay-on-delivery or pickup can also be used where the store enables it."),
    ("Payments", 20, "When is my card charged?", "At checkout we authorise your estimated total plus a small buffer for weighed items. The final charge is made once your order has been picked, based on the actual weights, and never exceeds the authorised amount."),
    ("Offers", 10, "How do I use a coupon code?", "Enter the code at checkout. Each code has its own rules, such as a minimum basket or a first-order limit, and by default it does not apply to items that already have a price promotion. The checkout tells you why a code was not accepted."),
    ("Products", 10, "Why does a product page say some information is not provided?", "We show origin, nutrition, ingredients and allergen details only when we have them. A missing detail is marked as not provided instead of being guessed. If allergen information is not confirmed, check the packaging before eating."),
    ("Products", 20, "How are vegan or gluten-free labels decided?", "A dietary or quality label appears on a product page and in filters only after our team has verified it and recorded the evidence. Products without a verified label are not described that way."),
    ("Products", 30, "What do best before and use by mean?", "Use by is a safety date for highly perishable food: do not eat it after that date. Best before is about quality: food is usually safe after it, but may not be at its best. Always follow the dates printed on the pack."),
    ("About this store", 10, "Is Orchard Row a real shop?", "No. Orchard Row is a demonstration store. The products, prices, reviews, brands and illustrations are sample data, and nothing can be ordered for real delivery."),
]  # fmt: skip

# --------------------------------------------------------------------------- recipes and guides
# kind, slug, title, summary, servings, minutes, products, published N days ago, body (markdown)
ARTICLES = [
    {
        "kind": "RECIPE",
        "slug": "roasted-tomato-basil-pasta",
        "title": "Roasted tomato and basil pasta",
        "summary": "Tomatoes roasted with garlic and olive oil until soft, tossed through spaghetti with torn basil.",
        "servings": 4,
        "total_minutes": 35,
        "published_ago": 3,
        "products": [
            "Vine Tomatoes",
            "Garlic",
            "Olive Oil",
            "Spaghetti",
            "Basil",
            "Fine Sea Salt",
            "Ground Black Pepper",
        ],
        "body": """## Ingredients

- 1 kg vine tomatoes, halved
- 4 cloves garlic, left whole in their skins
- 4 tablespoons olive oil
- 400 g spaghetti
- A handful of basil leaves
- Salt and black pepper

## Method

1. Heat the oven to 200 C (400 F). Spread the tomatoes cut-side up in a roasting tin with the garlic. Drizzle with 3 tablespoons of the oil and season.
2. Roast for 25 minutes, until the tomatoes are soft and starting to colour at the edges.
3. While they roast, boil the spaghetti in well-salted water until just tender. Save a cupful of the cooking water, then drain.
4. Squeeze the garlic out of its skins into the tin and crush it into the tomatoes with a fork.
5. Toss the pasta with the tomatoes, the remaining oil and a splash of cooking water until glossy. Tear over the basil and add pepper to taste.
""",
    },
    {
        "kind": "RECIPE",
        "slug": "lemon-garlic-roast-chicken",
        "title": "Lemon and garlic roast chicken with potatoes",
        "summary": "A whole chicken roasted over potatoes with lemon, garlic and parsley.",
        "servings": 5,
        "total_minutes": 110,
        "published_ago": 8,
        "products": [
            "Whole Chicken",
            "Lemons",
            "Garlic",
            "Russet Potatoes",
            "Olive Oil",
            "Flat-Leaf Parsley",
            "Fine Sea Salt",
            "Ground Black Pepper",
        ],
        "body": """## Ingredients

- 1 whole chicken, about 1.8 kg
- 2 lemons
- 1 whole bulb of garlic
- 1 kg russet potatoes, cut into chunks
- 3 tablespoons olive oil
- A small bunch of flat-leaf parsley
- Salt and black pepper

## Method

1. Heat the oven to 200 C (400 F). Take the chicken out of the fridge 30 minutes before cooking and pat it dry.
2. Spread the potatoes in a large roasting tin and toss with 2 tablespoons of the oil, salt and pepper.
3. Halve one lemon and the garlic bulb across the middle. Put them inside the chicken. Rub the skin with the remaining oil, salt and pepper, and sit the chicken on the potatoes.
4. Roast for 1 hour 20 minutes to 1 hour 30 minutes. The chicken is done when the juices run clear when the thickest part of the thigh is pierced, and a thermometer reads 75 C (165 F).
5. Rest the chicken for 15 minutes. Chop the parsley, squeeze over the juice of the second lemon and scatter over the potatoes before serving.
""",
    },
    {
        "kind": "RECIPE",
        "slug": "vegetable-fried-rice",
        "title": "Weeknight vegetable fried rice",
        "summary": "Cold cooked rice stir-fried with egg, peas, carrot and soy sauce.",
        "servings": 4,
        "total_minutes": 25,
        "published_ago": 14,
        "products": [
            "Long-Grain White Rice",
            "Large White Eggs",
            "Garden Peas",
            "Carrots",
            "Yellow Onions",
            "Garlic",
            "Soy Sauce",
            "Sunflower Oil",
        ],
        "body": """## Ingredients

- 300 g long-grain white rice, cooked and cooled (about 800 to 900 g cooked)
- 3 eggs, beaten
- 150 g frozen peas
- 2 carrots, finely diced
- 1 onion, finely chopped
- 2 cloves garlic, chopped
- 3 tablespoons soy sauce
- 2 tablespoons sunflower oil

## Method

1. Cook the rice in advance and spread it on a tray to cool. Cold rice stir-fries better than hot rice.
2. Heat 1 tablespoon of oil in a large pan or wok over high heat. Scramble the eggs for about 30 seconds, then tip them onto a plate.
3. Add the remaining oil and fry the onion and carrot for 4 minutes. Add the garlic and peas and cook for 2 minutes.
4. Add the rice, breaking up any lumps, and fry for 3 to 4 minutes until hot through.
5. Stir in the soy sauce and the eggs, and serve straight away. Soy sauce contains soy and wheat.
""",
    },
    {
        "kind": "RECIPE",
        "slug": "overnight-oats-blueberries",
        "title": "Overnight oats with blueberries",
        "summary": "Rolled oats soaked in milk and yogurt overnight, topped with blueberries and honey.",
        "servings": 2,
        "total_minutes": 10,
        "published_ago": 20,
        "products": ["Rolled Oats", "Whole Milk", "Plain Whole-Milk Yogurt", "Blueberries", "Clear Honey"],
        "body": """Allow 10 minutes to prepare and at least 6 hours in the fridge.

## Ingredients

- 100 g rolled oats
- 200 ml whole milk
- 120 g plain yogurt
- 1 tablespoon honey, plus extra to serve
- 150 g blueberries

## Method

1. Stir the oats, milk, yogurt and honey together in a bowl or two jars.
2. Cover and chill for at least 6 hours or overnight.
3. In the morning, loosen with a splash of milk if the mixture is too thick.
4. Top with the blueberries and a little more honey.
""",
    },
    {
        "kind": "RECIPE",
        "slug": "red-lentil-dal",
        "title": "Red lentil dal with rice",
        "summary": "Red lentils simmered with onion, garlic, cumin and tomatoes, served over basmati rice.",
        "servings": 4,
        "total_minutes": 40,
        "published_ago": 27,
        "products": [
            "Red Lentils",
            "Yellow Onions",
            "Garlic",
            "Ground Cumin",
            "Diced Tomatoes",
            "Basmati Rice",
            "Cilantro",
            "Sunflower Oil",
            "Lemons",
        ],
        "body": """## Ingredients

- 250 g red lentils, rinsed
- 1 onion, chopped
- 3 cloves garlic, chopped
- 2 teaspoons ground cumin
- 400 g tin diced tomatoes
- 750 ml water
- 2 tablespoons sunflower oil
- 250 g basmati rice
- Cilantro and a lemon to serve
- Salt

## Method

1. Heat the oil in a saucepan over medium heat. Fry the onion for 8 minutes until soft, then add the garlic and cumin and cook for 1 minute.
2. Add the lentils, tomatoes and water. Bring to the boil, then simmer for 20 to 25 minutes, stirring now and then, until the lentils have broken down. Add a little water if it gets too thick.
3. Meanwhile, rinse the rice and cook it according to the pack instructions.
4. Season the dal with salt and a squeeze of lemon. Serve over the rice with chopped cilantro.
""",
    },
    {
        "kind": "RECIPE",
        "slug": "baked-salmon-kale-potatoes",
        "title": "Baked salmon with kale and roasted potatoes",
        "summary": "Salmon fillets baked with lemon alongside garlicky kale and crisp roast potatoes.",
        "servings": 2,
        "total_minutes": 45,
        "published_ago": 33,
        "products": ["Salmon Fillets", "Curly Kale", "Russet Potatoes", "Lemons", "Olive Oil", "Garlic"],
        "body": """## Ingredients

- 2 salmon fillets, about 150 g each
- 500 g russet potatoes, cut into chunks
- 1 bunch curly kale, stems removed, leaves torn
- 2 cloves garlic, sliced
- 3 tablespoons olive oil
- 1 lemon
- Salt and black pepper

## Method

1. Heat the oven to 220 C (425 F). Toss the potatoes with 2 tablespoons of the oil, salt and pepper and roast for 20 minutes.
2. Add the salmon to the tin, skin-side down, season, and lay a few lemon slices on top. Roast for 12 to 15 minutes, until the fish flakes easily.
3. While the salmon cooks, warm the remaining oil in a pan and fry the garlic for 30 seconds. Add the kale with a splash of water and cook for 4 to 5 minutes until tender.
4. Serve the salmon with the potatoes and kale, with the rest of the lemon squeezed over.
""",
    },
    {
        "kind": "GUIDE",
        "slug": "choosing-ripe-avocados",
        "title": "How to choose avocados",
        "summary": "Ripeness is easier to judge by feel than by colour. A few practical checks, and what to do with firm fruit.",
        "servings": None,
        "total_minutes": None,
        "published_ago": 5,
        "products": ["Avocados", "Lemons"],
        "body": """Avocados are sold at different stages of ripeness, so it helps to know what you are looking for.

## Check by feel

- Cup the avocado in your palm and press **gently** with your whole hand. A ripe fruit usually yields slightly; a firm one will not give at all, and a very soft one may be past its best.
- Avoid pressing with your fingertips, which bruises the flesh.

## Colour is only a hint

Some varieties darken as they ripen and others stay green, so colour alone does not tell you much. Use it together with feel.

## Check near the stem

Flicking off the small stem cap and looking underneath can show the flesh colour. Green suggests it is usable; brown suggests it may be overripe. Replace the cap if you are not buying it.

## If it is firm

Leave it at room temperature for a few days. Once it yields to gentle pressure, you can keep it in the fridge for a short time to slow things down.

## Once cut

Brush the cut surface with lemon juice and wrap it tightly to slow browning.
""",
    },
    {
        "kind": "GUIDE",
        "slug": "storing-fresh-herbs",
        "title": "Storing fresh herbs",
        "summary": "Soft herbs last longer when treated like cut flowers or wrapped in damp paper. Here is how, herb by herb.",
        "servings": None,
        "total_minutes": None,
        "published_ago": 12,
        "products": ["Basil", "Flat-Leaf Parsley", "Cilantro"],
        "body": """Herbs vary, but these habits tend to help.

## Parsley and cilantro

Trim the stems and stand the bunch in a jar with a little water, like flowers. Loosely cover the leaves with a bag and keep the jar in the fridge. Change the water if it clouds.

## Basil

Basil dislikes the cold and can blacken in the fridge. Trim the stems, stand the bunch in water on the counter, away from direct sun, and use it within a few days.

## General tips

- Wash herbs just before using them, not before storing.
- Dry them well; wet leaves spoil faster.
- Check the date on the pack and use herbs soon after buying.
- To keep surplus parsley or cilantro, chop it and freeze it in oil in an ice-cube tray.
""",
    },
    {
        "kind": "GUIDE",
        "slug": "reading-unit-prices",
        "title": "Reading unit prices",
        "summary": "Unit prices show the cost per kilogram or litre, so you can compare pack sizes fairly.",
        "servings": None,
        "total_minutes": None,
        "published_ago": 18,
        "products": ["Spaghetti", "Penne Rigate", "Olive Oil", "Sunflower Oil"],
        "body": """A bigger pack is not always cheaper per gram. The unit price on each product page lets you compare.

## What it shows

The unit price is the price for one kilogram (for weight) or one litre (for volume), worked out from the pack's price and its net content.

## Worked examples

- A 500 g box of spaghetti at $1.99 costs **$3.98 per kg** ($1.99 divided by 0.5 kg).
- A 500 mL bottle of olive oil at $9.99 costs **$19.98 per litre**.
- A 1 L bottle of sunflower oil at $4.49 costs **$4.49 per litre**. Compared with the olive oil, it is a lower price per litre, but they are different products with different uses.

## Things to bear in mind

- Compare like with like: unit prices make sense for the same kind of product.
- Promotions change the price you pay; the unit price shown during an offer uses the offer price.
- Items with no net content, such as a single avocado, have no unit price because there is nothing to compare.
""",
    },
    {
        "kind": "GUIDE",
        "slug": "how-weighed-items-are-priced",
        "title": "How weighed items are priced",
        "summary": "Why a kilo of apples can cost slightly more or less than the estimate, and how the final price is capped.",
        "servings": None,
        "total_minutes": None,
        "published_ago": 24,
        "products": ["Gala Apples", "Bananas", "Chicken Breast Fillets", "Cheddar"],
        "body": """Loose produce, meat, fish and deli items are sold by weight, but every apple or fillet is a different size. This is how we handle that.

## At checkout

You choose an expected weight, for example 1 kg of apples at $3.99 per kg, and see an estimated price of $3.99. When you pay, we authorise a little more than the estimate (10% extra, shown in the store settings) to cover weight variation.

## At picking

Our picker weighs what goes in your order and records the actual weight.

## The final price

The final price is the actual weight multiplied by the price per kilogram, **capped at the amount authorised**. For example:

- Picked weight 1.08 kg: 1.08 x $3.99 = **$4.31**. The authorised amount was up to $4.39, so this goes through.
- Picked weight 0.96 kg: 0.96 x $3.99 = **$3.83**, which is less than the estimate, so you pay less.

If an item would come out above the authorised amount or outside the allowed weight range, the picker cannot finish it without checking: we re-pick it or ask you to approve it.

## Where you can see it

Your order shows the ordered quantity, the picked weight, the unit price and both the estimated and final line totals.
""",
    },
]

# --------------------------------------------------------------------------- banners
# placement, title, subtitle, cta label, cta link, art key (None = no image), sort
BANNERS = [
    ("HERO", "Cooking weather: apples, roots and hearty greens", "Browse the seasonal produce collection, priced per kilo or per piece.", "Shop seasonal produce", "/collections/seasonal-produce", "hero-seasonal-produce", 10),
    ("HERO", "Weeknight dinners, sorted", "Pasta, sauces, vegetables and proteins gathered in one collection.", "See the collection", "/collections/weeknight-dinners", "hero-weeknight-dinners", 20),
    ("HERO", "Bread, rolls and pastries from Hollow Oak Bakehouse", "Some items are made to order; check each product page for the lead time. Hollow Oak is a fictional demo brand.", "Shop bakery", "/shop?category=bakery", "hero-bakery", 30),
    ("STRIP", "Demonstration store: products, prices, reviews and illustrations are sample data.", "", "Read the FAQ", "/faq", None, 10),
    ("PROMO", "Berries 15% off", "Strawberries, blueberries and raspberries. The discount is applied automatically while the offer runs.", "Shop berries", "/shop?category=berries", "promo-berries", 10),
    ("PROMO", "Pasta: 3 for $5", "Buy three boxes of the same pasta for $5 in total. Applied automatically at checkout.", "See all offers", "/offers", "promo-pasta", 20),
]  # fmt: skip

ALLOWED_BANNER_LINKS = (
    r"^/(shop|offers|new|stores|faq)$",
    r"^/shop\?category=[a-z0-9-]+$",
    r"^/collections/[a-z0-9-]+$",
    r"^/guides/[a-z0-9-]+$",
    r"^/p/[a-z0-9-]+$",
)
