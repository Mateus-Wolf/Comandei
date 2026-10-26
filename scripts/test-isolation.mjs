import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { ca: readFileSync('certs/supabase-ca.crt', 'utf8'), rejectUnauthorized: true } });
const [userA,userB,tenantA,tenantB,tableA,tableB,categoryB] = Array.from({length:7}, randomUUID);
async function context(user, tenant) {
  await client.query("select set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)", [user,tenant]);
}
async function denied(sql, params, code) {
  await client.query('savepoint negative_case');
  let caught;
  try { await client.query(sql,params); } catch (error) { caught = error; }
  await client.query('rollback to savepoint negative_case');
  assert.equal(caught?.code,code, `Expected SQLSTATE ${code}, got ${caught?.code ?? 'success'}`);
}
try {
  await client.connect();
  await client.query('begin');
  // Test-only Auth identities. No network signup, email or persistent data.
  await client.query('insert into auth.users(id) values ($1),($2)',[userA,userB]);
  await client.query("insert into app.tenants(id,name,slug) values ($1,'Test A',$3),($2,'Test B',$4)",[tenantA,tenantB,`test-${tenantA}`,`test-${tenantB}`]);
  await client.query("insert into app.memberships(tenant_id,user_id,role) values ($1,$2,'owner'),($3,$4,'owner')",[tenantA,userA,tenantB,userB]);
  await client.query("insert into app.dining_tables(id,tenant_id,code,name) values ($1,$2,'1','Table A'),($3,$4,'1','Table B')",[tableA,tenantA,tableB,tenantB]);
  await client.query("insert into app.categories(id,tenant_id,name) values ($1,$2,'B only')",[categoryB,tenantB]);
  await client.query('set local role comandei_api');
  assert.equal((await client.query('select * from app.dining_tables')).rowCount,0);
  await context(userA,tenantA);
  assert.deepEqual((await client.query('select id from app.dining_tables')).rows,[{id:tableA}]);
  assert.equal((await client.query('select * from app.memberships')).rowCount,1);
  await client.query("insert into app.dining_tables(tenant_id,code,name) values ($1,'2','Own table')",[tenantA]);
  await denied("insert into app.dining_tables(tenant_id,code,name) values ($1,'2','Foreign table')",[tenantB],'42501');
  await denied("update app.dining_tables set tenant_id=$1 where id=$2",[tenantB,tableA],'23514');
  await denied("insert into app.products(tenant_id,category_id,name,price_cents) values ($1,$2,'Cross-tenant',100)",[tenantA,categoryB],'23503');
  await denied("update app.memberships set role='manager' where user_id=$1",[userA],'42501');
  await denied('delete from app.dining_tables where id=$1',[tableA],'42501');
  await client.query("insert into app.tabs(tenant_id,table_id,number,opened_by,business_date) values ($1,$2,1,$3,current_date)",[tenantA,tableA,userA]);
  await denied('update app.tabs set opened_by=$1 where tenant_id=$2',[userB,tenantA],'23514');
  await denied("insert into app.tabs(tenant_id,table_id,number,opened_by,business_date) values ($1,$2,2,$3,current_date)",[tenantA,tableA,userA],'23505');
  // Forging a tenant context alone never grants membership.
  await context(userA,tenantB);
  assert.equal((await client.query('select * from app.dining_tables')).rowCount,0);
  // Same pooled connection reused by a different identity.
  await context(userB,tenantB);
  assert.deepEqual((await client.query('select id from app.dining_tables')).rows,[{id:tableB}]);
  await client.query('reset role');
  await client.query("update app.memberships set status='blocked' where user_id=$1",[userB]);
  await client.query('set local role comandei_api');
  assert.equal((await client.query('select * from app.dining_tables')).rowCount,0);
  await client.query('rollback');
  await client.query('begin');
  await client.query('set local role comandei_api');
  assert.equal((await client.query('select * from app.dining_tables')).rowCount,0);
  await client.query('rollback');
  console.log('OK: isolamento A/B, escrita própria, escrita cruzada negada, FK composta, identidade imutável, privilégios, mesa ativa única, vínculo bloqueado e contexto limpo após rollback. Fixtures descartadas.');
} catch(error) {
  await client.query('rollback').catch(()=>{});
  console.error('Teste falhou:',error.code ?? error.name,error.message);
  process.exitCode=1;
} finally { await client.end(); }
