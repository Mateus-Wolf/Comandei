// Opt-in browser fixture for development only. No email is sent; every created resource is removed.
import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID, randomInt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
if (process.env.RUN_DB_TESTS !== "1" || !process.env.TEST_BROWSER_PASSWORD)
  throw new Error(
    "Defina RUN_DB_TESTS=1 e TEST_BROWSER_PASSWORD para esta identidade descartável.",
  );
const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: {
    rejectUnauthorized: true,
    ca: readFileSync("certs/supabase-ca.crt", "utf8"),
  },
  connectionTimeoutMillis: 15000,
});
const id = randomUUID(),
  email = `restaurant-browser-${id}@example.invalid`,
  password = process.env.TEST_BROWSER_PASSWORD;
let prefix =
  String(randomInt(100000, 999999)) + String(randomInt(100000, 999999));
for (const weights of [
  [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
]) {
  const remainder =
    [...prefix].reduce((sum, char, i) => sum + Number(char) * weights[i], 0) %
    11;
  prefix += remainder < 2 ? "0" : String(11 - remainder);
}
const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
);
let created = false;
try {
  await db.connect();
  await db.query(
    `insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,recovery_token,confirmation_token,email_change,email_change_token_new,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated',$2,extensions.crypt($3,extensions.gen_salt('bf')),now(),'','','','','{"provider":"email","providers":["email"]}','{"display_name":"Administrador de teste"}',now(),now())`,
    [id, email, password],
  );
  created = true;
  await db.query(
    "insert into app.restaurant_administrators(user_id) values($1)",
    [id],
  );
  console.log(
    `Identidade temporária: ${email}\nCNPJ sintético: ${prefix}\nPressione Enter para remover os recursos do teste.`,
  );
  await new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      process.stdin.pause();
      resolve();
    };
    const timer = setTimeout(finish, 600000);
    process.stdin.once("data", finish);
    process.once("SIGINT", finish);
  });
} finally {
  if (created) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const { rows: tenants } = await db.query(
      "select tenant_id from app.memberships where user_id=$1 and role='owner'",
      [id],
    );
    for (const { tenant_id: tenant } of tenants) {
      const storage = client.storage.from("restaurant-photos");
      const files = await storage.list(tenant, { limit: 1000 });
      if (files.error) throw files.error;
      if (files.data.length) {
        const removed = await storage.remove(
          files.data.map((file) => `${tenant}/${file.name}`),
        );
        if (removed.error) throw removed.error;
      }
      await db.query("begin");
      try {
        await db.query("delete from realtime.messages where topic=$1", [
          `tenant:${tenant}:operations`,
        ]);
        for (const table of [
          "background_jobs",
          "idempotency_records",
          "outbox_events",
          "audit_events",
          "cash_movements",
          "payment_entries",
          "tab_settlements",
          "cash_sessions",
          "cash_registers",
          "approval_requests",
          "adjustments",
          "order_item_modifiers",
          "order_items",
          "orders",
          "tabs",
          "product_modifier_groups",
          "modifier_options",
          "modifier_groups",
          "products",
          "categories",
          "dining_tables",
          "invitations",
          "tenant_entitlements",
          "memberships",
        ])
          await db.query(`delete from app.${table} where tenant_id=$1`, [
            tenant,
          ]);
        await db.query("delete from app.tenants where id=$1", [tenant]);
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }
    await client.auth.signOut();
    await db.query(
      "delete from app.restaurant_administrators where user_id=$1",
      [id],
    );
    await db.query("delete from app.profiles where user_id=$1", [id]);
    await db.query("delete from auth.users where id=$1", [id]);
    await db.query("delete from app.request_buckets where key like $1", [
      `${id}:%`,
    ]);
    console.log("Identidade, fotos e restaurantes do teste removidos.");
  }
  await db.end();
}
