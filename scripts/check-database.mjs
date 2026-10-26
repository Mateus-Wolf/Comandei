import pg from 'pg';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true, ca: readFileSync('certs/supabase-ca.crt', 'utf8') }, connectionTimeoutMillis: 15000 });
try {
  await client.connect();
  const { rows: [role] } = await client.query('select current_user, rolbypassrls, rolsuper from pg_roles where rolname = current_user');
  assert.equal(role.current_user, 'comandei_api');
  assert.equal(role.rolbypassrls, false);
  assert.equal(role.rolsuper, false);
  const { rows } = await client.query("select tablename, rowsecurity from pg_tables where schemaname = 'app'");
  assert.equal(rows.length, 26);
  assert(rows.every(row => row.rowsecurity));
  const invisible = await client.query('select * from app.dining_tables');
  assert.equal(invisible.rowCount, 0);
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } });
  assert(response.ok, `Supabase Auth health: ${response.status}`);
  const { error } = await supabase.schema('app').from('dining_tables').select('*');
  assert(error, 'Business schema must not be exposed to the browser');
  console.log('OK: conexão TLS, role restrito, 26 tabelas com RLS, bloqueio sem contexto, Auth e schema privado.');
} catch (error) {
  console.error('Falha na verificação:', error.code ?? error.name, error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[URL protegida]'));
  process.exitCode = 1;
} finally {
  await client.end();
}
