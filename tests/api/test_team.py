from uuid import uuid4

from fastapi.testclient import TestClient

from comandei.main import app


def test_pending_invitation_list_requires_authentication():
    client = TestClient(app)
    try:
        response = client.get(f"/v1/tenants/{uuid4()}/invitations")
    finally:
        client.close()
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"
