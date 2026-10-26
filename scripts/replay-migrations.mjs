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
  // Signup must persist a trimmed display name without accepting authorization metadata.
  const user = '9eed52b3-7a11-4c16-a001-655c04d70f28';
  await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',
    [user, 'signup@example.invalid', {display_name: '  Ana da Silva  ', role: 'owner', tenant_id: user}]);
  const profile = await db.query('select display_name from app.profiles where user_id=$1', [user]);
  assert.equal(profile.rows[0].display_name, 'Ana da Silva');
  assert.equal((await db.query('select count(*)::int as n from app.memberships where user_id=$1',[user])).rows[0].n, 0);
  await db.query('insert into auth.users(id) values($1)', ['9eed52b3-7a11-4c16-a001-655c04d70f29']);
  assert.equal((await db.query("select display_name from app.profiles where user_id='9eed52b3-7a11-4c16-a001-655c04d70f29'")).rows[0].display_name, 'Usuário');
  console.log(`OK: ${files.length} migrations aplicadas em PostgreSQL embarcado vazio; 27 tabelas com RLS.`);
} finally { await db.close(); }
