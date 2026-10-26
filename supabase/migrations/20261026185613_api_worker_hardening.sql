-- Optional tenant scope supports controlled workers and isolated integration tests.
create function app.claim_outbox(p_owner uuid,p_tenant uuid) returns setof app.outbox_events
language plpgsql security definer set search_path='' as $$
begin
 delete from app.request_buckets where window_start<now()-interval '1 day';
 return query with batch as(select id from app.outbox_events where delivered_at is null and failed_at is null
 and attempts<10 and available_at<=now() and (lease_until is null or lease_until<now())
 and (p_tenant is null or tenant_id=p_tenant)
 order by available_at,created_at for update skip locked limit 10)
 update app.outbox_events e set lease_owner=p_owner,lease_until=now()+interval '120 seconds',attempts=e.attempts+1
 from batch where e.id=batch.id returning e.*;
end $$;
create function app.claim_jobs(p_owner uuid,p_tenant uuid) returns setof app.background_jobs
language plpgsql security definer set search_path='' as $$
begin
 update app.background_jobs set result_data=null where expires_at<now() and result_data is not null
 and (p_tenant is null or tenant_id=p_tenant);
 update app.background_jobs set status='failed',sanitized_error='RETRY_LIMIT' where status='running'
 and attempts>=5 and lease_until<now() and (p_tenant is null or tenant_id=p_tenant);
 return query with batch as(select id from app.background_jobs where status in ('pending','running')
 and attempts<5 and expires_at>now() and available_at<=now() and (lease_until is null or lease_until<now())
 and (p_tenant is null or tenant_id=p_tenant)
 order by created_at for update skip locked limit 5)
 update app.background_jobs j set status='running',lease_owner=p_owner,lease_until=now()+interval '120 seconds',attempts=j.attempts+1
 from batch where j.id=batch.id returning j.*;
end $$;
create or replace function app.finish_job(p_id uuid,p_owner uuid,p_data text,p_error text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if length(p_data)>10000000 then raise exception 'Result limit' using errcode='54000'; end if;
 update app.background_jobs set status=case when p_error is null then 'completed'
 when p_error='RETRY' and attempts<5 then 'pending' else 'failed' end,
 result_data=case when p_error is null then p_data else null end,
 sanitized_error=case when p_error is null then null when p_error='RETRY' then 'TRANSIENT_FAILURE' else 'EXPORT_FAILED' end,
 result_reference=case when p_error is null then id::text else null end,
 available_at=now()+make_interval(secs=>least(300,power(2,attempts)::integer)),
 lease_until=null,lease_owner=null where id=p_id and lease_owner=p_owner and lease_until>now() and expires_at>now();
 return found;
end $$;
revoke all on function app.claim_outbox(uuid,uuid),app.claim_jobs(uuid,uuid) from public,anon,authenticated,comandei_api;
grant execute on function app.claim_outbox(uuid,uuid),app.claim_jobs(uuid,uuid) to comandei_worker;
alter table app.cash_sessions add constraint cash_difference_safe_range
 check(difference_cents between -9007199254740991 and 9007199254740991);
