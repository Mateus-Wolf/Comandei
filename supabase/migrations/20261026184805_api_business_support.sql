alter table app.tenants
 add column version bigint not null default 1 check(version>0),
 add column service_rate_bps integer not null default 1000 check(service_rate_bps between 0 and 10000),
 add column cashier_discount_limit_bps integer not null default 0 check(cashier_discount_limit_bps between 0 and 10000),
 add column manager_discount_limit_bps integer not null default 1000 check(manager_discount_limit_bps between 0 and 10000),
 add column cash_difference_tolerance_cents bigint not null default 0 check(cash_difference_tolerance_cents>=0);
alter table app.tabs add column service_accepted boolean not null default true;
alter table app.cash_sessions add column version bigint not null default 1 check(version>0);
alter table app.order_items add column cancelled_at timestamptz, add column cancellation_reason text,
 add column cancelled_by uuid references auth.users(id);
create index order_items_cancelled_by_idx on app.order_items(cancelled_by);
alter table app.product_modifier_groups add column active boolean not null default true;
do $$ declare t text; begin
 foreach t in array array['dining_tables','categories','modifier_groups','modifier_options','product_modifier_groups','cash_registers'] loop
  execute format('alter table app.%I add column version bigint not null default 1 check(version>0)',t);
 end loop;
end $$;
alter table app.background_jobs add column requested_by uuid references auth.users(id),
 add column payload jsonb not null default '{}', add column result_data text,
 add column expires_at timestamptz not null default (now()+interval '24 hours'),
 add column lease_owner uuid;
create index background_jobs_requested_by_idx on app.background_jobs(requested_by);
create index background_jobs_pending_idx on app.background_jobs(available_at,created_at) where status in ('pending','running');
alter table app.outbox_events add column lease_owner uuid, add column failed_at timestamptz,
 add column last_error text;

grant update(name,timezone,business_day_cutoff,version,service_rate_bps,cashier_discount_limit_bps,
 manager_discount_limit_bps,cash_difference_tolerance_cents) on app.tenants to comandei_api;

-- Narrow privileged operations live only in the private schema, with fixed search paths.
create function app.session_is_active(p_session uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.sessions s where s.id=p_session
  and s.user_id=nullif(current_setting('app.user_id',true),'')::uuid
  and (s.not_after is null or s.not_after>now()));
$$;

create function app.my_tenants() returns table(id uuid,name text,slug text,status text,role text)
language sql stable security definer set search_path='' as $$
 select t.id,t.name,t.slug,t.status,m.role from app.tenants t join app.memberships m on m.tenant_id=t.id
 where m.user_id=nullif(current_setting('app.user_id',true),'')::uuid and m.status='active' and t.status<>'closed';
$$;

create function app.staff_list(p_tenant uuid) returns table(user_id uuid,display_name text,role text,status text)
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from app.memberships m where m.tenant_id=p_tenant
 and m.user_id=nullif(current_setting('app.user_id',true),'')::uuid and m.status='active' and m.role in ('owner','manager')) then
  raise exception 'Forbidden' using errcode='42501'; end if;
 return query select m.user_id,p.display_name,m.role,m.status from app.memberships m
 left join app.profiles p on p.user_id=m.user_id where m.tenant_id=p_tenant order by m.user_id;
end $$;

create function app.change_member(p_tenant uuid,p_user uuid,p_role text,p_status text) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=nullif(current_setting('app.user_id',true),'')::uuid; actor_role text; target app.memberships; result uuid; max_users integer;
begin
 perform 1 from app.tenants where id=p_tenant for update;
 select role into actor_role from app.memberships where tenant_id=p_tenant and user_id=actor and status='active';
 select * into target from app.memberships where tenant_id=p_tenant and user_id=p_user for update;
 if actor_role is null or actor_role not in ('owner','manager') or target.id is null then
  raise exception 'Forbidden' using errcode='42501'; end if;
 if p_role not in ('owner','manager','cashier','waiter') or p_status not in ('active','blocked','revoked') then
  raise exception 'Invalid member state' using errcode='23514'; end if;
 if actor_role='manager' and (target.role not in ('waiter','cashier') or p_role not in ('waiter','cashier')) then
  raise exception 'Forbidden' using errcode='42501'; end if;
 if target.role='owner' and target.status='active' and (p_role<>'owner' or p_status<>'active')
 and (select count(*) from app.memberships where tenant_id=p_tenant and role='owner' and status='active')<=1 then
  raise exception 'Last active owner' using errcode='23514'; end if;
 if p_status='active' and target.status<>'active' then
  select coalesce((limits->>'max_users')::integer,25) into max_users from app.tenant_entitlements where tenant_id=p_tenant;
  if (select count(*) from app.memberships where tenant_id=p_tenant and status='active')>=coalesce(max_users,25) then
   raise exception 'User limit' using errcode='23514'; end if;
 end if;
 update app.memberships set role=p_role,status=p_status where id=target.id returning id into result;
 return result;
end $$;

create function app.invite_member(p_tenant uuid,p_email text,p_role text,p_hash text) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=nullif(current_setting('app.user_id',true),'')::uuid; actor_role text; result uuid;
begin
 perform 1 from app.tenants where id=p_tenant and status='active' for update;
 if not found then raise exception 'Tenant unavailable' using errcode='42501'; end if;
 select role into actor_role from app.memberships where tenant_id=p_tenant and user_id=actor and status='active';
 if actor_role is null or actor_role not in ('owner','manager') or p_role not in ('owner','manager','cashier','waiter')
 or (actor_role='manager' and p_role not in ('cashier','waiter')) then
  raise exception 'Forbidden' using errcode='42501'; end if;
 insert into app.invitations(tenant_id,email,role,token_hash,expires_at,invited_by)
 values(p_tenant,lower(trim(p_email)),p_role,p_hash,now()+interval '48 hours',actor) returning id into result;
 return result;
end $$;
-- Owner invitations are allowed only by the guarded function.
alter table app.invitations drop constraint invitations_role_check;
alter table app.invitations add constraint invitations_role_check check(role in ('owner','manager','cashier','waiter'));

create function app.accept_invitation(p_hash text) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=nullif(current_setting('app.user_id',true),'')::uuid; inv app.invitations; target uuid; max_users integer;
begin
 select tenant_id into target from app.invitations where token_hash=p_hash;
 perform 1 from app.tenants where id=target and status='active' for update;
 if not found then raise exception 'Invalid invitation' using errcode='42501'; end if;
 select * into inv from app.invitations where token_hash=p_hash for update;
 if inv.id is null or inv.consumed_at is not null or inv.expires_at<=now() or not exists(
  select 1 from auth.users u where u.id=actor and lower(u.email)=inv.email and u.email_confirmed_at is not null) then
  raise exception 'Invalid invitation' using errcode='42501'; end if;
 if exists(select 1 from app.memberships where tenant_id=inv.tenant_id and user_id=actor) then
  raise exception 'Membership already exists; explicit management required' using errcode='23514'; end if;
 select coalesce((limits->>'max_users')::integer,25) into max_users from app.tenant_entitlements where tenant_id=inv.tenant_id;
 if (select count(*) from app.memberships where tenant_id=inv.tenant_id and status='active')>=coalesce(max_users,25) then
  raise exception 'User limit' using errcode='23514'; end if;
 insert into app.memberships(tenant_id,user_id,role,invited_by) values(inv.tenant_id,actor,inv.role,inv.invited_by);
 insert into app.profiles(user_id,display_name) values(actor,split_part(inv.email,'@',1)) on conflict(user_id) do nothing;
 update app.invitations set consumed_at=now() where id=inv.id;
 return inv.tenant_id;
end $$;

create table app.request_buckets(key text primary key,window_start timestamptz not null,requests integer not null);
alter table app.request_buckets enable row level security;
alter table app.request_buckets force row level security;
revoke all on app.request_buckets from public,anon,authenticated,comandei_api;
create function app.consume_rate_limit(p_key text) returns boolean
language plpgsql security definer set search_path='' as $$
declare hits integer;
begin
 if length(p_key)>100 or nullif(current_setting('app.user_id',true),'') is null then
  raise exception 'Invalid context' using errcode='42501'; end if;
 insert into app.request_buckets as b(key,window_start,requests) values(p_key,date_trunc('minute',now()),1)
 on conflict(key) do update set requests=case when b.window_start=date_trunc('minute',now()) then b.requests+1 else 1 end,
 window_start=date_trunc('minute',now()) returning requests into hits;
 return hits<=120;
end $$;

create role comandei_platform nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
create role comandei_worker nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
grant usage on schema app to comandei_platform,comandei_worker;
grant comandei_platform,comandei_worker to postgres;

create function app.platform_provision(p_name text,p_slug text,p_owner uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; actor uuid:=nullif(current_setting('app.user_id',true),'')::uuid;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor) then
  raise exception 'Invalid operator' using errcode='42501'; end if;
 insert into app.tenants(name,slug) values(p_name,p_slug) returning id into result;
 insert into app.profiles(user_id,display_name) select id,split_part(email,'@',1) from auth.users where id=p_owner on conflict do nothing;
 insert into app.memberships(tenant_id,user_id,role) values(result,p_owner,'owner');
 insert into app.tenant_entitlements(tenant_id,limits) values(result,'{"max_users":25,"max_tables":100}');
 insert into app.audit_events(tenant_id,actor_id,action,resource_type,resource_id,request_id)
 values(result,actor,'platform.provision','tenant',result,gen_random_uuid());
 return result;
end $$;
create function app.platform_tenants() returns table(id uuid,name text,slug text,status text,plan text)
language sql stable security definer set search_path='' as $$
 select t.id,t.name,t.slug,t.status,e.plan from app.tenants t left join app.tenant_entitlements e on e.tenant_id=t.id
 where nullif(current_setting('app.user_id',true),'')::uuid is not null order by t.id limit 1000;
$$;
create function app.platform_plan(p_tenant uuid,p_status text,p_plan text,p_limits jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=nullif(current_setting('app.user_id',true),'')::uuid;
begin
 if actor is null then raise exception 'Invalid operator' using errcode='42501'; end if;
 update app.tenants set status=p_status,version=version+1 where id=p_tenant;
 if not found then raise exception 'Tenant missing' using errcode='P0002'; end if;
 update app.tenant_entitlements set plan=p_plan,limits=p_limits,
 status=case when p_status='active' then 'active' else 'suspended' end where tenant_id=p_tenant;
 insert into app.audit_events(tenant_id,actor_id,action,resource_type,resource_id,request_id,after_summary)
 values(p_tenant,actor,'platform.plan','tenant',p_tenant,gen_random_uuid(),jsonb_build_object('status',p_status,'plan',p_plan));
end $$;

-- Private Broadcast authorization: only current members can subscribe to their exact topic.
grant usage on schema app to authenticated;
grant select(user_id,tenant_id,status) on app.memberships to authenticated;
create policy membership_realtime_self on app.memberships for select to authenticated
 using(user_id=(select auth.uid()));
create policy comandei_receive_broadcast on realtime.messages for select to authenticated
 using(extension='broadcast' and exists(select 1 from app.memberships m where m.user_id=(select auth.uid())
  and m.status='active' and (select realtime.topic())='tenant:'||m.tenant_id::text||':operations'));

-- All elevated functions have explicit execution grants; no public or browser execution.
revoke all on all functions in schema app from public,anon,authenticated;
grant execute on function app.session_is_active(uuid),app.my_tenants(),app.staff_list(uuid),
 app.change_member(uuid,uuid,text,text),app.invite_member(uuid,text,text,text),app.accept_invitation(text),
 app.consume_rate_limit(text) to comandei_api;
grant execute on function app.platform_provision(text,text,uuid),app.platform_tenants(),
 app.platform_plan(uuid,text,text,jsonb),app.session_is_active(uuid) to comandei_platform;

create function app.claim_outbox(p_owner uuid) returns setof app.outbox_events
language plpgsql security definer set search_path='' as $$
begin
 delete from app.request_buckets where window_start<now()-interval '1 day';
 return query with batch as(select id from app.outbox_events where delivered_at is null and failed_at is null
 and attempts<10 and available_at<=now() and (lease_until is null or lease_until<now())
 order by available_at,created_at for update skip locked limit 10)
 update app.outbox_events e set lease_owner=p_owner,lease_until=now()+interval '120 seconds',attempts=e.attempts+1
 from batch where e.id=batch.id returning e.*;
end $$;
create function app.finish_outbox(p_id uuid,p_owner uuid,p_success boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update app.outbox_events set delivered_at=case when p_success then now() else null end,
 failed_at=case when not p_success and attempts>=10 then now() else null end,
 last_error=case when p_success then null else 'BROADCAST_DELIVERY_FAILED' end,
 available_at=now()+make_interval(secs=>least(300,power(2,attempts)::integer)+floor(random()*5)::integer),
 lease_until=null,lease_owner=null where id=p_id and lease_owner=p_owner and lease_until>now();
 return found;
end $$;
create function app.claim_jobs(p_owner uuid) returns setof app.background_jobs
language plpgsql security definer set search_path='' as $$
begin
 update app.background_jobs set result_data=null where expires_at<now() and result_data is not null;
 update app.background_jobs set status='failed',sanitized_error='RETRY_LIMIT' where status='running'
 and attempts>=5 and lease_until<now();
 return query with batch as(select id from app.background_jobs where status in ('pending','running')
 and attempts<5 and expires_at>now() and available_at<=now() and (lease_until is null or lease_until<now())
 order by created_at for update skip locked limit 5)
 update app.background_jobs j set status='running',lease_owner=p_owner,lease_until=now()+interval '120 seconds',attempts=j.attempts+1
 from batch where j.id=batch.id returning j.*;
end $$;
create function app.export_rows(p_job uuid,p_owner uuid) returns table(business_date date,payment_id uuid,
 tab_number bigint,type text,method text,amount_cents bigint,external_reference text)
language plpgsql security definer set search_path='' as $$
declare job app.background_jobs; start_date date; end_date date;
begin
 select * into job from app.background_jobs where id=p_job and lease_owner=p_owner
 and lease_until>now() and status='running' and expires_at>now() and type='payments_csv';
 if job.id is null or not exists(select 1 from app.memberships where tenant_id=job.tenant_id
 and user_id=job.requested_by and status='active' and role='owner') then
  raise exception 'Export no longer authorized' using errcode='42501'; end if;
 start_date:=(job.payload->>'start_date')::date; end_date:=(job.payload->>'end_date')::date;
 if end_date<start_date or end_date-start_date>30 then raise exception 'Invalid period' using errcode='23514'; end if;
 if (select count(*) from app.payment_entries p join app.cash_sessions c on c.tenant_id=p.tenant_id and c.id=p.cash_session_id
 where p.tenant_id=job.tenant_id and c.business_date between start_date and end_date)>10000 then
  raise exception 'Export row limit' using errcode='54000'; end if;
 return query select c.business_date,p.id,t.number,p.type,p.method,p.amount_cents,p.external_reference
 from app.payment_entries p join app.cash_sessions c on c.tenant_id=p.tenant_id and c.id=p.cash_session_id
 join app.tabs t on t.tenant_id=p.tenant_id and t.id=p.tab_id
 where p.tenant_id=job.tenant_id and c.business_date between start_date and end_date order by p.created_at,p.id;
end $$;
create function app.finish_job(p_id uuid,p_owner uuid,p_data text,p_error text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if length(p_data)>10000000 then raise exception 'Result limit' using errcode='54000'; end if;
 update app.background_jobs set status=case when p_error is null then 'completed' else 'failed' end,
 result_data=case when p_error is null then p_data else null end,
 sanitized_error=case when p_error is null then null else 'EXPORT_FAILED' end,
 result_reference=case when p_error is null then id::text else null end,
 lease_until=null,lease_owner=null where id=p_id and lease_owner=p_owner and lease_until>now() and expires_at>now();
 return found;
end $$;
revoke all on function app.claim_outbox(uuid),app.finish_outbox(uuid,uuid,boolean),app.claim_jobs(uuid),
 app.export_rows(uuid,uuid),app.finish_job(uuid,uuid,text,text) from public,anon,authenticated,comandei_api;
grant execute on function app.claim_outbox(uuid),app.finish_outbox(uuid,uuid,boolean),app.claim_jobs(uuid),
 app.export_rows(uuid,uuid),app.finish_job(uuid,uuid,text,text) to comandei_worker;
