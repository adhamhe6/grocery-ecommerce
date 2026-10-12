from __future__ import annotations

from decimal import Decimal

from django.contrib.postgres.fields import ArrayField
from django.contrib.postgres.indexes import GinIndex, OpClass
from django.contrib.postgres.search import SearchVectorField
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import F, Q
from django.db.models.functions import Upper
from django.utils import timezone
from django.utils.text import slugify

from apps.core.models import TimeStampedModel

from . import images


class Category(TimeStampedModel):
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="children")
    name = models.CharField(max_length=80)
    slug = models.SlugField(max_length=90, unique=True)
    description = models.CharField(max_length=300, blank=True)
    image = models.ImageField(upload_to="categories/", blank=True, null=True)
    image_widths = ArrayField(models.PositiveIntegerField(), default=list, blank=True, editable=False)
    sort_order = models.PositiveIntegerField(default=100)
    is_active = models.BooleanField(default=True)
    show_on_home = models.BooleanField(default=False)

    class Meta:
        ordering = ["sort_order", "name"]
        verbose_name_plural = "categories"
        constraints = [models.CheckConstraint(condition=~Q(parent=F("id")), name="category_not_own_parent")]

    def __str__(self):
        return self.name

    def clean(self):
        if self.parent_id and self.parent and self.parent.parent_id:
            raise ValidationError("Categories support two levels: department → category.")

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)

    def image_urls(self) -> dict:
        return images.variant_urls(self.image, self.image_widths)


class Brand(TimeStampedModel):
    name = models.CharField(max_length=80, unique=True)
    slug = models.SlugField(max_length=90, unique=True)
    description = models.CharField(max_length=300, blank=True)
    is_active = models.BooleanField(default=True)
    is_demo = models.BooleanField(default=False)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)


class MeasureKind(models.TextChoices):
    COUNT = "COUNT", "Count"
    WEIGHT = "WEIGHT", "Weight"
    VOLUME = "VOLUME", "Volume"


class SaleUnit(models.Model):
    """How a product is sold / measured. `to_base` converts to kg (weight), L (volume) or 1 (count)."""

    code = models.SlugField(max_length=20, unique=True)
    name = models.CharField(max_length=40)
    symbol = models.CharField(max_length=12)
    kind = models.CharField(max_length=10, choices=MeasureKind.choices)
    to_base = models.DecimalField(max_digits=12, decimal_places=6, default=Decimal("1"))
    allows_fraction = models.BooleanField(default=False)

    class Meta:
        ordering = ["kind", "to_base"]
        constraints = [models.CheckConstraint(condition=Q(to_base__gt=0), name="unit_factor_positive")]

    def __str__(self):
        return self.symbol

    @property
    def is_weight(self) -> bool:
        return self.kind == MeasureKind.WEIGHT


class ProductType(models.TextChoices):
    LOOSE_PRODUCE = "LOOSE_PRODUCE", "Loose produce"
    PACKAGED = "PACKAGED", "Packaged goods"
    CHILLED = "CHILLED", "Chilled"
    FROZEN = "FROZEN", "Frozen"
    BAKERY = "BAKERY", "Bakery"
    HOUSEHOLD = "HOUSEHOLD", "Household"
    PREPARED = "PREPARED", "Made to order"


class StorageType(models.TextChoices):
    AMBIENT = "AMBIENT", "Ambient"
    CHILLED = "CHILLED", "Chilled"
    FROZEN = "FROZEN", "Frozen"


class StockMode(models.TextChoices):
    TRACKED = "TRACKED", "Tracked stock"
    MADE_TO_ORDER = "MADE_TO_ORDER", "Made to order (no stock count)"


class ProductStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    INACTIVE = "INACTIVE", "Inactive"
    ARCHIVED = "ARCHIVED", "Archived"


class Product(TimeStampedModel):
    sku = models.CharField(max_length=32, unique=True)
    slug = models.SlugField(max_length=140, unique=True)
    name = models.CharField(max_length=140)
    short_description = models.CharField(max_length=220, blank=True)
    description = models.TextField(blank=True)

    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="products")
    brand = models.ForeignKey(Brand, null=True, blank=True, on_delete=models.PROTECT, related_name="products")
    barcode = models.CharField(max_length=14, null=True, blank=True)

    product_type = models.CharField(max_length=20, choices=ProductType.choices, default=ProductType.PACKAGED)
    storage_type = models.CharField(max_length=10, choices=StorageType.choices, default=StorageType.AMBIENT)

    sale_unit = models.ForeignKey(SaleUnit, on_delete=models.PROTECT, related_name="products")
    price = models.DecimalField(max_digits=10, decimal_places=2, help_text="Price per ONE sale unit")
    tax_rate = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("0"), validators=[MinValueValidator(0), MaxValueValidator(100)]
    )

    qty_min = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal("1"))
    qty_step = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal("1"))
    qty_max = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True)

    net_content = models.DecimalField(
        max_digits=10,
        decimal_places=3,
        null=True,
        blank=True,
        help_text="Content of ONE sale unit, e.g. 500 (with unit g) for a pasta pack",
    )
    net_content_unit = models.ForeignKey(SaleUnit, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    is_variable_weight = models.BooleanField(default=False)

    stock_mode = models.CharField(max_length=16, choices=StockMode.choices, default=StockMode.TRACKED)
    tracks_batches = models.BooleanField(default=False, help_text="Requires lot/expiry capture (perishables)")
    is_perishable = models.BooleanField(default=False)
    sell_buffer_days = models.PositiveSmallIntegerField(
        default=1, help_text="Stop selling a batch this many days before its expiry date"
    )

    status = models.CharField(max_length=10, choices=ProductStatus.choices, default=ProductStatus.ACTIVE, db_index=True)
    is_available = models.BooleanField(default=True, help_text="Manual switch to hide a product temporarily")
    is_featured = models.BooleanField(default=False)

    origin_country = models.CharField(max_length=60, blank=True)
    origin_note = models.CharField(max_length=200, blank=True)
    storage_instructions = models.CharField(max_length=300, blank=True)
    ingredients = models.TextField(blank=True)
    packaging = models.CharField(max_length=160, blank=True)
    manufacturer = models.CharField(max_length=160, blank=True)
    allergen_info_complete = models.BooleanField(
        default=False, help_text="True only when allergen data was confirmed against the label/supplier"
    )

    popularity = models.PositiveIntegerField(default=0, help_text="Units sold in the last 30 days (measured)")
    rating_avg = models.DecimalField(max_digits=3, decimal_places=2, null=True, blank=True, editable=False)
    rating_count = models.PositiveIntegerField(default=0, editable=False)
    search_text = models.TextField(blank=True, editable=False)
    search_vector = SearchVectorField(null=True, editable=False)
    is_demo = models.BooleanField(default=False)

    class Meta:
        ordering = ["name"]
        indexes = [
            GinIndex(fields=["search_vector"], name="product_search_vector_gin"),
            GinIndex(OpClass(Upper("name"), name="gin_trgm_ops"), name="product_name_trgm"),
            models.Index(fields=["status", "category"], name="product_status_category"),
            models.Index(fields=["status", "-created_at"], name="product_status_new"),
            models.Index(fields=["status", "-popularity"], name="product_status_popular"),
        ]
        constraints = [
            models.CheckConstraint(condition=Q(price__gte=0), name="product_price_nonneg"),
            models.CheckConstraint(condition=Q(qty_min__gt=0), name="product_qty_min_pos"),
            models.CheckConstraint(condition=Q(qty_step__gt=0), name="product_qty_step_pos"),
            models.CheckConstraint(
                condition=Q(qty_max__isnull=True) | Q(qty_max__gte=F("qty_min")), name="product_qty_max_ge_min"
            ),
            models.CheckConstraint(
                condition=Q(net_content__isnull=True) | Q(net_content__gt=0), name="product_net_content_pos"
            ),
            models.UniqueConstraint(
                fields=["barcode"], condition=Q(barcode__isnull=False), name="uniq_product_barcode"
            ),
        ]

    def __str__(self):
        return self.name

    def clean(self):
        errors = {}
        if self.is_variable_weight and self.sale_unit_id and not self.sale_unit.is_weight:
            errors["is_variable_weight"] = "Variable-weight products must be sold by a weight unit."
        if self.tracks_batches and self.stock_mode != StockMode.TRACKED:
            errors["tracks_batches"] = "Batch tracking requires tracked stock."
        if (self.net_content is None) != (self.net_content_unit_id is None):
            errors["net_content"] = "Set both net content and its unit, or neither."
        if self.net_content_unit_id and self.sale_unit_id and self.net_content_unit.kind == "COUNT":
            errors["net_content_unit"] = "Net content must be a weight or volume unit."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)

    # ------------------------------------------------------------------ derived values
    @property
    def unit_price(self) -> dict | None:
        """Price per base measure (kg / L) for comparison, or None when it can't be computed reliably."""
        from .pricing_info import unit_price_for

        return unit_price_for(self)

    @property
    def is_purchasable(self) -> bool:
        return self.status == ProductStatus.ACTIVE and self.is_available


class ProductImage(TimeStampedModel):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="images")
    image = models.ImageField(upload_to=images.product_upload_path, max_length=200)
    image_widths = ArrayField(models.PositiveIntegerField(), default=list, blank=True, editable=False)
    alt_text = models.CharField(max_length=200)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]

    def __str__(self):
        return f"{self.product.sku} #{self.pk}"

    def urls(self) -> dict:
        return images.variant_urls(self.image, self.image_widths)


class Allergen(models.Model):
    code = models.SlugField(max_length=30, unique=True)
    name = models.CharField(max_length=60)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class AllergenLevel(models.TextChoices):
    CONTAINS = "CONTAINS", "Contains"
    MAY_CONTAIN = "MAY_CONTAIN", "May contain"


class ProductAllergen(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="allergens")
    allergen = models.ForeignKey(Allergen, on_delete=models.PROTECT, related_name="+")
    level = models.CharField(max_length=12, choices=AllergenLevel.choices, default=AllergenLevel.CONTAINS)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["product", "allergen"], name="uniq_product_allergen")]


class ClaimKind(models.TextChoices):
    VEGAN = "VEGAN", "Vegan"
    VEGETARIAN = "VEGETARIAN", "Vegetarian"
    GLUTEN_FREE = "GLUTEN_FREE", "Gluten-free"
    LACTOSE_FREE = "LACTOSE_FREE", "Lactose-free"
    SUGAR_FREE = "SUGAR_FREE", "Sugar-free"
    HALAL = "HALAL", "Halal"
    KOSHER = "KOSHER", "Kosher"
    ORGANIC = "ORGANIC", "Organic"
    FAIRTRADE = "FAIRTRADE", "Fairtrade"
    LOCALLY_GROWN = "LOCALLY_GROWN", "Locally grown"


class ProductClaim(models.Model):
    """A dietary/quality claim. Only `verified=True` claims are ever shown or used for filtering."""

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="claims")
    kind = models.CharField(max_length=20, choices=ClaimKind.choices)
    verified = models.BooleanField(default=False)
    evidence = models.CharField(
        max_length=300, blank=True, help_text="Certificate number, label review, supplier statement…"
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["product", "kind"], name="uniq_product_claim")]
        indexes = [models.Index(fields=["kind", "verified"])]


class NutritionFact(models.Model):
    product = models.OneToOneField(Product, on_delete=models.CASCADE, related_name="nutrition")
    basis = models.CharField(max_length=30, default="per 100 g")
    energy_kcal = models.DecimalField(max_digits=7, decimal_places=1, null=True, blank=True)
    energy_kj = models.DecimalField(max_digits=7, decimal_places=1, null=True, blank=True)
    fat = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    saturates = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    carbohydrate = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    sugars = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    fibre = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    protein = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    salt = models.DecimalField(max_digits=6, decimal_places=3, null=True, blank=True)
    source = models.CharField(max_length=200, blank=True)
    is_demo = models.BooleanField(default=False)


class ReviewStatus(models.TextChoices):
    PENDING = "PENDING", "Pending moderation"
    APPROVED = "APPROVED", "Approved"
    REJECTED = "REJECTED", "Rejected"


class Review(TimeStampedModel):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="reviews")
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="reviews")
    rating = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(5)])
    title = models.CharField(max_length=100, blank=True)
    body = models.TextField(max_length=2000, blank=True)
    status = models.CharField(max_length=10, choices=ReviewStatus.choices, default=ReviewStatus.PENDING, db_index=True)
    verified_purchase = models.BooleanField(default=False)
    is_demo = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["product", "user"], name="uniq_review_per_user_product"),
            models.CheckConstraint(condition=Q(rating__gte=1) & Q(rating__lte=5), name="review_rating_1_5"),
        ]


class Collection(TimeStampedModel):
    name = models.CharField(max_length=80)
    slug = models.SlugField(max_length=90, unique=True)
    description = models.CharField(max_length=300, blank=True)
    products = models.ManyToManyField(Product, through="CollectionItem", related_name="collections")
    is_active = models.BooleanField(default=True)
    show_on_home = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=100)
    starts_on = models.DateField(null=True, blank=True)
    ends_on = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["sort_order", "name"]

    def __str__(self):
        return self.name

    def is_current(self, today=None) -> bool:
        today = today or timezone.localdate()
        return (
            self.is_active
            and (not self.starts_on or self.starts_on <= today)
            and (not self.ends_on or today <= self.ends_on)
        )


class CollectionItem(models.Model):
    collection = models.ForeignKey(Collection, on_delete=models.CASCADE)
    product = models.ForeignKey(Product, on_delete=models.CASCADE)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [models.UniqueConstraint(fields=["collection", "product"], name="uniq_collection_product")]
