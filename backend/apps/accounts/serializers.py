from __future__ import annotations

from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from apps.core.permissions import branch_ids_for

from .models import Address, User


def _validate_password(value: str, user: User | None = None) -> str:
    try:
        password_validation.validate_password(value, user)
    except DjangoValidationError as exc:
        raise serializers.ValidationError(list(exc.messages)) from None
    return value


class UserSerializer(serializers.ModelSerializer):
    capabilities = serializers.SerializerMethodField()
    branch_ids = serializers.SerializerMethodField()
    is_staff_user = serializers.BooleanField(source="is_staff_role", read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "full_name",
            "phone",
            "role",
            "is_staff_user",
            "capabilities",
            "branch_ids",
            "marketing_opt_in",
            "notify_order_emails",
        ]
        read_only_fields = fields

    def get_capabilities(self, obj) -> list[str]:
        return obj.capabilities()

    def get_branch_ids(self, obj) -> list[int] | None:
        return branch_ids_for(obj) if obj.is_staff_role else []


class ProfileUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "full_name",
            "phone",
            "marketing_opt_in",
            "notify_order_emails",
        ]  # role/email/flags are not writable here

    def validate_full_name(self, value):
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError("Please enter your full name.")
        return value


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(write_only=True, max_length=128, trim_whitespace=False)
    full_name = serializers.CharField(max_length=120)
    phone = serializers.CharField(max_length=32, required=False, allow_blank=True)
    marketing_opt_in = serializers.BooleanField(required=False, default=False)

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists. Try signing in instead.")
        return value

    def validate_full_name(self, value):
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError("Please enter your full name.")
        return value

    def validate(self, attrs):
        probe = User(email=attrs["email"], full_name=attrs["full_name"])
        attrs["password"] = _validate_password(attrs["password"], probe)
        return attrs

    def create(self, validated):
        return User.objects.create_user(
            email=validated["email"],
            password=validated["password"],
            full_name=validated["full_name"],
            phone=validated.get("phone", ""),
            marketing_opt_in=validated.get("marketing_opt_in", False),
        )


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(trim_whitespace=False, max_length=128)


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(trim_whitespace=False)
    new_password = serializers.CharField(trim_whitespace=False, max_length=128)

    def validate(self, attrs):
        user = self.context["request"].user
        if not user.check_password(attrs["current_password"]):
            raise serializers.ValidationError({"current_password": "Your current password is incorrect."})
        attrs["new_password"] = _validate_password(attrs["new_password"], user)
        return attrs


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(trim_whitespace=False, max_length=128)


class AddressSerializer(serializers.ModelSerializer):
    class Meta:
        model = Address
        fields = [
            "id",
            "label",
            "recipient_name",
            "phone",
            "line1",
            "line2",
            "city",
            "area",
            "postal_code",
            "instructions",
            "is_default",
        ]
        read_only_fields = ["id"]

    def validate_phone(self, value):
        digits = [c for c in value if c.isdigit()]
        if len(digits) < 6:
            raise serializers.ValidationError("Enter a phone number we can reach you on.")
        return value.strip()

    def create(self, validated):
        user = self.context["request"].user
        if not user.addresses.exists():
            validated["is_default"] = True
        if validated.get("is_default"):
            user.addresses.filter(is_default=True).update(is_default=False)
        return Address.objects.create(user=user, **validated)

    def update(self, instance, validated):
        if validated.get("is_default"):
            instance.user.addresses.exclude(pk=instance.pk).filter(is_default=True).update(is_default=False)
        return super().update(instance, validated)
