// Opt-in smoke test: creates one disposable identity, sends no email, removes it in finally.
import pg from "pg";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
if (process.env.RUN_DB_TESTS !== "1")
  throw new Error(
    "Use RUN_DB_TESTS=1 somente no projeto de desenvolvimento/teste.",
  );
const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: {
    rejectUnauthorized: true,
    ca: readFileSync("certs/supabase-ca.crt", "utf8"),
  },
  connectionTimeoutMillis: 15000,
});
const id = randomUUID();
const email = `web-smoke-${id}@example.invalid`;
const password = randomBytes(24).toString("base64url");
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
    `insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    recovery_token,confirmation_token,email_change,email_change_token_new,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated',$2,
    extensions.crypt($3,extensions.gen_salt('bf')),now(),'','','','',
    '{"provider":"email","providers":["email"]}', '{"display_name":"Teste de autenticação"}',now(),now())`,
    [id, email, password],
  );
  created = true;
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  assert.equal(error, null, `Login: ${error?.code ?? "ok"}`);
  assert.equal(data.user.id, id);
  const profile = await db.query(
    "select display_name from app.profiles where user_id=$1",
    [id],
  );
  assert.equal(profile.rows[0].display_name, "Teste de autenticação");
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/v1/me/tenants`,
    { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [] });
  assert.equal((await client.auth.signOut()).error, null);
  const invalid = await client.auth.signInWithPassword({
    email,
    password: password + "wrong",
  });
  assert.equal(invalid.error?.code, "invalid_credentials");
  console.log(
    "OK: login real, perfil persistido, JWT aceito pela API, nenhum restaurante concedido, logout e senha inválida.",
  );
} finally {
  await client.auth.signOut().catch(() => {});
  if (created) {
    await db.query("delete from app.profiles where user_id=$1", [id]);
    await db.query("delete from auth.users where id=$1", [id]);
  }
  await db.end();
}
