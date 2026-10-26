# Comandei

API FastAPI do sistema de atendimento de restaurantes, baseada em [Documentacao.md](Documentacao.md) e [Roadmap.md](Roadmap.md).

## Executar

Nesta máquina as conexões já estão configuradas em `.env.local`, fora do Git.

```powershell
npm run api:dev
```

Abra [Swagger](http://127.0.0.1:8000/docs). Em outro terminal, execute `npm run api:worker` para Broadcast privado e exportações.

Para abrir login e cadastro, execute `npm run web:dev` e acesse [Comandei](http://localhost:3000). Veja [configuração do frontend e confirmação de e-mail](docs/WEB.md).

Em uma nova instalação:

```powershell
npm ci
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r apps/api/requirements-dev.lock.txt
```

## Implementado

- Autenticação Supabase, validação JWT/JWKS, papéis e isolamento por restaurante.
- Mesas, catálogo, adicionais, disponibilidade, versões e limites de plano.
- Comandas, pedidos atômicos, snapshots, transições, cancelamento e aprovações.
- Pré-conta, descontos, serviço opcional, liquidações, pagamentos parciais, troco e estornos.
- Turnos, suprimentos, sangrias, contagem e divergências.
- Equipe, convites, proteção do último proprietário e provisionamento separado da plataforma.
- Auditoria, outbox, worker com lease/retry, Realtime privado, relatórios e CSV privado.
- Idempotência, locks, paginação, erros padronizados, limites de requisição, saúde e métricas.
- Contrato OpenAPI/tipos TypeScript, testes, Dockerfile e workflow de CI.

## Banco e conexões

Projeto Supabase: [comandei](https://supabase.com/dashboard/project/ymrvogxanngxljxsdnlk), região `us-east-1`. O banco PostgreSQL de conexão se chama `postgres`. Selecione o schema **app** no painel para visualizar as 26 tabelas de negócio e a tabela adicional de rate limit.

API, worker e plataforma têm credenciais SQL separadas e restritas. Conexões remotas verificam certificado e hostname TLS. Dados de negócio não são expostos à Data API do navegador. Auth e Realtime são acessados pelo cliente Supabase.

SQL versionado em `supabase/migrations/` é a fonte única do schema. As migrations foram aplicadas ao Supabase e seus identificadores correspondem ao histórico remoto. `supabase/config.toml` configura a stack local. Nunca usar `SQLAlchemy.create_all` ou um histórico Alembic paralelo.

## Verificar

```powershell
npm run api:test
npm run db:replay
npm run db:check
npm run db:test
npm run typecheck
npm run api:contract
```

Testes HTTP no banco real exigem `RUN_DB_TESTS=1` e usam fixtures sintéticas descartáveis. Execute somente em desenvolvimento/teste.

Veja [docs/API.md](docs/API.md) para o contrato, regras, configuração inicial de operadores, deploy, testes e limites da homologação. A interface web e a homologação operacional continuam sendo etapas separadas do roadmap.
