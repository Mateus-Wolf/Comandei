-- Allows administration/tests to exercise the real runtime role with SET ROLE.
-- Does not grant any administrative capability to the runtime.
grant comandei_api to postgres;

create function app.guard_immutable_fields() returns trigger language plpgsql
set search_path = '' as $$
declare field text;
begin
 foreach field in array tg_argv loop
  if (to_jsonb(new) -> field) is distinct from (to_jsonb(old) -> field) then
   raise exception 'Field % is immutable on %', field, tg_table_name using errcode = '23514';
  end if;
 end loop;
 return new;
end $$;
revoke all on function app.guard_immutable_fields() from public;

create trigger immutable_order_item before update on app.order_items
 for each row execute function app.guard_immutable_fields('order_id','product_id','name_snapshot','unit_price_cents','unit_snapshot','quantity','notes');
create trigger immutable_item_modifier before update on app.order_item_modifiers
 for each row execute function app.guard_immutable_fields('item_id','option_id','name_snapshot','unit_price_cents','quantity');
create trigger immutable_order_origin before update on app.orders
 for each row execute function app.guard_immutable_fields('tab_id','sequence','submitted_by','submitted_at');
create trigger immutable_tab_origin before update on app.tabs
 for each row execute function app.guard_immutable_fields('opened_by','opened_at','business_date','number');
create trigger immutable_settlement before update on app.tab_settlements
 for each row execute function app.guard_immutable_fields('tab_id','revision','subtotal_cents','discount_cents','service_cents','service_rate_bps','total_cents');
create trigger immutable_approval_payload before update on app.approval_requests
 for each row execute function app.guard_immutable_fields('action','resource_type','resource_id','expected_version','payload','payload_hash','requested_by','expires_at');
create trigger immutable_adjustment before update on app.adjustments
 for each row execute function app.guard_immutable_fields('tab_id','type','base_cents','rule_snapshot','amount_cents','reason','requested_by','approved_by');
create trigger immutable_idempotency before update on app.idempotency_records
 for each row execute function app.guard_immutable_fields('user_id','endpoint','key','body_hash','result','http_status','expires_at');
create trigger immutable_outbox_payload before update on app.outbox_events
 for each row execute function app.guard_immutable_fields('event_id','type','aggregate_id','aggregate_version','payload');
