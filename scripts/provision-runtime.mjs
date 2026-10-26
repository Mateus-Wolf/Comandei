// Administrative, explicit provisioning. Never imported by the application.
import pg from 'pg';
import { readFileSync, appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (process.env.DATABASE_URL) throw new Error('Runtime já configurado; rotação exige procedimento separado.');
const adminUrl = process.env.SUPABASE_DB_URL;
if (!adminUrl) throw new Error('Configure SUPABASE_DB_URL no .env.local.');
const client = new pg.Client({ connectionString: adminUrl, ssl: { ca: readFileSync('certs/supabase-ca.crt', 'utf8'), rejectUnauthorized: true } });
try {
  await client.connect();
  const password = randomBytes(32).toString('base64url');
  const { rows: [row] } = await client.query("select format('alter role comandei_api login password %L', $1::text) as command", [password]);
  await client.query(row.command);
  const url = new URL(adminUrl);
  url.username = url.username.includes('.') ? `comandei_api.${url.username.split('.')[1]}` : 'comandei_api';
  url.password = password;
  appendFileSync('.env.local', `\nDATABASE_URL=${url.href}\nSUPABASE_DB_CA=certs/supabase-ca.crt\n`);
  console.log('Credencial restrita criada e salva somente no arquivo local ignorado pelo Git.');
} catch (error) {
  console.error('Não foi possível provisionar o runtime:', error.code ?? error.name);
  process.exitCode = 1;
} finally { await client.end(); }
