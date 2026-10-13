"""Seed the Orchard Row demonstration store: curated catalogue, branches, stock scenarios, promotions and content.

    python manage.py seed_demo                      # idempotent; safe to re-run
    python manage.py seed_demo --reset-demo         # delete only demo rows, then re-seed
    python manage.py seed_demo --reset-demo --no-seed
    python manage.py seed_demo --skip-images        # fast (no image processing)

DEVELOPMENT AND DEMONSTRATION ONLY. It creates accounts with a shared, documented password. It refuses to run when
DEBUG is off unless --force is given, and nothing it creates may ever exist in a production database.
"""

from __future__ import annotations

import os

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.core.seed import runner
from apps.core.seed.accounts_data import DEFAULT_PASSWORD
from apps.core.seed.load_catalog import SeedError


class Command(BaseCommand):
    help = "Seed curated, clearly labelled demo data (idempotent, relative dates, never touches real data)."

    def add_arguments(self, parser):
        parser.add_argument("--reset-demo", action="store_true", help="delete ONLY demo rows first, then seed again")
        parser.add_argument("--no-seed", action="store_true", help="with --reset-demo: delete demo rows and stop")
        parser.add_argument("--skip-images", action="store_true", help="do not attach illustrations (much faster)")
        parser.add_argument("--refresh-images", action="store_true", help="replace existing demo illustrations")
        parser.add_argument(
            "--password",
            help="shared password for demo accounts (default: $DEMO_PASSWORD, else the documented dev default)",
        )
        parser.add_argument(
            "--force", action="store_true", help="required when DEBUG is off; never use against production data"
        )

    def handle(self, *args, **options):
        if not settings.DEBUG and not options["force"]:
            raise CommandError(
                "Refusing to seed demo data because DEBUG is off. This command creates accounts with a shared demo "
                "password and sample data that must never exist in production. If this is a throwaway demo or CI "
                "database, re-run with --force."
            )
        if options["no_seed"] and not options["reset_demo"]:
            raise CommandError("--no-seed only makes sense together with --reset-demo.")
        password = options["password"] or os.environ.get("DEMO_PASSWORD") or DEFAULT_PASSWORD
        if not settings.DEBUG:
            self.stderr.write(
                self.style.WARNING("DEBUG is off and --force was given: seeding DEMO data and DEMO accounts.")
            )
        try:
            tally = runner.run(
                self.stdout,
                password=password,
                skip_images=options["skip_images"],
                refresh_images=options["refresh_images"],
                reset=options["reset_demo"],
                no_seed=options["no_seed"],
            )
        except SeedError as exc:
            raise CommandError(str(exc)) from exc
        if options["no_seed"]:
            self.stdout.write(self.style.SUCCESS("Demo rows removed."))
            return
        self._print_summary(tally, password, uses_default=password == DEFAULT_PASSWORD)

    def _print_summary(self, tally, password, uses_default):
        rows = runner.summary_rows(tally)
        width = max(len(label) for label, *_ in rows)
        self.stdout.write("")
        self.stdout.write(f"{'Entity'.ljust(width)}  {'in database':>11}  {'created now':>11}")
        self.stdout.write("-" * (width + 26))
        for label, total, created in rows:
            self.stdout.write(f"{label.ljust(width)}  {total:>11}  {created:>11}")
        for message in tally.warnings:
            self.stdout.write(self.style.WARNING(f"warning: {message}"))
        self.stdout.write(self.style.SUCCESS("\nDemo data is ready."))
        self.stdout.write(
            "Demo accounts: <role>@demo.orchardrow.test (see docs/seed-data.md). "
            + (
                "Password is the documented dev default."
                if uses_default
                else "Password was set from --password / $DEMO_PASSWORD."
            )
        )
        _ = password
