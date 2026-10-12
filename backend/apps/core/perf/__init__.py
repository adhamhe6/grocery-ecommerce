"""Performance-measurement tooling: a deterministic synthetic-data generator for load and query-plan testing.

Nothing in this package is imported by the running application. It is used by `manage.py seed_perf` only, and every
row it creates can be recognised (and removed) by a naming pattern: SKUs `PERF-…`, e-mails `…@perf.invalid`,
brand slugs `perf-…`, promotions named `PERF …`, stock movements with `ref_type = "PERF_SEED"`.
"""
