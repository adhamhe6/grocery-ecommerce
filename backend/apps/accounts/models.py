from __future__ import annotations

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.db.models.functions import Lower

from apps.core import rbac
from apps.core.models import TimeStampedModel


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create(self, email: str, password: str | None, **extra):
        if not email:
            raise ValueError("An email address is required")
        user = self.model(email=self.normalize_email(email).strip().lower(), **extra)
        user.set_password(password)  # never stores plaintext; Argon2 by default
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra):
        extra.setdefault("role", rbac.CUSTOMER)
        return self._create(email, password, **extra)

    def create_superuser(self, email, password=None, **extra):
        extra.update(role=rbac.SUPER_ADMIN, is_staff=True, is_superuser=True)
        return self._create(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin, TimeStampedModel):
    email = models.EmailField(max_length=254, unique=True)
    full_name = models.CharField(max_length=120)
    phone = models.CharField(max_length=32, blank=True)
    role = models.CharField(max_length=24, choices=rbac.ROLE_CHOICES, default=rbac.CUSTOMER, db_index=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False, help_text="Technical Django-admin access only.")
    branches = models.ManyToManyField("stores.Branch", blank=True, related_name="staff")
    all_branches = models.BooleanField(default=False, help_text="Lets a branch-scoped role see every branch.")

    marketing_opt_in = models.BooleanField(default=False)
    notify_order_emails = models.BooleanField(default=True)

    objects = UserManager()
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["full_name"]

    class Meta:
        constraints = [models.UniqueConstraint(Lower("email"), name="uniq_user_email_ci")]
        indexes = [models.Index(fields=["role", "is_active"])]

    def __str__(self):
        return self.email

    def save(self, *args, **kwargs):
        self.email = self.email.strip().lower()
        # Django-admin access is reserved for technical roles; operations use the custom dashboard.
        if not self.is_superuser:
            self.is_staff = self.role in rbac.GLOBAL_ROLES
        super().save(*args, **kwargs)

    @property
    def is_staff_role(self) -> bool:
        return self.role in rbac.STAFF_ROLES

    def capabilities(self) -> list[str]:
        return sorted(rbac.capabilities_for(self.role))


class Address(TimeStampedModel):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="addresses")
    label = models.CharField(max_length=40, blank=True)
    recipient_name = models.CharField(max_length=120)
    phone = models.CharField(max_length=32)
    line1 = models.CharField(max_length=160)
    line2 = models.CharField(max_length=160, blank=True)
    city = models.CharField(max_length=80)
    area = models.CharField(max_length=80, blank=True, help_text="District / neighbourhood used for delivery coverage")
    postal_code = models.CharField(max_length=16, blank=True)
    instructions = models.CharField(max_length=300, blank=True)
    is_default = models.BooleanField(default=False)

    class Meta:
        ordering = ["-is_default", "-updated_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user"], condition=models.Q(is_default=True), name="uniq_default_address_per_user"
            )
        ]

    def __str__(self):
        return f"{self.recipient_name}, {self.line1}, {self.city}"
