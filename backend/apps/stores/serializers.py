from rest_framework import serializers

from .models import Branch, BranchClosure, BranchHours, DeliverySlot, DeliveryZone


class BranchHoursSerializer(serializers.ModelSerializer):
    class Meta:
        model = BranchHours
        fields = ["weekday", "opens", "closes", "is_closed"]


class BranchSerializer(serializers.ModelSerializer):
    hours = BranchHoursSerializer(many=True, read_only=True)
    address = serializers.CharField(source="address_display", read_only=True)

    class Meta:
        model = Branch
        fields = [
            "id",
            "code",
            "name",
            "slug",
            "address",
            "phone",
            "email",
            "offers_delivery",
            "offers_pickup",
            "pickup_instructions",
            "prep_minutes",
            "is_default",
            "hours",
        ]


class ZoneSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeliveryZone
        fields = ["id", "name", "delivery_fee", "free_delivery_threshold", "min_order_value"]


class SlotSerializer(serializers.ModelSerializer):
    remaining = serializers.IntegerField(read_only=True)
    scarce = serializers.SerializerMethodField()

    class Meta:
        model = DeliverySlot
        fields = ["id", "kind", "date", "start_time", "end_time", "fee", "remaining", "scarce"]

    def get_scarce(self, obj) -> bool:
        return obj.remaining <= 3


class ClosureSerializer(serializers.ModelSerializer):
    class Meta:
        model = BranchClosure
        fields = ["date", "reason"]
