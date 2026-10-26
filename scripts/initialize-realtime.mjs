// A fresh Supabase project creates its managed Broadcast partitions on first channel join.
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const channel=client.channel(`comandei-setup-${randomUUID()}`);
try {
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Realtime connection timeout')),15000);
    channel.subscribe(status=>{
      if (status==='SUBSCRIBED') { clearTimeout(timer); resolve(); }
      else if (status==='CHANNEL_ERROR'||status==='TIMED_OUT') {clearTimeout(timer);reject(new Error(status));}
    });
  });
  console.log('OK: canal de verificação conectado; inicialização gerenciada do Realtime acionada.');
} finally {await client.removeAllChannels();}
