import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
const { outputText } = ts.transpileModule(
  readFileSync(
    new URL("../apps/web/src/lib/request-pool.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  },
);
const { createRequestPool } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);
const cacheModule = ts.transpileModule(
  readFileSync(
    new URL("../apps/web/src/lib/record-cache.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const cacheUrl = `data:text/javascript;base64,${Buffer.from(cacheModule).toString("base64")}`;
const { createRecordCache } = await import(cacheUrl);
test("explicit refresh replaces cached data and rejects stale cache writes", async () => {
  const cache = createRecordCache();
  const path = "/tenants/a/tables";
  let finish;
  const old = cache.read(
    "user",
    path,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await Promise.resolve();
  assert.deepEqual(
    await cache.read("user", path, async () => ["fresh"], undefined, true),
    ["fresh"],
  );
  finish(["old"]);
  await old;
  assert.deepEqual(
    await cache.read("user", path, async () => {
      throw new Error("Unexpected read");
    }),
    ["fresh"],
  );
  assert.deepEqual(
    await cache.read("user", path, async () => ["newer"], undefined, true),
    ["newer"],
  );
  assert.deepEqual(
    await cache.read("user", path, async () => {
      throw new Error("Unexpected read");
    }),
    ["newer"],
  );
});
const unexpected = async () => {
  throw new Error("Unexpected database read");
};

test("API serves cached reads across token renewal, preserves failed edits and clears on logout", async () => {
  let session = {
    access_token: "first-token",
    user: { id: "user", last_sign_in_at: "login" },
  };
  globalThis.__cacheTestAuth = () => ({
    auth: { getSession: async () => ({ data: { session } }) },
  });
  const source = ts
    .transpileModule(
      readFileSync(
        new URL("../apps/web/src/lib/api.ts", import.meta.url),
        "utf8",
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.ES2022,
          target: ts.ScriptTarget.ES2022,
        },
      },
    )
    .outputText.replace(
      'import { supabase } from "./browser";',
      "const supabase = globalThis.__cacheTestAuth;",
    )
    .replace('from "./record-cache"', `from ${JSON.stringify(cacheUrl)}`);
  const { api, clearApiCache } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
  const originalFetch = globalThis.fetch;
  let reads = 0;
  let status = 200;
  globalThis.fetch = async (_url, options) => {
    if (options.method === "GET") {
      reads++;
      return Response.json({ items: [{ id: "one", name: "Mesa" }] });
    }
    return Response.json({ error: { message: "Rejected" } }, { status });
  };
  try {
    const path = "/tenants/a/tables";
    await api(path);
    session.access_token = "renewed-token";
    await api(path, { signal: new AbortController().signal });
    assert.equal(reads, 1);
    status = 422;
    await assert.rejects(
      api(`${path}/one`, { method: "PATCH", body: { name: "Other" } }),
    );
    await api(path);
    assert.equal(reads, 1);
    status = 409;
    await assert.rejects(api(`${path}/one`, { method: "PATCH" }));
    await api(path);
    assert.equal(reads, 2);
    clearApiCache();
    await api(path);
    assert.equal(reads, 3);
    session = {
      ...session,
      user: { id: "other-user", last_sign_in_at: "login" },
    };
    await api(path);
    assert.equal(reads, 4);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__cacheTestAuth;
    clearApiCache();
  }
});

test("record cache reuses completed reads, including cancellable reads, without expiry", async () => {
  const cache = createRecordCache();
  const path = "/tenants/a/tables";
  let calls = 0;
  const load = async () => {
    calls++;
    return { items: [{ id: "one", name: "Mesa" }] };
  };
  await Promise.all([
    cache.read("user", path, load),
    cache.read("user", path, load),
  ]);
  const result = await cache.read(
    "user",
    path,
    unexpected,
    new AbortController().signal,
  );
  result.items[0].name = "Changed outside cache";
  assert.equal(
    (await cache.read("user", path, unexpected)).items[0].name,
    "Mesa",
  );
  assert.equal(calls, 1);
});

test("editing one table updates its list and detail without refetching other records or occupancy", async () => {
  const cache = createRecordCache();
  const path = "/tenants/a/tables";
  await cache.read("user", path, async () => ({
    items: [
      { id: "one", name: "Old", active_tab: { id: "tab" } },
      { id: "two", name: "Keep" },
    ],
    next_cursor: null,
  }));
  await cache.read("user", `${path}/two`, async () => ({
    id: "two",
    name: "Keep",
  }));
  cache.mutate("user", `${path}/one`, "PATCH", {
    id: "one",
    name: "New",
    active_tab: null,
  });
  const result = await cache.read("user", path, unexpected);
  assert.deepEqual(
    result.items.map((row) => row.name),
    ["New", "Keep"],
  );
  assert.deepEqual(result.items[0].active_tab, { id: "tab" });
  assert.equal(
    (await cache.read("user", `${path}/one`, unexpected)).name,
    "New",
  );
  assert.equal(
    (await cache.read("user", `${path}/two`, unexpected)).name,
    "Keep",
  );
});

test("member and restaurant edits update normalized lists without new reads", async () => {
  const cache = createRecordCache();
  await cache.read("user", "/tenants/a/team", async () => ({
    members: [{ user_id: "m", display_name: "Maria", role: "waiter" }],
    invitations: [],
  }));
  cache.mutate("user", "/tenants/a/members/m", "PATCH", {
    user_id: "m",
    role: "cashier",
  });
  assert.deepEqual(
    (await cache.read("user", "/tenants/a/team", unexpected)).members[0],
    { user_id: "m", display_name: "Maria", role: "cashier" },
  );
  await cache.read("user", "/restaurants", async () => ({
    items: [{ id: "a", name: "Old", role: "owner" }],
    can_create: true,
  }));
  cache.mutate("user", "/tenants/a/settings", "PATCH", {
    id: "a",
    name: "New",
    version: 2,
  });
  const restaurants = await cache.read("user", "/restaurants", unexpected);
  assert.equal(restaurants.items[0].name, "New");
  assert.equal(restaurants.items[0].role, "owner");
});

test("stock mutations invalidate dependent views but preserve other tenants, users and resources", async () => {
  const cache = createRecordCache();
  const paths = [
    "/tenants/a/stock?search=tea",
    "/tenants/a/products/p",
    "/tenants/a/team",
    "/tenants/b/stock",
  ];
  for (const owner of ["user", "other"])
    for (const path of paths)
      await cache.read(owner, path, async () => ({ value: "cached" }));
  cache.mutate("user", "/tenants/a/products/p", "PATCH", {
    id: "p",
    name: "Tea",
  });
  for (const path of paths.slice(0, 2))
    assert.equal(
      (await cache.read("user", path, async () => ({ value: "fresh" }))).value,
      "fresh",
    );
  for (const path of paths.slice(2))
    assert.equal((await cache.read("user", path, unexpected)).value, "cached");
  for (const path of paths)
    assert.equal((await cache.read("other", path, unexpected)).value, "cached");
});

test("create and delete invalidate collection membership without evicting unrelated details", async () => {
  const cache = createRecordCache();
  const path = "/tenants/a/tables";
  await cache.read("user", path, async () => ({ items: [{ id: "one" }] }));
  await cache.read("user", `${path}/one`, async () => ({ id: "one" }));
  cache.mutate("user", path, "POST", { id: "two" });
  assert.deepEqual(
    await cache.read("user", path, async () => ({
      items: [{ id: "one" }, { id: "two" }],
    })),
    { items: [{ id: "one" }, { id: "two" }] },
  );
  cache.mutate("user", `${path}/two`, "DELETE", {});
  assert.deepEqual(
    await cache.read("user", path, async () => ({ items: [{ id: "one" }] })),
    { items: [{ id: "one" }] },
  );
  assert.deepEqual(await cache.read("user", `${path}/one`, unexpected), {
    id: "one",
  });
  assert.equal(
    await cache.read("user", `${path}/two`, async () => "deleted"),
    "deleted",
  );
});

test("late reads cannot restore data after mutation or logout", async () => {
  for (const clear of [false, true]) {
    const cache = createRecordCache();
    let finish;
    const old = cache.read(
      "user",
      "/tenants/a/tables",
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await Promise.resolve();
    if (clear) cache.clear();
    else
      cache.mutate("user", "/tenants/a/tables/one", "PATCH", {
        id: "one",
        name: "New",
      });
    await cache.read("user", "/tenants/a/tables", async () => ({
      items: [{ id: "one", name: "New" }],
    }));
    finish({ items: [{ id: "one", name: "Old" }] });
    await old;
    assert.equal(
      (await cache.read("user", "/tenants/a/tables", unexpected)).items[0].name,
      "New",
    );
  }
});

test("failed and cancelled reads never poison the cache", async () => {
  const cache = createRecordCache();
  await assert.rejects(cache.read("user", "/restaurants", unexpected));
  const controller = new AbortController();
  let finish;
  const read = cache.read(
    "user",
    "/restaurants",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    controller.signal,
  );
  await Promise.resolve();
  controller.abort();
  finish({ items: [] });
  await assert.rejects(read, { name: "AbortError" });
  assert.deepEqual(
    await cache.read("user", "/restaurants", async () => ({
      items: [{ id: "a" }],
    })),
    { items: [{ id: "a" }] },
  );
});

test("financial reports stay cached until related operations in their restaurant change", async () => {
  const cache = createRecordCache();
  const path = "/tenants/a/reports/financial?period=week";
  const other = "/tenants/b/reports/financial?period=week";
  const snapshot = { net_received_cents: 1000 };
  await cache.read("user", path, async () => snapshot);
  await cache.read("user", other, async () => snapshot);
  cache.mutate("user", "/tenants/a/tables/table", "PATCH", {
    id: "table",
    name: "Mesa",
  });
  assert.equal(
    (await cache.read("user", path, unexpected)).net_received_cents,
    1000,
  );
  cache.mutate("user", "/tenants/a/tabs/tab/payments", "POST", {
    payment: { id: "payment" },
  });
  assert.equal(
    (await cache.read("user", path, async () => ({ net_received_cents: 2000 })))
      .net_received_cents,
    2000,
  );
  assert.equal(
    (await cache.read("user", other, unexpected)).net_received_cents,
    1000,
  );
  cache.mutate("user", "/tenants/a/cash-sessions/session/movements", "POST", {
    id: "movement",
  });
  assert.equal(
    (await cache.read("user", path, async () => ({ net_received_cents: 3000 })))
      .net_received_cents,
    3000,
  );
});

test("simultaneous reads share a request; later reads fetch fresh data", async () => {
  const pool = createRequestPool();
  let calls = 0;
  const load = async () => ++calls;
  assert.deepEqual(
    await Promise.all([
      pool.run("user-a:/tables", load),
      pool.run("user-a:/tables", load),
    ]),
    [1, 1],
  );
  assert.equal(calls, 1);
  assert.equal(await pool.run("user-a:/tables", load), 2);
});

test("different sessions never share a read", async () => {
  const pool = createRequestPool();
  let calls = 0;
  await Promise.all([
    pool.run("user-a:/tables", async () => ++calls),
    pool.run("user-b:/tables", async () => ++calls),
  ]);
  assert.equal(calls, 2);
});

test("a mutation invalidates pending reads without reusing an older snapshot", async () => {
  const pool = createRequestPool();
  let finish;
  const old = pool.run(
    "user:/tables",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await Promise.resolve();
  pool.invalidate();
  assert.equal(await pool.run("user:/tables", async () => "fresh"), "fresh");
  finish("old");
  assert.equal(await old, "old");
});

test("failed requests can be retried", async () => {
  const pool = createRequestPool();
  await assert.rejects(
    pool.run("user:/tables", async () => {
      throw new Error("offline");
    }),
  );
  assert.equal(await pool.run("user:/tables", async () => "ok"), "ok");
});
