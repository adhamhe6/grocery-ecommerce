"""JSON rendering that can never turn money or quantities into floats.

DRF's default encoder converts a raw `Decimal` to `float` (it assumes serializers already produced strings). Any view
that returns a Decimal directly would therefore leak a binary float, e.g. 51.94 → 51.939999…. This renderer encodes
every Decimal as its exact string instead.
"""

import decimal

from rest_framework.renderers import JSONRenderer
from rest_framework.utils.encoders import JSONEncoder


class DecimalSafeEncoder(JSONEncoder):
    def default(self, obj):
        if isinstance(obj, decimal.Decimal):
            return format(obj, "f")
        return super().default(obj)


class DecimalSafeJSONRenderer(JSONRenderer):
    encoder_class = DecimalSafeEncoder
