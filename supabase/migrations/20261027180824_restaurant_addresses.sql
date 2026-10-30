-- Keep the original free-text address for existing restaurants and display compatibility.
alter table app.tenants drop constraint tenants_address_check;
alter table app.tenants add constraint tenants_address_check check (address is null or length(btrim(address)) between 3 and 1000);

create table app.restaurant_addresses (
 tenant_id uuid primary key references app.tenants(id) on delete cascade,
 postal_code text not null check (postal_code ~ '^[0-9]{8}$'),
 state text not null check (state in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
 city text not null check (length(btrim(city)) between 1 and 160),
 neighborhood text not null check (length(btrim(neighborhood)) between 1 and 160),
 street text not null check (length(btrim(street)) between 1 and 200),
 number text not null check (length(btrim(number)) between 1 and 20),
 complement text not null default '' check (length(complement)<=160),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table app.restaurant_addresses enable row level security;
alter table app.restaurant_addresses force row level security;
revoke all on app.restaurant_addresses from public,anon,authenticated,comandei_api;
grant select,insert,update on app.restaurant_addresses to comandei_api;
create trigger touch_updated_at before update on app.restaurant_addresses for each row execute function app.touch_updated_at();
create function app.guard_address_tenant() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.tenant_id is distinct from old.tenant_id then
  raise exception 'Restaurant cannot be reassigned' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function app.guard_address_tenant() from public,anon,authenticated;
create trigger guard_tenant_id before update on app.restaurant_addresses for each row execute function app.guard_address_tenant();
create policy address_read on app.restaurant_addresses for select to comandei_api
 using (tenant_id=nullif((select current_setting('app.tenant_id',true)),'')::uuid and exists (
 select 1 from app.memberships m where m.tenant_id=restaurant_addresses.tenant_id
 and m.user_id=nullif((select current_setting('app.user_id',true)),'')::uuid and m.status='active'));
create policy address_insert on app.restaurant_addresses for insert to comandei_api
 with check (tenant_id=nullif((select current_setting('app.tenant_id',true)),'')::uuid and exists (
 select 1 from app.memberships m join app.tenants t on t.id=m.tenant_id where m.tenant_id=restaurant_addresses.tenant_id
 and m.user_id=nullif((select current_setting('app.user_id',true)),'')::uuid and m.status='active' and m.role='owner' and t.status='active'));
create policy address_update on app.restaurant_addresses for update to comandei_api
 using (tenant_id=nullif((select current_setting('app.tenant_id',true)),'')::uuid and exists (
 select 1 from app.memberships m join app.tenants t on t.id=m.tenant_id where m.tenant_id=restaurant_addresses.tenant_id
 and m.user_id=nullif((select current_setting('app.user_id',true)),'')::uuid and m.status='active' and m.role='owner' and t.status='active'))
 with check (tenant_id=nullif((select current_setting('app.tenant_id',true)),'')::uuid and exists (
 select 1 from app.memberships m join app.tenants t on t.id=m.tenant_id where m.tenant_id=restaurant_addresses.tenant_id
 and m.user_id=nullif((select current_setting('app.user_id',true)),'')::uuid and m.status='active' and m.role='owner' and t.status='active'));

create or replace function app.my_restaurants() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'status',t.status,'role',m.role,
 'address',t.address,'address_details',(select to_jsonb(a) - 'tenant_id' - 'created_at' - 'updated_at' from app.restaurant_addresses a where a.tenant_id=t.id),'cnpj',t.cnpj,'opens_at',t.opens_at,'closes_at',t.closes_at,
 'service_type',t.service_type,'photo_path',t.photo_path,'version',t.version) order by t.name,t.id),'[]'::jsonb)
 from app.tenants t join app.memberships m on m.tenant_id=t.id
 where m.user_id=nullif(current_setting('app.user_id',true),'')::uuid and m.status='active' and t.status<>'closed';
$$;
revoke all on function app.my_restaurants() from public,anon,authenticated;
grant execute on function app.my_restaurants() to comandei_api;

create or replace function app.register_restaurant(p_body jsonb,p_key text,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=nullif(current_setting('app.user_id',true),'')::uuid;
 result uuid; previous app.idempotency_records;
begin
 if not app.can_register_restaurant() then raise exception 'Administrator required' using errcode='42501'; end if;
 if p_key is null or p_hash is null or length(p_key) not between 8 and 128 or p_hash !~ '^[a-f0-9]{64}$' then
 raise exception 'Invalid idempotency key' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended('register:'||actor::text||':'||p_key,0));
 select * into previous from app.idempotency_records where user_id=actor and endpoint='POST /v1/restaurants' and key=p_key;
 if found then
  if previous.body_hash<>p_hash then raise exception 'Idempotency mismatch' using errcode='23505'; end if;
  return previous.result||jsonb_build_object('replayed',true);
 end if;
 result:=gen_random_uuid();
 insert into app.tenants(id,name,slug,address,cnpj,opens_at,closes_at,service_type)
 values(result,p_body->>'name','r-'||replace(result::text,'-',''),p_body->>'address',p_body->>'cnpj',
 (p_body->>'opens_at')::time,(p_body->>'closes_at')::time,p_body->>'service_type');
 if jsonb_typeof(p_body->'address_details') = 'object' then
  insert into app.restaurant_addresses(tenant_id,postal_code,state,city,neighborhood,street,number,complement)
  values(result,p_body->'address_details'->>'postal_code',p_body->'address_details'->>'state',
   p_body->'address_details'->>'city',p_body->'address_details'->>'neighborhood',
   p_body->'address_details'->>'street',p_body->'address_details'->>'number',
   coalesce(p_body->'address_details'->>'complement',''));
 end if;
 insert into app.memberships(tenant_id,user_id,role) values(result,actor,'owner');
 insert into app.tenant_entitlements(tenant_id,limits) values(result,'{"max_users":25,"max_tables":100}');
 insert into app.audit_events(tenant_id,actor_id,action,resource_type,resource_id,request_id)
 values(result,actor,'restaurants.created','tenant',result,gen_random_uuid());
 insert into app.outbox_events(tenant_id,type,aggregate_id,aggregate_version,payload)
 values(result,'restaurants.created',result,1,'{"aggregate_type":"tenant"}');
 insert into app.idempotency_records(tenant_id,user_id,endpoint,key,body_hash,result,http_status)
 values(result,actor,'POST /v1/restaurants',p_key,p_hash,jsonb_build_object('id',result),201);
 return jsonb_build_object('id',result,'replayed',false);
end $$;
revoke all on function app.register_restaurant(jsonb,text,text) from public,anon,authenticated;
grant execute on function app.register_restaurant(jsonb,text,text) to comandei_api;

