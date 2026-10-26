-- Minimal Supabase contracts ONLY for isolated PostgreSQL CI, never a hosted migration.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz,
 updated_at timestamptz,not_after timestamptz);
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
create schema realtime;
create table realtime.messages(id uuid primary key default gen_random_uuid(),extension text,topic text,
 payload jsonb,event text,private boolean);
alter table realtime.messages enable row level security;
grant usage on schema realtime to authenticated;
grant select on realtime.messages to authenticated;
create function realtime.topic() returns text language sql stable as $$
 select current_setting('realtime.topic',true);
$$;
create function realtime.send(payload jsonb,event text,topic text,private boolean default true) returns void
 language sql as $$ insert into realtime.messages(payload,event,topic,private,extension)
 values(payload,event,topic,private,'broadcast'); $$;
