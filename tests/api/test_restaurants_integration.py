from uuid import uuid4
import pytest

pytestmark = pytest.mark.integration


def test_restaurant_create_replay_and_permissions(api):
    data = {
        "name": "Restaurante de teste",
        "address": "Rua teste, 10",
        "cnpj": "11222333000181",
        "opens_at": "18:00",
        "closes_at": "02:00",
        "service_type": "both",
    }
    assert api["call"]("POST", "/v1/restaurants", data, role="invitee").status_code == 403
    assert api["call"]("POST", "/v1/restaurants", data, role="manager").status_code == 403
    key = str(uuid4())
    response = api["call"]("POST", "/v1/restaurants", data, key=key)
    assert response.status_code == 201, response.text
    tenant = response.json()["id"]
    api["tenants"]["created_restaurant"] = tenant
    replay = api["call"]("POST", "/v1/restaurants", data, key=key)
    assert replay.json()["id"] == tenant
    assert replay.headers["Idempotency-Replayed"] == "true"
    listing = api["call"]("GET", "/v1/restaurants").json()
    assert listing["can_create"] is True
    registered = next(item for item in listing["items"] if item["id"] == tenant)
    assert registered["address"] == data["address"]
    assert registered["service_type"] == "both"
    assert registered["role"] == "owner"
    assert tenant not in [
        r["id"] for r in api["call"]("GET", "/v1/restaurants", role="owner_b").json()["items"]
    ]


def test_manager_cannot_mutate_layout_or_settings(api):
    table = {"code": str(uuid4()), "name": "Mesa", "capacity": 6}
    assert api["call"]("POST", "tables", table, role="manager").status_code == 403
    created = api["call"]("POST", "tables", table)
    assert created.status_code == 201, created.text
    result = created.json()
    assert (
        api["call"](
            "PATCH",
            f"tables/{result['id']}",
            {"expected_version": result["version"], "capacity": 8},
            role="manager",
        ).status_code
        == 403
    )
    assert api["call"]("GET", "tables", role="waiter").status_code == 200
    settings = api["call"]("GET", "settings").json()
    assert (
        api["call"](
            "PATCH",
            "settings",
            {"expected_version": settings["version"], "address": "Outra rua"},
            role="manager",
        ).status_code
        == 403
    )
    # Cross-tenant photo references are rejected even for the administrator.
    photo = f"{api['tenants']['b']}/{uuid4()}.jpg"
    assert (
        api["call"](
            "PATCH", "settings", {"expected_version": settings["version"], "photo_path": photo}
        ).status_code
        == 422
    )


def test_structured_address_edit_and_replay(api):
    address = dict(
        postal_code="01001000",
        state="SP",
        city="São Paulo",
        neighborhood="Sé",
        street="Praça da Sé",
        number="10",
        complement="",
    )
    # Update an existing tenant: settings, list and replay must agree.
    initial = api["call"]("GET", "settings").json()
    body = {"expected_version": initial["version"], "address_details": address}
    key = str(uuid4())
    saved = api["call"]("PATCH", "settings", body, key=key)
    assert saved.status_code == 200, saved.text
    assert saved.json()["address_details"] == address
    assert "01001-000" in saved.json()["address"]
    replay = api["call"]("PATCH", "settings", body, key=key)
    assert replay.headers["Idempotency-Replayed"] == "true"
    assert replay.json()["version"] == saved.json()["version"]
    assert api["call"]("GET", "settings").json()["address_details"] == address
    listed = next(
        item
        for item in api["call"]("GET", "/v1/restaurants").json()["items"]
        if item["id"] == str(api["tenants"]["a"])
    )
    assert listed["address_details"] == address
    denied = api["call"](
        "PATCH",
        "settings",
        {"expected_version": saved.json()["version"], "address_details": {**address, "number": "99"}},
        role="manager",
    )
    assert denied.status_code == 403
    edited = api["call"](
        "PATCH",
        "settings",
        {"expected_version": saved.json()["version"], "address_details": {**address, "complement": "Sala 2"}},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["address_details"]["complement"] == "Sala 2"
