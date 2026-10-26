alter table app.tenants
 add column address text check (address is null or length(btrim(address)) between 3 and 500),
 add column cnpj text check (cnpj is null or cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
 add column opens_at time,
 add column closes_at time,
 add column service_type text not null default 'alacarte' check (service_type in ('rodizio','alacarte','both')),
 add column photo_path text check (photo_path is null or (split_part(photo_path,'/',1)=id::text and photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'));
create unique index tenants_cnpj_unique on app.tenants(cnpj) where cnpj is not null;

-- Trusted bootstrap administrators; browser metadata cannot grant this privilege.
create table app.restaurant_administrators (
 user_id uuid primary key references auth.users(id),
 created_at timestamptz not null default now()
);
alter table app.restaurant_administrators enable row level security;
alter table app.restaurant_administrators force row level security;
revoke all on app.restaurant_administrators from public,anon,authenticated,comandei_api;
grant select on app.restaurant_administrators to comandei_api;
create policy administrator_self on app.restaurant_administrators for select to comandei_api
 using (user_id=nullif(current_setting('app.user_id',true),'')::uuid);

create function app.can_register_restaurant() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u where u.id=nullif(current_setting('app.user_id',true),'')::uuid
 and u.email_confirmed_at is not null and (
 exists(select 1 from app.restaurant_administrators a where a.user_id=u.id) or
 exists(select 1 from app.memberships m join app.tenants t on t.id=m.tenant_id
 where m.user_id=u.id and m.role='owner' and m.status='active' and t.status='active')));
$$;
revoke all on function app.can_register_restaurant() from public,anon,authenticated;
grant execute on function app.can_register_restaurant() to comandei_api;

create function app.my_restaurants() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'status',t.status,'role',m.role,
 'address',t.address,'cnpj',t.cnpj,'opens_at',t.opens_at,'closes_at',t.closes_at,
 'service_type',t.service_type,'photo_path',t.photo_path,'version',t.version) order by t.name,t.id),'[]'::jsonb)
 from app.tenants t join app.memberships m on m.tenant_id=t.id
 where m.user_id=nullif(current_setting('app.user_id',true),'')::uuid and m.status='active' and t.status<>'closed';
$$;
revoke all on function app.my_restaurants() from public,anon,authenticated;
grant execute on function app.my_restaurants() to comandei_api;

create function app.register_restaurant(p_body jsonb,p_key text,p_hash text) returns jsonb
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

-- Defense in depth: a manager cannot bypass the API to mutate table layout.
create function app.guard_table_administrator() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (session_user='comandei_api' or current_setting('role',true)='comandei_api') and not exists(select 1 from app.memberships
 where tenant_id=new.tenant_id and user_id=nullif(current_setting('app.user_id',true),'')::uuid
 and role='owner' and status='active') then
 raise exception 'Administrator required' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function app.guard_table_administrator() from public,anon,authenticated;
create trigger table_administrator before insert or update on app.dining_tables
for each row execute function app.guard_table_administrator();
grant update(address,cnpj,opens_at,closes_at,service_type,photo_path) on app.tenants to comandei_api;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('restaurant-photos','restaurant-photos',false,5242880,array['image/jpeg','image/png','image/webp']);
create function app.restaurant_photo_access(p_path text,p_edit boolean) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from app.memberships m join app.tenants t on t.id=m.tenant_id
 where m.tenant_id::text=split_part(p_path,'/',1) and m.user_id=(select auth.uid())
 and m.status='active' and t.status<>'closed' and (not p_edit or (m.role='owner' and t.status='active')));
$$;
revoke all on function app.restaurant_photo_access(text,boolean) from public,anon;
grant execute on function app.restaurant_photo_access(text,boolean) to authenticated;
create policy restaurant_photos_read on storage.objects for select to authenticated
 using(bucket_id='restaurant-photos' and app.restaurant_photo_access(name,false));
create policy restaurant_photos_insert on storage.objects for insert to authenticated
 with check(bucket_id='restaurant-photos' and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$' and app.restaurant_photo_access(name,true));
create policy restaurant_photos_delete on storage.objects for delete to authenticated
 using(bucket_id='restaurant-photos' and app.restaurant_photo_access(name,true));
