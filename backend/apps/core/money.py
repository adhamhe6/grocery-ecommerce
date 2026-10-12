"""Decimal helpers. Money and quantities are never floats."""

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

CENT = Decimal("0.01")
MILLI = Decimal("0.001")
ZERO = Decimal("0")


def to_decimal(value) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        raise TypeError("floats are not accepted for money/quantity values")
    try:
        return Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError(f"not a decimal: {value!r}") from exc


def money(value) -> Decimal:
    return to_decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def qty(value) -> Decimal:
    return to_decimal(value).quantize(MILLI, rounding=ROUND_HALF_UP)


def is_multiple_of_step(value: Decimal, minimum: Decimal, step: Decimal) -> bool:
    """True if value == minimum + k*step for an integer k >= 0 (exact Decimal arithmetic)."""
    if value < minimum or step <= 0:
        return False
    remainder = (value - minimum) % step
    return remainder == 0


def qty_str(value) -> str | None:
    """Canonical quantity text for API output: no trailing zeros ('3', '0.25', '1.5')."""
    if value is None:
        return None
    text = f"{to_decimal(value):f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text
