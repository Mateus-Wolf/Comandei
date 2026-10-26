from .errors import forbidden

ROLES = {"waiter", "cashier", "manager", "owner"}
PERMISSIONS = {
    "read": ROLES,
    "tabs.open": ROLES,
    "orders.submit": ROLES,
    "items.deliver": ROLES,
    "approval.request": ROLES,
    "catalog.write": {"manager", "owner"},
    "settings.write": {"owner"},
    "tables.write": {"owner"},
    "items.prepare": {"cashier", "manager", "owner"},
    "items.cancel": {"manager", "owner"},
    "approval.execute": {"manager", "owner"},
    "payments.record": {"cashier", "manager", "owner"},
    "payments.refund": {"manager", "owner"},
    "tabs.close": {"cashier", "manager", "owner"},
    "tabs.resume": {"manager", "owner"},
    "cash.write": {"cashier", "manager", "owner"},
    "discount": {"cashier", "manager", "owner"},
    "discount.void": {"manager", "owner"},
    "members.invite": {"manager", "owner"},
    "members.manage": {"manager", "owner"},
    "reports.read": {"cashier", "manager", "owner"},
    "audit.read": {"manager", "owner"},
    "exports.create": {"owner"},
}


def require(role: str, action: str):
    if role not in PERMISSIONS.get(action, set()):
        forbidden()
