from django.apps import AppConfig


class PromotionsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.promotions"
    label = "promotions"

    def ready(self):
        from django.db.models.signals import m2m_changed, post_delete, post_save

        from apps.core import cache as core_cache

        from .models import Promotion

        def bump(**_):
            core_cache.bump("promos")
            core_cache.bump("home")

        post_save.connect(bump, sender=Promotion, weak=False)
        post_delete.connect(bump, sender=Promotion, weak=False)
        for rel in (Promotion.products, Promotion.categories, Promotion.brands):
            m2m_changed.connect(bump, sender=rel.through, weak=False)
