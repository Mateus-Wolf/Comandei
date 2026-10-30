from uuid import uuid4

import pytest

pytestmark = pytest.mark.integration


def ok(response, status=200):
    assert response.status_code == status, response.text
    return response.json()


def test_waiter_tab_with_mixed_guests_closing_and_cashier_reopening(api):
    call = api["call"]
    table = ok(call("POST", "tables", {"code": str(uuid4()), "name": "Mesa mista", "capacity": 8}), 201)
    normal = ok(call("POST", "products", {"category_id": str(api["a"]["category"]), "name": "Rodízio normal", "price_cents": 5000}), 201)
    premium = ok(call("POST", "products", {"category_id": str(api["a"]["category"]), "name": "Rodízio premium", "price_cents": 8000}), 201)
    groups = [
        {"label": "Premium", "product_id": premium["id"], "quantity": 5},
        {"label": "Normal", "product_id": normal["id"], "quantity": 1},
        {"label": "Aniversariante", "quantity": 1, "complimentary": True},
    ]
    body = {"table_id": table["id"], "guests": groups}
    key = str(uuid4())
    tab = ok(call("POST", "tabs", body, role="waiter", key=key), 201)
    assert ok(call("POST", "tabs", body, role="waiter", key=key), 201) == tab
    assert call("POST", "tabs", body, role="waiter").status_code == 409
    detail = ok(call("GET", f"tabs/{tab['id']}"))
    assert detail["amounts"]["subtotal_cents"] == 45000
    assert len(detail["guests"]) == 3
    groups[0]["quantity"] = 7
    assert call("PUT", f"tabs/{tab['id']}/guests", {"expected_version": tab["version"], "guests": groups}, role="waiter").status_code == 422
    groups[0]["quantity"] = 4
    updated = ok(call("PUT", f"tabs/{tab['id']}/guests", {"expected_version": tab["version"], "guests": groups}, role="waiter"))
    current = ok(call("GET", f"products/{normal['id']}"))
    order = ok(call("POST", f"tabs/{tab['id']}/orders", {"expected_version": updated["version"], "items": [{"product_id": normal["id"], "catalog_version": current["version"], "quantity": "2"}]}, role="waiter"), 201)
    assert order["amounts"]["subtotal_cents"] == 47000
    closing = ok(call("POST", f"tabs/{tab['id']}/start-closing", {"expected_version": order["version"], "service_accepted": False}, role="waiter"))["tab"]
    assert call("POST", "tabs", body, role="waiter").status_code == 409
    assert call("POST", f"tabs/{tab['id']}/close", {"expected_version": closing["version"]}, role="waiter").status_code == 403
    assert call("PUT", f"tabs/{tab['id']}/guests", {"expected_version": closing["version"], "guests": []}, role="waiter").status_code == 409
    assert call("POST", f"tabs/{tab['id']}/resume", {"expected_version": closing["version"]}, role="waiter").status_code == 403
    assert call("POST", f"tabs/{tab['id']}/resume", {"expected_version": closing["version"]}, role="manager").status_code == 403
    resumed = ok(call("POST", f"tabs/{tab['id']}/resume", {"expected_version": closing["version"]}, role="cashier"))
    assert resumed["status"] == "open"
    settings = ok(call("GET", "settings"))
    try:
        assert call("PATCH", "settings", {"expected_version": settings["version"], "tab_reopen_roles": ["waiter"]}, role="waiter").status_code == 403
        ok(call("PATCH", "settings", {"expected_version": settings["version"], "tab_reopen_roles": ["waiter"]}))
        closing = ok(call("POST", f"tabs/{tab['id']}/start-closing", {"expected_version": resumed["version"]}, role="waiter"))["tab"]
        assert call("POST", f"tabs/{tab['id']}/resume", {"expected_version": closing["version"]}, role="cashier").status_code == 403
        assert ok(call("POST", f"tabs/{tab['id']}/resume", {"expected_version": closing["version"]}, role="waiter"))["status"] == "open"
    finally:
        current = ok(call("GET", "settings"))
        ok(call("PATCH", "settings", {"expected_version": current["version"], "tab_reopen_roles": settings["tab_reopen_roles"]}))
