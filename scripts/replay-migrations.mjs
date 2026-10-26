import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const db=new PGlite();
try {
  await db.exec(readFileSync('tests/bootstrap-postgres.sql','utf8'));
  const files=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort();
  for (const file of files) await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
  const {rows}=await db.query("select count(*)::int as count, bool_and(rowsecurity) as rls from pg_tables where schemaname='app'");
  assert.equal(rows[0].count,27);
  assert.equal(rows[0].rls,true);
  console.log(`OK: ${files.length} migrations aplicadas em PostgreSQL embarcado vazio; 27 tabelas com RLS.`);
} finally { await db.close(); }
