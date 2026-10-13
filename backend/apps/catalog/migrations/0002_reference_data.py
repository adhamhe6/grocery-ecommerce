from decimal import Decimal

from django.db import migrations

UNITS = [
    # code, name, symbol, kind, to_base, allows_fraction
    ("each", "Each", "each", "COUNT", "1", False),
    ("pack", "Pack", "pack", "COUNT", "1", False),
    ("box", "Box", "box", "COUNT", "1", False),
    ("bundle", "Bundle", "bundle", "COUNT", "1", False),
    ("dozen", "Dozen", "doz", "COUNT", "12", False),
    ("kg", "Kilogram", "kg", "WEIGHT", "1", True),
    ("g", "Gram", "g", "WEIGHT", "0.001", False),
    ("100g", "100 grams", "100 g", "WEIGHT", "0.1", False),
    ("l", "Litre", "L", "VOLUME", "1", True),
    ("ml", "Millilitre", "mL", "VOLUME", "0.001", False),
]

# EU-14 style list is the default reference; jurisdictions differ, so admins can edit this table.
ALLERGENS = [
    ("gluten", "Cereals containing gluten"), ("crustaceans", "Crustaceans"), ("eggs", "Eggs"), ("fish", "Fish"),
    ("peanuts", "Peanuts"), ("soybeans", "Soybeans"), ("milk", "Milk"), ("tree-nuts", "Tree nuts"),
    ("celery", "Celery"), ("mustard", "Mustard"), ("sesame", "Sesame"), ("sulphites", "Sulphur dioxide / sulphites"),
    ("lupin", "Lupin"), ("molluscs", "Molluscs"),
]


def forwards(apps, schema_editor):
    SaleUnit = apps.get_model("catalog", "SaleUnit")
    Allergen = apps.get_model("catalog", "Allergen")
    for code, name, symbol, kind, to_base, frac in UNITS:
        SaleUnit.objects.update_or_create(
            code=code, defaults={"name": name, "symbol": symbol, "kind": kind, "to_base": Decimal(to_base), "allows_fraction": frac})
    for code, name in ALLERGENS:
        Allergen.objects.update_or_create(code=code, defaults={"name": name})


class Migration(migrations.Migration):
    dependencies = [("catalog", "0001_initial")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
