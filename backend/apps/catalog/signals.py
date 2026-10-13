from django.db.models.signals import m2m_changed, post_delete, post_save
from django.dispatch import receiver

from apps.core import cache as core_cache

from . import search
from .models import Brand, Category, Collection, CollectionItem, Product, Review


def bump_catalog_caches(**_):
    core_cache.bump("catalog")
    core_cache.bump("home")


@receiver(post_save, sender=Product)
def product_saved(sender, instance, raw=False, **kwargs):
    if raw:
        return
    search.rebuild_index(Product.objects.filter(pk=instance.pk))
    bump_catalog_caches()


@receiver(post_delete, sender=Product)
def product_deleted(**kwargs):
    bump_catalog_caches()


@receiver(post_save, sender=Brand)
def brand_saved(sender, instance, raw=False, **kwargs):
    if raw:
        return
    search.rebuild_index(Product.objects.filter(brand=instance))
    bump_catalog_caches()


@receiver(post_save, sender=Category)
def category_saved(sender, instance, raw=False, **kwargs):
    if raw:
        return
    from django.db.models import Q

    search.rebuild_index(Product.objects.filter(Q(category=instance) | Q(category__parent=instance)))
    bump_catalog_caches()


for _model in (Collection, CollectionItem):
    post_save.connect(bump_catalog_caches, sender=_model)
    post_delete.connect(bump_catalog_caches, sender=_model)
m2m_changed.connect(bump_catalog_caches, sender=Collection.products.through)


@receiver([post_save, post_delete], sender=Review)
def review_changed(sender, instance, **kwargs):
    from django.db.models import Avg, Count

    from .models import ReviewStatus

    agg = Review.objects.filter(product_id=instance.product_id, status=ReviewStatus.APPROVED).aggregate(
        a=Avg("rating"), n=Count("id")
    )
    Product.objects.filter(pk=instance.product_id).update(
        rating_avg=round(agg["a"], 2) if agg["a"] is not None else None, rating_count=agg["n"] or 0
    )
    core_cache.bump("home")
