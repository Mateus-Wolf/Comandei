import json
from decimal import Decimal
from fastapi.encoders import jsonable_encoder


def encode(value):
    return jsonable_encoder(value, custom_encoder={Decimal: str})


def canonical(value):
    return json.dumps(encode(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
