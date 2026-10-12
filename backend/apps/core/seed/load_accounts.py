"""Dev-only demo staff and customer accounts with addresses. Never run against a production database."""

from __future__ import annotations

from apps.accounts.models import Address, User
from apps.core import rbac
from apps.stores.models import Branch

from .accounts_data import CUSTOMERS, DEMO_DOMAIN, STAFF
from .common import Tally


def _ensure_password(user: User, password: str) -> None:
    if not user.check_password(password):
        user.set_password(password)
        user.save()


def seed_accounts(password: str, branches: dict[str, Branch], tally: Tally) -> dict[str, User]:
    users: dict[str, User] = {}
    for local, full_name, role, codes, all_branches in STAFF:
        email = f"{local}@{DEMO_DOMAIN}"
        user = User.objects.filter(email__iexact=email).first()
        created = user is None
        if created:
            if role == rbac.SUPER_ADMIN:
                user = User.objects.create_superuser(email, password, full_name=full_name)
            else:
                user = User.objects.create_user(
                    email, password, full_name=full_name, role=role, all_branches=all_branches
                )
        else:
            user.full_name, user.role, user.all_branches, user.is_active = full_name, role, all_branches, True
            if role == rbac.SUPER_ADMIN:
                user.is_superuser = True
            user.save()
            _ensure_password(user, password)
        user.branches.set([branches[c] for c in codes if c in branches])
        users[local] = user
        tally.add("User (staff)", created)

    for local, full_name, phone, addresses in CUSTOMERS:
        email = f"{local}@{DEMO_DOMAIN}"
        user = User.objects.filter(email__iexact=email).first()
        created = user is None
        if created:
            user = User.objects.create_user(email, password, full_name=full_name, phone=phone, role=rbac.CUSTOMER)
        else:
            user.full_name, user.phone, user.role, user.is_active = full_name, phone, rbac.CUSTOMER, True
            user.save()
            _ensure_password(user, password)
        users[local] = user
        tally.add("User (customer)", created)
        Address.objects.filter(user=user).update(is_default=False)  # the unique-default constraint needs a clean slate
        for position, (label, line1, line2, area, postcode, instructions) in enumerate(addresses):
            _, addr_created = Address.objects.update_or_create(
                user=user,
                label=label,
                defaults={
                    "recipient_name": full_name,
                    "phone": phone,
                    "line1": line1,
                    "line2": line2,
                    "city": "Riverton",
                    "area": area,
                    "postal_code": postcode,
                    "instructions": instructions,
                    "is_default": position == 0,
                },
            )
            tally.add("Address", addr_created)
    return users
