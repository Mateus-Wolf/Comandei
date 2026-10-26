-- Fundação do modelo; fluxos financeiros e permissões por ação serão implementados na API.
create schema app;
revoke all on schema app from public, anon, authenticated;
create role comandei_api nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
grant usage on schema app to comandei_api;

create table app.tenants (
 id uuid primary key default gen_random_uuid(), name text not null check (btrim(name) <> ''),
 slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 timezone text not null default 'America/Sao_Paulo', currency text not null default 'BRL' check (currency = 'BRL'),
 status text not null default 'active' check (status in ('active','suspended','closed')),
 business_day_cutoff time not null default '04:00'
);
create table app.profiles (
 user_id uuid primary key references auth.users(id) on delete restrict,
 display_name text not null check (btrim(display_name) <> '')
);
create table app.memberships (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 user_id uuid not null references auth.users(id),
 role text not null check (role in ('owner','manager','cashier','waiter')),
 status text not null default 'active' check (status in ('active','invited','blocked','revoked')),
 invited_by uuid references auth.users(id), unique(tenant_id,id), unique(tenant_id,user_id)
);
create table app.invitations (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 email text not null check (email = lower(btrim(email))),
 role text not null check (role in ('manager','cashier','waiter')),
 token_hash text not null unique, expires_at timestamptz not null, consumed_at timestamptz,
 invited_by uuid not null references auth.users(id), unique(tenant_id,id)
);
create table app.tenant_entitlements (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null unique references app.tenants(id),
 plan text not null default 'pilot', limits jsonb not null default '{}', features jsonb not null default '{}',
 starts_at timestamptz not null default now(), ends_at timestamptz,
 status text not null default 'active' check(status in ('active','suspended','expired')),
 unique(tenant_id,id), check(ends_at is null or ends_at > starts_at)
);
create table app.dining_tables (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 code text not null, name text not null, capacity integer check(capacity > 0), active boolean not null default true,
 unique(tenant_id,id), unique(tenant_id,code)
);
create table app.categories (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 name text not null, position integer not null default 0, active boolean not null default true,
 unique(tenant_id,id), unique(tenant_id,name)
);
create table app.products (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 category_id uuid not null, sku text, name text not null,
 price_cents bigint not null check(price_cents between 0 and 9007199254740991),
 unit text not null default 'unit' check(unit in ('unit','kg','g','l','ml')),
 available boolean not null default true, active boolean not null default true,
 version bigint not null default 1 check(version > 0), unique(tenant_id,id), unique(tenant_id,sku),
 foreign key(tenant_id,category_id) references app.categories(tenant_id,id)
);
create table app.modifier_groups (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 name text not null, min_choices integer not null default 0 check(min_choices >= 0),
 max_choices integer not null default 1, active boolean not null default true,
 unique(tenant_id,id), check(max_choices >= min_choices)
);
create table app.modifier_options (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 group_id uuid not null, name text not null,
 price_cents bigint not null default 0 check(price_cents between 0 and 9007199254740991),
 active boolean not null default true, unique(tenant_id,id),
 foreign key(tenant_id,group_id) references app.modifier_groups(tenant_id,id)
);
create table app.product_modifier_groups (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 product_id uuid not null, group_id uuid not null, position integer not null default 0,
 unique(tenant_id,id), unique(tenant_id,product_id,group_id),
 foreign key(tenant_id,product_id) references app.products(tenant_id,id),
 foreign key(tenant_id,group_id) references app.modifier_groups(tenant_id,id)
);
create table app.tabs (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 table_id uuid, number bigint not null check(number > 0),
 status text not null default 'open' check(status in ('open','closing','closed','cancelled')),
 opened_by uuid not null references auth.users(id), closed_by uuid references auth.users(id),
 opened_at timestamptz not null default now(), closed_at timestamptz,
 version bigint not null default 1 check(version > 0), business_date date not null,
 unique(tenant_id,id), unique(tenant_id,business_date,number),
 foreign key(tenant_id,table_id) references app.dining_tables(tenant_id,id),
 check(closed_at is null or closed_at >= opened_at)
);
create table app.orders (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 tab_id uuid not null, sequence integer not null check(sequence > 0),
 status text not null default 'submitted' check(status in ('submitted','in_progress','completed','cancelled')),
 submitted_by uuid not null references auth.users(id), submitted_at timestamptz not null default now(),
 version bigint not null default 1 check(version > 0), unique(tenant_id,id), unique(tenant_id,tab_id,sequence),
 foreign key(tenant_id,tab_id) references app.tabs(tenant_id,id)
);
create table app.order_items (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 order_id uuid not null, product_id uuid not null, name_snapshot text not null,
 unit_price_cents bigint not null check(unit_price_cents between 0 and 9007199254740991),
 unit_snapshot text not null check(unit_snapshot in ('unit','kg','g','l','ml')),
 quantity numeric(12,3) not null check(quantity > 0), notes text,
 status text not null default 'submitted' check(status in ('submitted','preparing','ready','delivered','cancelled')),
 version bigint not null default 1 check(version > 0), unique(tenant_id,id),
 foreign key(tenant_id,order_id) references app.orders(tenant_id,id),
 foreign key(tenant_id,product_id) references app.products(tenant_id,id),
 check(unit_snapshot <> 'unit' or quantity = trunc(quantity))
);
create table app.order_item_modifiers (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 item_id uuid not null, option_id uuid not null, name_snapshot text not null,
 unit_price_cents bigint not null check(unit_price_cents between 0 and 9007199254740991),
 quantity integer not null default 1 check(quantity > 0), unique(tenant_id,id),
 foreign key(tenant_id,item_id) references app.order_items(tenant_id,id),
 foreign key(tenant_id,option_id) references app.modifier_options(tenant_id,id)
);
create table app.adjustments (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 tab_id uuid not null, type text not null check(type in ('discount','service')),
 base_cents bigint not null check(base_cents between 0 and 9007199254740991),
 rule_snapshot jsonb not null, amount_cents bigint not null check(amount_cents between 0 and 9007199254740991),
 reason text not null check(btrim(reason) <> ''), requested_by uuid not null references auth.users(id),
 approved_by uuid references auth.users(id), unique(tenant_id,id),
 foreign key(tenant_id,tab_id) references app.tabs(tenant_id,id),
 check(type <> 'discount' or amount_cents <= base_cents)
);
create table app.approval_requests (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 action text not null, resource_type text not null, resource_id uuid not null,
 expected_version bigint not null check(expected_version > 0), payload jsonb not null, payload_hash text not null,
 requested_by uuid not null references auth.users(id), approved_by uuid references auth.users(id),
 status text not null default 'pending' check(status in ('pending','executed','rejected','expired','invalidated')),
 expires_at timestamptz not null, executed_at timestamptz, unique(tenant_id,id),
 check(status <> 'executed' or (approved_by is not null and executed_at is not null))
);
create table app.tab_settlements (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 tab_id uuid not null, revision integer not null check(revision > 0),
 subtotal_cents bigint not null check(subtotal_cents between 0 and 9007199254740991),
 discount_cents bigint not null default 0 check(discount_cents between 0 and subtotal_cents),
 service_cents bigint not null default 0 check(service_cents between 0 and 9007199254740991),
 service_rate_bps integer not null default 0 check(service_rate_bps between 0 and 10000),
 total_cents bigint not null check(total_cents between 0 and 9007199254740991),
 status text not null default 'active' check(status in ('active','settled','superseded')),
 unique(tenant_id,id), unique(tenant_id,tab_id,id), unique(tenant_id,tab_id,revision),
 foreign key(tenant_id,tab_id) references app.tabs(tenant_id,id),
 check(total_cents::numeric = subtotal_cents::numeric - discount_cents + service_cents)
);
create table app.cash_registers (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 code text not null, name text not null, active boolean not null default true,
 unique(tenant_id,id), unique(tenant_id,code)
);
create table app.cash_sessions (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 register_id uuid not null, operator_id uuid not null references auth.users(id),
 status text not null default 'open' check(status in ('open','closing','closed')),
 business_date date not null, opened_at timestamptz not null default now(), closed_at timestamptz,
 initial_balance_cents bigint not null default 0 check(initial_balance_cents between 0 and 9007199254740991),
 declared_cents bigint check(declared_cents between 0 and 9007199254740991),
 expected_cents bigint check(expected_cents between -9007199254740991 and 9007199254740991),
 difference_cents bigint generated always as (declared_cents - expected_cents) stored,
 closing_reason text, unique(tenant_id,id),
 foreign key(tenant_id,register_id) references app.cash_registers(tenant_id,id),
 check(closed_at is null or closed_at >= opened_at),
 check(status <> 'closed' or (closed_at is not null and declared_cents is not null and expected_cents is not null))
);
create table app.payment_entries (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 tab_id uuid not null, settlement_id uuid not null, cash_session_id uuid not null,
 type text not null check(type in ('receipt','refund')), method text not null check(method in ('cash','pix','credit_card','debit_card','other')),
 amount_cents bigint not null check(amount_cents between 1 and 9007199254740991),
 tendered_cents bigint check(tendered_cents between 1 and 9007199254740991),
 status text not null default 'confirmed' check(status = 'confirmed'),
 external_reference text, operation_key uuid not null, original_entry_id uuid,
 recorded_by uuid not null references auth.users(id), approved_by uuid references auth.users(id), reason text,
 unique(tenant_id,id), unique(tenant_id,tab_id,id), unique(tenant_id,operation_key), unique(tenant_id,external_reference),
 foreign key(tenant_id,tab_id) references app.tabs(tenant_id,id),
 foreign key(tenant_id,tab_id,settlement_id) references app.tab_settlements(tenant_id,tab_id,id),
 foreign key(tenant_id,cash_session_id) references app.cash_sessions(tenant_id,id),
 foreign key(tenant_id,tab_id,original_entry_id) references app.payment_entries(tenant_id,tab_id,id),
 check((type = 'receipt' and original_entry_id is null) or
       (type = 'refund' and original_entry_id is not null and approved_by is not null and reason is not null and btrim(reason) <> '')),
 check(original_entry_id is distinct from id),
 check(tendered_cents is null or (type = 'receipt' and method = 'cash' and tendered_cents >= amount_cents))
);
create table app.cash_movements (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 session_id uuid not null, type text not null check(type in ('supply','withdrawal')),
 amount_cents bigint not null check(amount_cents between 1 and 9007199254740991),
 reason text not null check(btrim(reason) <> ''), actor_id uuid not null references auth.users(id),
 operation_key uuid not null, unique(tenant_id,id), unique(tenant_id,operation_key),
 foreign key(tenant_id,session_id) references app.cash_sessions(tenant_id,id)
);
create table app.audit_events (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 actor_id uuid references auth.users(id), service_name text, action text not null,
 resource_type text not null, resource_id uuid, before_summary jsonb, after_summary jsonb, reason text,
 request_id uuid not null, occurred_at timestamptz not null default now(), unique(tenant_id,id),
 check(actor_id is not null or service_name is not null)
);
create table app.outbox_events (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 event_id uuid not null unique default gen_random_uuid(), type text not null, aggregate_id uuid not null,
 aggregate_version bigint not null check(aggregate_version > 0), payload jsonb not null,
 attempts integer not null default 0 check(attempts >= 0), available_at timestamptz not null default now(),
 lease_until timestamptz, delivered_at timestamptz, unique(tenant_id,id)
);
create table app.idempotency_records (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 user_id uuid not null references auth.users(id), endpoint text not null, key text not null,
 body_hash text not null, result jsonb not null, http_status integer not null check(http_status between 100 and 599),
 expires_at timestamptz not null default (now() + interval '7 days'),
 unique(tenant_id,id), unique(tenant_id,user_id,endpoint,key)
);
create table app.background_jobs (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references app.tenants(id),
 type text not null, status text not null default 'pending' check(status in ('pending','running','completed','failed')),
 attempts integer not null default 0 check(attempts >= 0), available_at timestamptz not null default now(),
 lease_until timestamptz, result_reference text, sanitized_error text, unique(tenant_id,id)
);

create index memberships_user_status_idx on app.memberships(user_id,status,tenant_id);
create index products_catalog_idx on app.products(tenant_id,category_id,active);
create unique index tabs_one_active_table_idx on app.tabs(tenant_id,table_id)
 where table_id is not null and status in ('open','closing');
create index tabs_status_opened_idx on app.tabs(tenant_id,status,opened_at);
create index orders_tab_submitted_idx on app.orders(tenant_id,tab_id,submitted_at);
create unique index settlements_one_active_idx on app.tab_settlements(tenant_id,tab_id) where status = 'active';
create unique index cash_sessions_one_active_idx on app.cash_sessions(tenant_id,register_id) where status in ('open','closing');
create index payments_tab_created_idx on app.payment_entries(tenant_id,tab_id);
create index audit_tenant_occurred_idx on app.audit_events(tenant_id,occurred_at);
create index outbox_pending_idx on app.outbox_events(available_at) where delivered_at is null;

create function app.touch_updated_at() returns trigger language plpgsql
set search_path = '' as $$ begin new.updated_at = now(); return new; end $$;
revoke all on function app.touch_updated_at() from public;

create function app.guard_tenant_id() returns trigger language plpgsql
set search_path = '' as $$
begin
 if new.tenant_id is distinct from old.tenant_id or new.id is distinct from old.id then
   raise exception 'Tenant and record identity are immutable' using errcode = '23514';
 end if;
 return new;
end $$;
revoke all on function app.guard_tenant_id() from public;

-- Apply timestamps, isolation and indexed foreign keys to every table.
do $$
declare t record; f record; predicate text;
begin
 for t in select tablename from pg_tables where schemaname = 'app' loop
  execute format('alter table app.%I add column created_at timestamptz not null default now(), add column updated_at timestamptz not null default now()', t.tablename);
  execute format('create trigger touch_updated_at before update on app.%I for each row execute function app.touch_updated_at()', t.tablename);
  execute format('alter table app.%I enable row level security', t.tablename);
  execute format('alter table app.%I force row level security', t.tablename);
  if t.tablename not in ('tenants','profiles') then
   execute format('create trigger guard_tenant_id before update on app.%I for each row execute function app.guard_tenant_id()',t.tablename);
  end if;
  if t.tablename = 'memberships' then
   execute 'create policy membership_self_api on app.memberships for select to comandei_api using (user_id = nullif(current_setting(''app.user_id'',true),'''')::uuid)';
  elsif t.tablename = 'profiles' then
   execute 'create policy profile_self_api on app.profiles for select to comandei_api using (user_id = nullif(current_setting(''app.user_id'',true),'''')::uuid)';
  else
   predicate := format('%I = nullif(current_setting(''app.tenant_id'',true),'''')::uuid and exists (select 1 from app.memberships m where m.tenant_id = %I.%I and m.user_id = nullif(current_setting(''app.user_id'',true),'''')::uuid and m.status = ''active'')',
    case when t.tablename = 'tenants' then 'id' else 'tenant_id' end,
    t.tablename, case when t.tablename = 'tenants' then 'id' else 'tenant_id' end);
   execute format('create policy tenant_api on app.%I for all to comandei_api using (%s) with check (%s)',t.tablename,predicate,predicate);
  end if;
 end loop;
 -- One full index per FK unless an existing index has the same leading columns.
 for f in
  select c.conrelid, c.conname, c.conkey,
    (select string_agg(quote_ident(a.attname),', ' order by k.ord)
     from unnest(c.conkey) with ordinality k(num,ord)
     join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.num) cols
  from pg_constraint c join pg_namespace n on n.oid=c.connamespace
  where n.nspname='app' and c.contype='f'
 loop
  if not exists(select 1 from pg_index i where i.indrelid=f.conrelid and i.indpred is null
    and array(select unnest((i.indkey::smallint[])[0:cardinality(f.conkey)-1])) = f.conkey) then
   execute format('create index %I on %s (%s)',f.conname || '_idx',f.conrelid::regclass,f.cols);
  end if;
 end loop;
end $$;

revoke all on all tables in schema app from public, anon, authenticated;
grant select on all tables in schema app to comandei_api;
grant insert, update on app.dining_tables, app.categories, app.products, app.modifier_groups,
 app.modifier_options, app.product_modifier_groups, app.tabs, app.orders, app.order_items,
 app.order_item_modifiers, app.adjustments, app.approval_requests, app.tab_settlements,
 app.cash_registers, app.cash_sessions, app.outbox_events, app.idempotency_records, app.background_jobs to comandei_api;
grant insert on app.payment_entries, app.cash_movements, app.audit_events to comandei_api;
-- Provisioning identities, staff and commercial entitlements requires administrative tooling.
alter default privileges in schema app revoke all on tables from anon, authenticated;
alter default privileges in schema app revoke execute on functions from public;

comment on schema app is 'Private Comandei business schema. Runtime requires verified transaction-local user and tenant context.';
