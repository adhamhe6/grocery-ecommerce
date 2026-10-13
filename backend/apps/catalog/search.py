"""PostgreSQL search: weighted full-text (prefix-aware) + trigram typo tolerance. No external search engine."""

from __future__ import annotations

import re

from django.contrib.postgres.search import SearchQuery, SearchRank, SearchVector, TrigramSimilarity
from django.db.models import F, Q, Value
from django.db.models.functions import Upper

TOKEN = re.compile(r"[^\W_]+", re.UNICODE)
MAX_QUERY_LEN = 80
SEARCH_CONFIG = "english"


def normalize_query(raw: str) -> str:
    return " ".join(TOKEN.findall((raw or "")[:MAX_QUERY_LEN]))


def prefix_tsquery(q: str) -> SearchQuery | None:
    tokens = TOKEN.findall(q.lower())[:8]
    if not tokens:
        return None
    # Tokens are restricted to word characters above, so the raw tsquery cannot be malformed or injected.
    return SearchQuery(" & ".join(f"{t}:*" for t in tokens), config=SEARCH_CONFIG, search_type="raw")


def apply_search(qs, raw_query: str):
    """Filter + annotate `rank`. Returns (queryset, applied)."""
    q = normalize_query(raw_query)
    if not q:
        return qs, False
    tsq = prefix_tsquery(q)
    upper_q = q.upper()
    qs = qs.annotate(name_u=Upper("name"))
    cond = Q(name_u__trigram_similar=upper_q) | Q(sku__iexact=q) | Q(barcode=q)
    if tsq is not None:
        cond |= Q(search_vector=tsq)
    qs = qs.filter(cond).annotate(
        rank=(
            SearchRank(F("search_vector"), tsq if tsq is not None else SearchQuery(q, config=SEARCH_CONFIG))
            + TrigramSimilarity("name_u", upper_q) * Value(0.6)
        )
    )
    return qs, True


def refresh_search_text(product) -> str:
    cat = product.category
    parts = [
        product.brand.name if product.brand_id else "",
        cat.name if cat else "",
        cat.parent.name if cat and cat.parent_id else "",
        product.sku,
        product.origin_country,
    ]
    return " ".join(p for p in parts if p)


def rebuild_index(queryset=None) -> int:
    """Recompute `search_text` + `search_vector` for the given products (default: all). Bulk and idempotent."""
    from .models import Product

    qs = (queryset if queryset is not None else Product.objects.all()).select_related("brand", "category__parent")
    updates = []
    for product in qs.iterator(chunk_size=500):
        text = refresh_search_text(product)
        if text != product.search_text:
            product.search_text = text
            updates.append(product)
    if updates:
        Product.objects.bulk_update(updates, ["search_text"], batch_size=500)
    target = Product.objects.filter(pk__in=qs.values("pk"))
    target.update(
        search_vector=SearchVector("name", weight="A", config=SEARCH_CONFIG)
        + SearchVector("search_text", weight="B", config=SEARCH_CONFIG)
        + SearchVector("short_description", weight="C", config=SEARCH_CONFIG)
        + SearchVector("description", weight="D", config=SEARCH_CONFIG)
    )
    return target.count()
