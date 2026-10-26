import { execFileSync } from 'node:child_process';

// Inspect staged blobs without printing their contents or secrets.
const files = execFileSync('git', ['diff', '--cached', '--name-only', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const secrets = [process.env.SUPABASE_DB_URL, process.env.DATABASE_URL]
  .filter(Boolean).flatMap(url => [url, decodeURIComponent(new URL(url).password)]).filter(Boolean);
for (const file of files) {
  if (/(^|\/)\.env(\.|$)/.test(file) && !file.endsWith('.env.example')) {
    throw new Error('Arquivo de ambiente indevido no staging.');
  }
  const content = execFileSync('git', ['show', `:${file}`], { encoding: 'utf8', maxBuffer: 5_000_000 });
  if (secrets.some(secret => content.includes(secret))) throw new Error('Credencial detectada no staging; commit interrompido.');
}
console.log(`OK: ${files.length} arquivos preparados sem as credenciais locais.`);
