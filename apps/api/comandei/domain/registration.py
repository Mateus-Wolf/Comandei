"""CNPJ numeric and alphanumeric check digits (Receita Federal ASCII - 48)."""

import re


def normalize_cnpj(value: str) -> str:
    normalized = re.sub(r"[.\-/\s]", "", value).upper()
    if not re.fullmatch(r"[A-Z0-9]{12}[0-9]{2}", normalized) or len(set(normalized)) == 1:
        raise ValueError("CNPJ inválido.")
    prefix = normalized[:12]
    for weights in ([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]):
        remainder = sum((ord(char) - 48) * weight for char, weight in zip(prefix, weights)) % 11
        prefix += str(0 if remainder < 2 else 11 - remainder)
    if prefix != normalized:
        raise ValueError("Os dígitos verificadores do CNPJ são inválidos.")
    return normalized
