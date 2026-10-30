create function app.check_employee_login(p_tenant uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor uuid:=nullif(current_setting('app.user_id',true),'')::uuid; max_users integer;
begin
 perform 1 from app.tenants where id=p_tenant and status='active' for update;
 if not found or not exists(select 1 from app.memberships where tenant_id=p_tenant
   and user_id=actor and status='active' and role in ('owner','manager')) then
   raise exception 'Forbidden' using errcode='42501'; end if;
 select coalesce((limits->>'max_users')::integer,25) into max_users
 from app.tenant_entitlements where tenant_id=p_tenant;
 if (select count(*) from app.memberships where tenant_id=p_tenant and status='active')>=coalesce(max_users,25) then
   raise exception 'User limit' using errcode='23514'; end if;
 return true;
end $$;
create function app.add_employee_login(p_tenant uuid,p_user uuid,p_role text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 perform app.check_employee_login(p_tenant);
 if p_role is null or p_role not in ('waiter','cashier') then
   raise exception 'Forbidden' using errcode='42501'; end if;
 insert into app.memberships(tenant_id,user_id,role,invited_by)
 values(p_tenant,p_user,p_role,nullif(current_setting('app.user_id',true),'')::uuid)
 returning id into result;
 return result;
end $$;
revoke all on function app.check_employee_login(uuid),app.add_employee_login(uuid,uuid,text) from public,anon,authenticated;
grant execute on function app.check_employee_login(uuid),app.add_employee_login(uuid,uuid,text) to comandei_api;
