import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const db=new PGlite();
try {
  await db.exec(readFileSync('tests/bootstrap-postgres.sql','utf8'));
  const files=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort();
  for (const file of files) await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
  const {rows}=await db.query("select count(*)::int as count, bool_and(rowsecurity) as rls from pg_tables where schemaname='app'");
  assert.equal(rows[0].count,28);
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
  await db.query("select set_config('app.user_id',$1,false)",[user]);
  assert.equal((await db.query('select app.can_register_restaurant() as allowed')).rows[0].allowed,false);
  await db.query('update auth.users set email_confirmed_at=now() where id=$1',[user]);
  await db.query('insert into app.restaurant_administrators(user_id) values($1)',[user]);
  const body={name:'Casa teste',address:'Rua teste, 10',cnpj:'11222333000181',opens_at:'18:00:00',closes_at:'02:00:00',service_type:'both'};
  const registered=await db.query('select app.register_restaurant($1,$2,$3) as result',[body,'registration-test-key','a'.repeat(64)]);
  const tenant=registered.rows[0].result.id;
  const replay=await db.query('select app.register_restaurant($1,$2,$3) as result',[body,'registration-test-key','a'.repeat(64)]);
  assert.equal(replay.rows[0].result.id,tenant);
  assert.equal(replay.rows[0].result.replayed,true);
  const visible=await db.query('select app.my_restaurants() as items');
  assert.equal(visible.rows[0].items[0].service_type,'both');
  await db.query("select set_config('app.tenant_id',$1,false)",[tenant]);
  await db.exec('set role comandei_api');
  await db.query("insert into app.dining_tables(tenant_id,code,name,capacity) values($1,'1','Mesa 1',4)",[tenant]);
  await db.exec('reset role');
  await db.query("update app.memberships set role='manager' where tenant_id=$1",[tenant]);
  await db.exec('set role comandei_api');
  await assert.rejects(()=>db.query("insert into app.dining_tables(tenant_id,code,name,capacity) values($1,'2','Mesa 2',6)",[tenant]),error=>error.code==='42501');
  await db.exec('reset role');
  const photo=`${tenant}/9eed52b3-7a11-4c16-a001-655c04d70f29.jpg`;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
  await db.exec('set role authenticated');
  assert.equal((await db.query('select app.restaurant_photo_access($1,false) as allowed',[photo])).rows[0].allowed,true);
  assert.equal((await db.query('select app.restaurant_photo_access($1,true) as allowed',[photo])).rows[0].allowed,false);
  await db.exec('reset role');
  console.log(`OK: ${files.length} migrations aplicadas em PostgreSQL embarcado vazio; 28 tabelas com RLS.`);
} finally { await db.close(); }
