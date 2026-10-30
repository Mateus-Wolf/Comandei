"""Product management for the stock screen; no inferred physical balances."""

import base64
import json
from uuid import UUID

from comandei.core.errors import APIError


def overview(uow, limit=30, cursor=None, search="", category_id=None, status="all"):
    uow.allow("catalog.write")
    search = search.strip()
    filters = {"search": search, "category": str(category_id) if category_id else None, "status": status}
    params = {"limit": limit + 1, "search": search, "category": category_id}
    where = "p.tenant_id=:tenant"
    if search:
        where += " and (strpos(lower(p.name),lower(:search))>0 or strpos(lower(coalesce(p.sku,'')),lower(:search))>0)"
    if category_id:
        where += " and p.category_id=:category"
    if status == "available":
        where += " and p.active and p.available"
    elif status == "unavailable":
        where += " and p.active and not p.available"
    elif status == "inactive":
        where += " and not p.active"
    if cursor:
        try:
            value = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
            if value["tenant"] != str(uow.tenant["id"]) or value["filters"] != filters:
                raise ValueError()
            name = value["name"]
            if not isinstance(name, str) or not 1 <= len(name) <= 160:
                raise ValueError()
            params.update(after_name=name, after_id=UUID(value["id"]))
            where += " and (p.name,p.id)>(:after_name,:after_id)"
        except (ValueError, KeyError, TypeError, UnicodeError):
            raise APIError(422, "INVALID_CURSOR", "Cursor inválido para estes filtros.")
    row = (
        uow.repo.query(
            "select coalesce((select jsonb_agg(x order by x.name,x.id) from ("
            "select p.*,c.name as category_name from app.products p "
            "join app.categories c on c.id=p.category_id and c.tenant_id=p.tenant_id "
            f"where {where} order by p.name,p.id limit :limit) x),'[]'::jsonb) as items,"
            "coalesce((select jsonb_agg(c order by c.position,c.name,c.id) from app.categories c "
            "where c.tenant_id=:tenant),'[]'::jsonb) as categories,"
            "(select jsonb_build_object('total',count(*),'available',count(*) filter(where active and available),"
            "'unavailable',count(*) filter(where active and not available),'inactive',count(*) filter(where not active)) "
            "from app.products where tenant_id=:tenant) as summary",
            **params,
        )
        .mappings()
        .one()
    )
    result = dict(row)
    result["next_cursor"] = None
    if len(result["items"]) > limit:
        result["items"] = result["items"][:limit]
        last = result["items"][-1]
        result["next_cursor"] = (
            base64.urlsafe_b64encode(
                json.dumps(
                    {
                        "tenant": str(uow.tenant["id"]),
                        "filters": filters,
                        "name": last["name"],
                        "id": last["id"],
                    },
                    ensure_ascii=False,
                ).encode()
            )
            .decode()
            .rstrip("=")
        )
    return result
