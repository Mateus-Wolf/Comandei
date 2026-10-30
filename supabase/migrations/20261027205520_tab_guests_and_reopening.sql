-- Occupancy and price snapshots belong to the tenant-isolated tab.
alter table app.tabs add column guests jsonb not null default '[]'::jsonb
  check (jsonb_typeof(guests) = 'array' and jsonb_array_length(guests) <= 100);
alter table app.tenants add column tab_reopen_roles text[] not null default array['cashier']::text[]
  check (tab_reopen_roles <@ array['waiter','cashier','manager','owner']::text[]);
