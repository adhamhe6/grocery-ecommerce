"""Generate a large, deterministic, clearly synthetic data set for performance testing.

    createdb grocery_perf && DATABASE_URL=postgres://…/grocery_perf python manage.py migrate
    DATABASE_URL=…/grocery_perf python manage.py seed_demo --skip-images        # branches, categories, brands, units, zones
    DATABASE_URL=…/grocery_perf python manage.py seed_perf --confirm-synthetic  # defaults: 20k products, 5k customers, 60k orders
    DATABASE_URL=…/grocery_perf python manage.py seed_perf --confirm-synthetic --reset-perf   # delete only what it made, regenerate

SAFETY: refuses to run without --confirm-synthetic, and refuses unless the database NAME contains "perf", so it can never
pollute a real or demo database. Everything it creates is recognisable by pattern (SKU `PERF-…`, e-mail `…@perf.invalid`,
brand slug `perf-…`, promotion name `PERF …`, stock movement ref_type `PERF_SEED`) and `--reset-perf` deletes by those
patterns only. See docs/perf-tooling.md for what the data does and does not model.
"""

from __future__ import annotations

import datetime as dt

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.core.perf import seeder
from apps.core.perf.safety import UnsafeTarget, assert_safe_target


class Command(BaseCommand):
    help = "Generate deterministic synthetic volume (products, stock, customers, orders) in a database named *perf*."

    def add_arguments(self, parser):
        parser.add_argument("--confirm-synthetic", action="store_true", help="required: acknowledges throw-away data")
        parser.add_argument("--products", type=int, default=20000, help="catalogue size (default 20000)")
        parser.add_argument("--customers", type=int, default=5000, help="customer accounts (default 5000)")
        parser.add_argument(
            "--orders", type=int, default=60000, help="orders over the last --days days (default 60000)"
        )
        parser.add_argument("--days", type=int, default=90, help="order history window in days (default 90)")
        parser.add_argument("--seed", type=int, default=20260101, help="random seed; same seed + anchor = same data")
        parser.add_argument(
            "--anchor",
            help="ISO date/time treated as 'now' for every relative date (default: the current time); "
            "pass a fixed value to make two runs byte-identical",
        )
        parser.add_argument("--batch-size", type=int, default=2000, help="rows per bulk_create (default 2000)")
        parser.add_argument(
            "--image-path",
            default="",
            help="stored image path for every ProductImage row (default: reuse an existing image, else a placeholder)",
        )
        parser.add_argument("--skip-history", action="store_true", help="do not create order status history rows")
        parser.add_argument("--skip-movements", action="store_true", help="do not create the stock ledger")
        parser.add_argument(
            "--reset-perf", action="store_true", help="delete ONLY rows this command (or load.py) created, then reseed"
        )
        parser.add_argument("--no-seed", action="store_true", help="with --reset-perf: delete and stop")

    def handle(self, *args, **options):
        try:
            db_name = assert_safe_target(options["confirm_synthetic"])
        except UnsafeTarget as exc:
            raise CommandError(str(exc)) from exc
        if options["no_seed"] and not options["reset_perf"]:
            raise CommandError("--no-seed only makes sense together with --reset-perf.")
        log = self.stdout.write
        log(f"database: {db_name}")

        if options["reset_perf"]:
            deleted = seeder.reset_perf(log)
            log("deleted: " + (", ".join(f"{k} {v}" for k, v in deleted.items()) or "nothing"))
            if options["no_seed"]:
                self.stdout.write(self.style.SUCCESS("Perf rows removed."))
                return
        else:
            present = {k: v for k, v in seeder.existing_counts().items() if v}
            if present:
                self.stdout.write(
                    self.style.WARNING(
                        "Perf data is already present ("
                        + ", ".join(f"{v} {k}" for k, v in present.items())
                        + "). Nothing was created. Use --reset-perf to delete it and regenerate."
                    )
                )
                return

        anchor = None
        if options["anchor"]:
            try:
                anchor = dt.datetime.fromisoformat(options["anchor"])
            except ValueError as exc:
                raise CommandError(f"--anchor must be an ISO date or datetime, got {options['anchor']!r}") from exc
            if anchor.tzinfo is None:
                anchor = anchor.replace(tzinfo=dt.UTC)
        opts = seeder.SeedOptions(
            products=options["products"],
            customers=options["customers"],
            orders=options["orders"],
            seed=options["seed"],
            anchor=anchor or timezone.now(),
            days=options["days"],
            batch_size=max(100, options["batch_size"]),
            image_path=options["image_path"],
            history=not options["skip_history"],
            movements=not options["skip_movements"],
        )
        try:
            result = seeder.PerfSeeder(opts, log).run()
        except seeder.SeedProblem as exc:
            raise CommandError(str(exc)) from exc

        counts = result["counts"]
        width = max(len(k) for k in counts)
        self.stdout.write("")
        self.stdout.write(f"{'rows created'.ljust(width)}  {'count':>10}")
        self.stdout.write("-" * (width + 12))
        for label, n in counts.items():
            self.stdout.write(f"{label.ljust(width)}  {n:>10}")
        for note in result["notes"]:
            self.stdout.write(self.style.WARNING(f"note: {note}"))
        self.stdout.write(
            self.style.SUCCESS(
                f"\nDone in {result['elapsed']:.1f}s (seed {opts.seed}, anchor {opts.anchor:%Y-%m-%d %H:%M} UTC)."
            )
        )
