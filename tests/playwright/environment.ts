import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

export const requiredTestVariables = [
  'E2E_ALLOW_TEST_DATA', 'E2E_SUPABASE_URL',
  'E2E_SUPABASE_PUBLISHABLE_KEY', 'E2E_SUPABASE_SECRET_KEY', 'E2E_DATABASE_URL',
];

export function loadTestEnvironment() {
  // Explicit test settings only: never silently reuse the application's database.
  if (existsSync('.env.e2e.local')) loadEnvFile('.env.e2e.local');
}

export default async function globalSetup() {
  loadTestEnvironment();
  const missing = requiredTestVariables.filter(key => !process.env[key]?.trim());
  if (missing.length || process.env.E2E_ALLOW_TEST_DATA !== '1') {
    throw new Error([
      'CONFIGURAÇÃO DOS TESTES INCOMPLETA — nenhum dado foi criado.',
      'Copie .env.e2e.example para .env.e2e.local e preencha com o ambiente de testes.',
      missing.length ? `Variáveis ausentes: ${missing.join(', ')}` : '',
      process.env.E2E_ALLOW_TEST_DATA !== '1' ? 'Defina E2E_ALLOW_TEST_DATA=1 no arquivo para habilitar a criação e limpeza dos dados de teste.' : '',
      'Depois execute novamente: npm run test:playwright',
      'Instruções: docs/PLAYWRIGHT.md',
    ].filter(Boolean).join('\n'));
  }
}

