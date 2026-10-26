alter policy comandei_receive_broadcast on realtime.messages
 using(extension='broadcast' and topic=(select realtime.topic())
 and exists(select 1 from app.memberships m where m.user_id=(select auth.uid())
  and m.status='active' and (select realtime.topic())='tenant:'||m.tenant_id::text||':operations'));
