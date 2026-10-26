import pg from 'pg';
import { readFileSync, appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL,
  ssl: { ca: readFileSync('certs/supabase-ca.crt', 'utf8'), rejectUnauthorized: true } });
try {
  await client.connect();
  for (const name of ['worker', 'platform']) {
    const key = `${name.toUpperCase()}_DATABASE_URL`;
    if (process.env[key]) continue;
    const password = randomBytes(32).toString('base64url');
    const {rows: [row]} = await client.query('select format(\'alter role %I login password %L\', $1::text,$2::text) as command', [`comandei_${name}`,password]);
    await client.query(row.command);
    const url = new URL(process.env.SUPABASE_DB_URL);
    url.username=url.username.includes('.') ? `comandei_${name}.${url.username.split('.')[1]}` : `comandei_${name}`;
    url.password=password;
    appendFileSync('.env.local', `\n${key}=${url.href}\n`);
    console.log(`Credencial ${name} salva somente no ambiente local.`);
  }
} catch(error) {
  console.error('Falha no provisionamento:',error.code ?? error.name);
  process.exitCode=1;
} finally { await client.end(); }
