-- Evaluate transaction context once per statement rather than once per row.
do $$
declare p record; using_expr text; check_expr text;
begin
 for p in select * from pg_policies where schemaname = 'app' loop
  using_expr := replace(replace(p.qual,
    'current_setting(''app.user_id''::text, true)', '(select current_setting(''app.user_id''::text, true))'),
    'current_setting(''app.tenant_id''::text, true)', '(select current_setting(''app.tenant_id''::text, true))');
  check_expr := replace(replace(p.with_check,
    'current_setting(''app.user_id''::text, true)', '(select current_setting(''app.user_id''::text, true))'),
    'current_setting(''app.tenant_id''::text, true)', '(select current_setting(''app.tenant_id''::text, true))');
  execute format('alter policy %I on app.%I using (%s)%s', p.policyname, p.tablename,
    using_expr, case when check_expr is not null then ' with check (' || check_expr || ')' else '' end);
 end loop;
end $$;
