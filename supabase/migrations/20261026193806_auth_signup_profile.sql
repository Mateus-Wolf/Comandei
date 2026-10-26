-- Display-only identity data; never derive membership, tenant or permissions from metadata.
create function app.create_signup_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into app.profiles(user_id, display_name)
  values (new.id, coalesce(nullif(left(btrim(new.raw_user_meta_data ->> 'display_name'),160), ''),
    nullif(left(split_part(new.email,'@',1),160), ''), 'Usuário'))
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function app.create_signup_profile() from public, anon, authenticated;
create trigger comandei_signup_profile after insert on auth.users
for each row execute function app.create_signup_profile();
