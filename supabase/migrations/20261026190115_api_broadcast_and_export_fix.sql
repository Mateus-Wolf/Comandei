create or replace function app.export_rows(p_job uuid,p_owner uuid) returns table(business_date date,payment_id uuid,
 tab_number bigint,type text,method text,amount_cents bigint,external_reference text)
language plpgsql security definer set search_path='' as $$
declare job app.background_jobs; start_date date; end_date date;
begin
 select j.* into job from app.background_jobs j where j.id=p_job and j.lease_owner=p_owner
 and j.lease_until>now() and j.status='running' and j.expires_at>now() and j.type='payments_csv';
 if job.id is null or not exists(select 1 from app.memberships m where m.tenant_id=job.tenant_id
 and m.user_id=job.requested_by and m.status='active' and m.role='owner') then
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

create function app.publish_outbox(p_id uuid,p_owner uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare e app.outbox_events; topic text; payload jsonb;
begin
 select * into e from app.outbox_events where id=p_id and lease_owner=p_owner
 and lease_until>now() and delivered_at is null and failed_at is null for update;
 if e.id is null then return false; end if;
 topic:='tenant:'||e.tenant_id::text||':operations';
 payload:=jsonb_build_object('event_id',e.event_id,'aggregate_type',e.payload->>'aggregate_type',
 'aggregate_id',e.aggregate_id,'aggregate_version',e.aggregate_version,'occurred_at',e.created_at);
 perform realtime.send(payload,'invalidate',topic,true);
 -- realtime.send warns instead of raising on some failures. Confirm insertion before acknowledgement.
 if not exists(select 1 from realtime.messages m where m.topic=topic and m.private
  and m.event='invalidate' and m.payload->>'event_id'=e.event_id::text) then
  raise exception 'Broadcast insertion failed' using errcode='P0001'; end if;
 return app.finish_outbox(e.id,p_owner,true);
end $$;
revoke all on function app.publish_outbox(uuid,uuid) from public,anon,authenticated,comandei_api,comandei_platform;
grant execute on function app.publish_outbox(uuid,uuid) to comandei_worker;
