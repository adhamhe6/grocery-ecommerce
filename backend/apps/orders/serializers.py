from __future__ import annotations

from django.core.files.storage import default_storage
from django.utils import timezone
from rest_framework import serializers

from apps.cart.models import SubstitutionPolicy
from apps.core.models import StoreSettings
from apps.core.money import money, qty_str
from apps.payments.models import OPEN_STATES, PaymentState, RefundStatus

from .models import FulfilmentType, Order, OrderStatus, PaymentMethod, SupportCase
from .workflow import STATUS_LABELS, TERMINAL

STATUS_SUMMARY = {
    OrderStatus.PENDING_PAYMENT: "Waiting for payment",
    OrderStatus.CONFIRMED: "Confirmed — we'll start picking soon",
    OrderStatus.PICKING: "Being picked",
    OrderStatus.PACKING: "Being packed",
    OrderStatus.READY_FOR_PICKUP: "Ready for you to collect",
    OrderStatus.READY_FOR_DISPATCH: "Packed — waiting for dispatch",
    OrderStatus.OUT_FOR_DELIVERY: "Out for delivery",
    OrderStatus.COMPLETED: "Completed",
    OrderStatus.CANCELLED: "Cancelled",
    OrderStatus.PAYMENT_FAILED: "Payment not completed",
}


class AddressInputSerializer(serializers.Serializer):
    recipient_name = serializers.CharField(max_length=120)
    phone = serializers.CharField(max_length=32)
    line1 = serializers.CharField(max_length=160)
    line2 = serializers.CharField(max_length=160, required=False, allow_blank=True, default="")
    city = serializers.CharField(max_length=80)
    area = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    postal_code = serializers.CharField(max_length=16, required=False, allow_blank=True, default="")
    instructions = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if not (attrs.get("postal_code") or attrs.get("area")):
            raise serializers.ValidationError(
                {"postal_code": "Enter a postcode (or an area) so we can check delivery coverage."}
            )
        return attrs


class ContactInputSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120, required=False)
    email = serializers.EmailField(required=False)
    phone = serializers.CharField(max_length=32, required=False)


class CheckoutInputSerializer(serializers.Serializer):
    fulfilment_type = serializers.ChoiceField(choices=FulfilmentType.values)
    slot_id = serializers.IntegerField(min_value=1)
    payment_method = serializers.ChoiceField(choices=PaymentMethod.values, default=PaymentMethod.CARD)
    branch_id = serializers.IntegerField(required=False, allow_null=True)
    address_id = serializers.IntegerField(required=False, allow_null=True)
    address = AddressInputSerializer(required=False, allow_null=True)
    contact = ContactInputSerializer(required=False)
    substitution_policy = serializers.ChoiceField(choices=SubstitutionPolicy.values, required=False, allow_null=True)
    customer_note = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")
    expected_total = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True)
    save_address = serializers.BooleanField(required=False, default=False)


class CancelSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=300, required=False, allow_blank=True, default="Cancelled by customer")


class TrackSerializer(serializers.Serializer):
    number = serializers.CharField(max_length=20)
    email = serializers.EmailField()


class DecisionSerializer(serializers.Serializer):
    approve = serializers.BooleanField()


class CaseCreateSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=["MISSING", "DAMAGED", "INCORRECT", "WEIGHT", "LATE", "OTHER"])
    description = serializers.CharField(max_length=2000)
    order_item_id = serializers.IntegerField(required=False, allow_null=True)


def media_url(path: str) -> str | None:
    return default_storage.url(path) if path else None


def item_dict(item) -> dict:
    return {
        "id": item.id,
        "product_id": item.product_id,
        "name": item.name,
        "sku": item.sku,
        "image": media_url(item.image_path),
        "unit": item.unit_symbol,
        "ordered_qty": qty_str(item.ordered_qty),
        "picked_qty": qty_str(item.picked_qty),
        "unit_price": str(item.unit_price),
        "base_unit_price": str(item.base_unit_price),
        "promo_label": item.promo_label,
        "line_total_estimated": str(item.line_total_estimated),
        "line_total_final": str(item.line_total_final) if item.line_total_final is not None else None,
        "status": item.status,
        "is_variable_weight": item.is_variable_weight,
        "is_substitute": item.substitute_for_id is not None,
        "substitute_for": item.substitute_for_id,
        "picker_note": item.picker_note if item.picker_note else "",
        "substitution_pref": item.substitution_pref,
        "price_note": (
            "Priced by weight: the final price uses the weight we actually pick." if item.is_variable_weight else ""
        ),
    }


def payment_dict(order: Order) -> dict | None:
    payments = list(order.payments.all())
    if not payments:
        return None
    current = next((p for p in payments if p.state in OPEN_STATES), payments[0])
    mode = "cod" if current.provider == "cod" else ("demo" if current.is_demo else current.provider)
    can_retry = order.status == OrderStatus.PENDING_PAYMENT and current.state in (
        PaymentState.FAILED,
        PaymentState.CANCELLED,
    )
    return {
        "state": current.state,
        "method": current.method,
        "mode": mode,
        "is_demo": current.is_demo,
        "attempt": current.attempt,
        "amount_authorised": str(current.amount),
        "amount_captured": str(current.captured_amount),
        "amount_refunded": str(current.refunded_amount),
        "checkout_url": current.checkout_url if current.state == PaymentState.REQUIRES_ACTION else "",
        "can_retry": can_retry,
        "failure_message": current.failure_message
        if current.state in (PaymentState.FAILED, PaymentState.CANCELLED)
        else "",
        "expires_at": order.reservation_expires_at,
    }


def order_detail(order: Order, *, include_token: bool = False) -> dict:
    store = StoreSettings.load()
    items = list(order.items.all())
    from .models import Substitution, SubstitutionStatus

    pending_subs = [
        {
            "id": s.id,
            "item_id": s.order_item_id,
            "original": s.order_item.name,
            "substitute": s.substitute_product.name,
            "quantity": qty_str(s.qty),
            "unit": s.order_item.unit_symbol,
            "charged_unit_price": str(s.charged_unit_price),
            "list_unit_price": str(s.list_unit_price),
            "original_unit_price": str(s.order_item.unit_price),
            "reason": s.reason,
            "price_note": "You pay the lower of the two prices." if store.substitution_price_cap else "",
        }
        for s in Substitution.objects.filter(
            order_item__order=order, status=SubstitutionStatus.AWAITING_CUSTOMER
        ).select_related("order_item", "substitute_product")
    ]
    due = order.final_total if order.final_total is not None else order.total
    now = timezone.now()
    window = timezone.timedelta(hours=store.complaint_window_hours)
    data = {
        "number": order.number,
        "status": order.status,
        "status_label": STATUS_LABELS[order.status],
        "status_summary": STATUS_SUMMARY[order.status],
        "is_terminal": order.status in TERMINAL,
        "placed_at": order.placed_at,
        "payment_status": order.payment_status,
        "payment_method": order.payment_method,
        "fulfilment_type": order.fulfilment_type,
        "currency": order.currency,
        "is_demo": order.is_demo,
        "branch": {
            "id": order.branch_id,
            "name": order.branch.name,
            "address": order.branch.address_display,
            "phone": order.branch.phone,
            "pickup_instructions": order.branch.pickup_instructions,
        },
        "slot": {"starts_at": order.slot_starts_at, "ends_at": order.slot_ends_at} if order.slot_starts_at else None,
        "address": (
            {
                "recipient": order.ship_recipient,
                "phone": order.ship_phone,
                "line1": order.ship_line1,
                "line2": order.ship_line2,
                "city": order.ship_city,
                "area": order.ship_area,
                "postal_code": order.ship_postal_code,
                "instructions": order.ship_instructions,
            }
            if order.fulfilment_type == FulfilmentType.DELIVERY
            else None
        ),
        "contact": {"name": order.contact_name, "email": order.contact_email, "phone": order.contact_phone},
        "substitution_policy": order.substitution_policy,
        "customer_note": order.customer_note,
        "items": [item_dict(i) for i in items],
        "totals": {
            "subtotal": str(order.subtotal),
            "promo_savings": str(order.promo_savings),
            "coupon_code": order.coupon_code,
            "coupon_discount": str(order.coupon_discount),
            "delivery_fee": str(order.delivery_fee),
            "tax_total": str(order.tax_total),
            "tax_included": store.prices_include_tax,
            "total": str(order.total),
            "max_charge": str(order.authorized_amount),
            "final_total": str(order.final_total) if order.final_total is not None else None,
            "amount_due": str(money(due)),
            "difference": str(money(order.final_total - order.total)) if order.final_total is not None else None,
        },
        "timeline": [
            {
                "status": h.to_status,
                "label": h.public_note or STATUS_LABELS.get(h.to_status, h.to_status),
                "at": h.created_at,
            }
            for h in order.history.all()
            if h.public_note
        ],
        "payment": payment_dict(order),
        "refunds": [
            {
                "amount": str(r.amount),
                "status": r.status,
                "reason": r.reason,
                "requested_at": r.created_at,
                "completed_at": r.completed_at,
                "note": "Refund issued"
                if r.status == RefundStatus.SUCCEEDED
                else (
                    "Refund pending"
                    if r.status == RefundStatus.PENDING
                    else "Refund could not be completed — we'll contact you"
                ),
            }
            for r in order.refunds.all()
        ],
        "pending_substitutions": pending_subs,
        "can_cancel": order.status in (OrderStatus.PENDING_PAYMENT, OrderStatus.CONFIRMED),
        "can_report_problem": order.status
        in (OrderStatus.COMPLETED, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.READY_FOR_PICKUP)
        and (order.completed_at is None or now - order.completed_at <= window),
        "cases": [
            {"id": c.id, "kind": c.kind, "status": c.status, "resolution": c.resolution, "created_at": c.created_at}
            for c in order.cases.all()
        ],
    }
    if include_token:
        data["tracking_token"] = order.tracking_token
    return data


def order_summary(order: Order) -> dict:
    return {
        "number": order.number,
        "status": order.status,
        "status_label": STATUS_LABELS[order.status],
        "placed_at": order.placed_at,
        "fulfilment_type": order.fulfilment_type,
        "total": str(order.final_total if order.final_total is not None else order.total),
        "currency": order.currency,
        "item_count": getattr(order, "item_count", None),
        "slot_starts_at": order.slot_starts_at,
        "payment_status": order.payment_status,
    }


class SupportCaseSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupportCase
        fields = ["id", "kind", "description", "status", "resolution", "refund_amount", "created_at", "resolved_at"]
        read_only_fields = fields
