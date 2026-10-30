// Session memory only. Records and query indexes have no time-based expiration.
type Row = Record<string, unknown>;
type Ref = { record: string };
type Value =
  | { literal: unknown }
  | Ref
  | { array: Value[] }
  | { object: Record<string, Value> };
const object = (value: unknown): value is Row =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function createRecordCache() {
  const records = new Map<string, Row>();
  const queries = new Map<string, Value>();
  const pending = new Map<string, Promise<unknown>>();
  let revision = 0;
  const key = (scope: string, path: string) => JSON.stringify([scope, path]);
  function context(path: string) {
    const parts = path.split("?")[0].split("/").filter(Boolean);
    return parts[0] === "tenants"
      ? { base: `/tenants/${parts[1]}`, resource: parts[2], id: parts[3] }
      : { base: "", resource: parts[0], id: parts[1] };
  }
  function pack(
    scope: string,
    path: string,
    value: unknown,
    field?: string,
  ): Value {
    if (Array.isArray(value))
      return { array: value.map((row) => pack(scope, path, row, field)) };
    if (!object(value)) return { literal: value };
    const { base, resource } = context(path);
    const collections: Record<string, string> = {
      categories: "categories",
      members: "members",
      invitations: "invitations",
      registers: "cash-registers",
      sessions: "cash-sessions",
      tabs: "tabs",
    };
    const collection =
      field === "items"
        ? resource === "stock" || resource === "catalog"
          ? "products"
          : resource
        : field
          ? collections[field]
          : resource;
    const id = value.id ?? value.user_id;
    // Only normalize direct resource rows and known collection fields. Nested
    // detail projections (e.g. a cash session summary) stay separate.
    if (
      id &&
      collection &&
      (!field || field === "items" || collections[field])
    ) {
      const record = key(scope, `${base}/${collection}/${id}`);
      records.set(record, {
        ...records.get(record),
        ...structuredClone(value),
      });
      return { record };
    }
    return {
      object: Object.fromEntries(
        Object.entries(value).map(([name, row]) => [
          name,
          pack(scope, path, row, name),
        ]),
      ),
    };
  }
  function unpack(value: Value): unknown {
    if ("record" in value) return structuredClone(records.get(value.record));
    if ("literal" in value) return value.literal;
    if ("array" in value) return value.array.map(unpack);
    return Object.fromEntries(
      Object.entries(value.object).map(([name, row]) => [name, unpack(row)]),
    );
  }
  function invalidate(
    scope: string,
    matches: (path: string, pendingRead: boolean) => boolean,
  ) {
    revision++;
    for (const map of [queries, pending]) {
      for (const entry of map.keys()) {
        const [owner, path] = JSON.parse(entry) as [string, string];
        if (owner === scope && matches(path, map === pending))
          map.delete(entry);
      }
    }
  }
  return {
    clear() {
      revision++;
      records.clear();
      queries.clear();
      pending.clear();
    },
    async read<T>(
      scope: string,
      path: string,
      load: () => Promise<T>,
      signal?: AbortSignal,
      fresh = false,
    ): Promise<T> {
      signal?.throwIfAborted();
      if (fresh) invalidate(scope, (candidate) => candidate === path);
      const query = key(scope, path);
      const cached = queries.get(query);
      if (cached) return unpack(cached) as T;
      // Cancellation belongs to the caller; cancellable requests are never shared.
      if (!signal && pending.has(query))
        return structuredClone(await pending.get(query)) as T;
      const started = revision;
      const request = Promise.resolve()
        .then(load)
        .then((result) => {
          signal?.throwIfAborted();
          if (started === revision)
            queries.set(query, pack(scope, path, result));
          return structuredClone(result);
        });
      if (!signal) pending.set(query, request);
      try {
        return await request;
      } finally {
        if (pending.get(query) === request) pending.delete(query);
      }
    },
    mutate(scope: string, path: string, method: string, result: unknown) {
      const { base, resource, id } = context(path);
      const rowPath = `${base}/${resource}${id ? `/${id}` : ""}`;
      const rowKey = key(scope, rowPath);
      const edited =
        method === "PATCH" &&
        object(result) &&
        (result.id === id || result.user_id === id) &&
        !!id;
      const settingsEdited =
        method === "PATCH" &&
        resource === "settings" &&
        object(result) &&
        result.id === base.split("/")[2];
      if (settingsEdited) {
        const restaurantKey = key(scope, `/restaurants/${result.id}`);
        records.set(restaurantKey, {
          ...records.get(restaurantKey),
          ...structuredClone(result),
        });
      }
      if (method === "DELETE") records.delete(rowKey);
      else if (
        id &&
        object(result) &&
        (result.id === id || result.user_id === id)
      ) {
        const previous = records.get(rowKey);
        const updated = { ...previous, ...structuredClone(result) };
        // Table edits do not change occupancy. The mutation DTO defaults this
        // read-only projection to null, so keep the known active tab.
        if (resource === "tables" && previous && "active_tab" in previous)
          updated.active_tab = previous.active_tab;
        records.set(rowKey, updated);
      }
      // Lists with filters, pagination and computed totals must be rebuilt after
      // a mutation; unrelated records and queries remain available.
      invalidate(scope, (candidate, pendingRead) => {
        const target = context(candidate);
        if (resource === "invitations" && !base) return true; // invitation acceptance changes access
        if (resource === "restaurants")
          return target.resource === "restaurants" || target.resource === "me";
        if (resource === "settings")
          return (
            ((!settingsEdited || pendingRead) &&
              candidate === "/restaurants") ||
            (target.base === base &&
              ["settings", "reports"].includes(target.resource))
          );
        if (target.base !== base) return false;
        // These lists have stable membership/order on edit. Their record
        // references already resolve to the updated response, with no new read.
        if (
          !pendingRead &&
          edited &&
          resource === "tables" &&
          target.resource === "tables"
        )
          return false;
        if (
          !pendingRead &&
          edited &&
          resource === "members" &&
          target.resource === "team"
        )
          return false;
        if (target.resource === resource && (!target.id || target.id === id))
          return true;
        if (
          [
            "products",
            "categories",
            "modifier-groups",
            "modifier-options",
            "product-modifier-groups",
          ].includes(resource)
        )
          return ["stock", "catalog", "products"].includes(target.resource);
        if (["members", "invitations", "employee-logins"].includes(resource))
          return target.resource === "team";
        if (resource === "cash-registers")
          return target.resource === "cash-overview";
        if (
          ["tabs", "items", "payments", "approvals", "cash-sessions"].includes(
            resource,
          )
        )
          return [
            "cash-overview",
            "cash-sessions",
            "tables",
            "tabs",
            "approvals",
            "reports",
          ].includes(target.resource);
        return false;
      });
      // A complete successful edit can satisfy the next individual read directly.
      // Command responses and partial projections cannot replace detail responses.
      if (
        method === "PATCH" &&
        id &&
        object(result) &&
        result.id === id &&
        resource !== "products"
      )
        queries.set(key(scope, rowPath), { record: rowKey });
      if (settingsEdited)
        queries.set(key(scope, path), pack(scope, path, result));
    },
  };
}
