create or replace function app.publish_outbox(p_id uuid,p_owner uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare e app.outbox_events; v_topic text; v_payload jsonb;
begin
 select * into e from app.outbox_events where id=p_id and lease_owner=p_owner
 and lease_until>now() and delivered_at is null and failed_at is null for update;
 if e.id is null then return false; end if;
 v_topic:='tenant:'||e.tenant_id::text||':operations';
 v_payload:=jsonb_build_object('event_id',e.event_id,'aggregate_type',e.payload->>'aggregate_type',
 'aggregate_id',e.aggregate_id,'aggregate_version',e.aggregate_version,'occurred_at',e.created_at);
 perform realtime.send(v_payload,'invalidate',v_topic,true);
 if not exists(select 1 from realtime.messages m where m.topic=v_topic and m.private
  and m.event='invalidate' and m.payload->>'event_id'=e.event_id::text) then
  raise exception 'Broadcast insertion failed' using errcode='P0001'; end if;
 return app.finish_outbox(e.id,p_owner,true);
end $$;
