alter table app.adjustments add column voided_at timestamptz,
 add column voided_by uuid references auth.users(id), add column void_reason text,
 add constraint adjustment_void_audit check(
  (voided_at is null and voided_by is null and void_reason is null) or
  (voided_at is not null and voided_by is not null and void_reason is not null and btrim(void_reason)<>''));
create index adjustments_voided_by_idx on app.adjustments(voided_by);
-- Once voided, an adjustment cannot be restored or have its void attribution rewritten.
create function app.guard_adjustment_void() returns trigger language plpgsql set search_path='' as $$
begin
 if old.voided_at is not null and (new.voided_at,new.voided_by,new.void_reason)
 is distinct from (old.voided_at,old.voided_by,old.void_reason) then
  raise exception 'Adjustment void is immutable' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function app.guard_adjustment_void() from public;
create trigger immutable_adjustment_void before update on app.adjustments
 for each row execute function app.guard_adjustment_void();
