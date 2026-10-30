# Testes Playwright

Execute `npm run test:playwright`. Relatório: `npm run test:playwright:report`.

São testes de integração HTTP usando o APIRequestContext do Playwright; não cobrem cliques ou renderização da interface. Cada cenário cria seus próprios dados e remove apenas os IDs gerados. As etapas aparecem no terminal e no relatório HTML; falhas HTTP mostram método, caminho, status esperado e resposta.

Use exclusivamente um projeto Supabase e uma API de testes, com migrations aplicadas. Nunca aponte para produção. A API deve usar o mesmo Supabase do teste e ter a credencial de criação de funcionários configurada.

Na raiz do projeto, execute `copy .env.e2e.example .env.e2e.local` e preencha o arquivo com as credenciais do ambiente de testes. O comando carrega `.env.e2e.local` automaticamente. Variáveis já definidas no terminal têm prioridade. O arquivo `.env.local` da aplicação não é reutilizado para evitar criar e apagar dados no banco errado. Por padrão o Playwright inicia e encerra a API do projeto automaticamente na porta 8011. Se configurar outro E2E_API_URL, inicie essa API antes da execução.

- E2E_ALLOW_TEST_DATA=1
- E2E_API_URL=http://127.0.0.1:8011
- E2E_SUPABASE_URL: URL do projeto de testes
- E2E_SUPABASE_PUBLISHABLE_KEY: chave pública do projeto de testes
- E2E_SUPABASE_SECRET_KEY: chave administrativa, somente no processo de testes
- E2E_DATABASE_URL: conexão administrativa PostgreSQL do banco de testes (configure SSL conforme o ambiente)

O administrador temporário é criado com email_confirm: true e autorizado no banco somente para esta execução. Os funcionários usam o mecanismo existente de criação de login. Nenhuma configuração global de confirmação de e-mail é desativada; usuários normais continuam sujeitos à confirmação.

O atendimento usa quatro pessoas como cortesia (sem cobrança de rodízio), dois produtos de R$ 10 e R$ 20, sem taxa de serviço, desconto de R$ 3 e PIX de R$ 27. Verifica saldo zero, encerramento, ausência de comanda ativa na mesa e abertura de um novo atendimento.

Cada teste prepara um restaurante, dois funcionários, quatro produtos e cinco mesas independentemente. Não há dependência da ordem dos testes. A preparação também utiliza endpoints reais e autenticação real, sem simular permissões.


