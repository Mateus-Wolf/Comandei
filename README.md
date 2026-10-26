# Comandei

Fundação de banco e conexões do sistema de atendimento de restaurantes, seguindo [Documentacao.md](Documentacao.md) e [Roadmap.md](Roadmap.md).

## Configuração atual

- Projeto Supabase: `comandei` (`ymrvogxanngxljxsdnlk`), região `us-east-1`.
- Dashboard: https://supabase.com/dashboard/project/ymrvogxanngxljxsdnlk
- URL pública: `https://ymrvogxanngxljxsdnlk.supabase.co`.
- O projeto se chama **comandei**; o nome PostgreSQL de conexão no Supabase continua **postgres**.
- 26 tabelas no schema privado `app`, com RLS habilitada e forçada, FKs compostas por restaurante, índices e constraints.
- Frontend: fábrica de cliente Supabase em `apps/web/src/lib/supabase.ts`, destinada a Auth/Realtime.
- Backend: conexão SQLAlchemy/psycopg em `apps/api/comandei/core/db.py`, com TLS `verify-full`, pool limitado e contexto por transação.
- Role de execução: `comandei_api`, sem superusuário, criação de roles/bancos ou bypass de RLS.

No painel de tabelas do Supabase, selecione o schema **app**. As tabelas não aparecem no schema `public` e não são expostas à Data API do navegador.

## Desenvolvimento local

Requisitos: Node.js 22+ e Python 3.12+. A conexão direta atual requer IPv6; em ambiente IPv4, obtenha o endereço Session Pooler no botão **Connect** do projeto. Não derive o hostname do pooler pela região.

```powershell
npm ci
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r apps/api/requirements.lock.txt
```

Nesta máquina, `.env.local` já contém as URLs e credenciais e está ignorado pelo Git. Em outra máquina, copie `.env.example`, preencha `SUPABASE_DB_URL` com a conexão administrativa e execute uma única vez:

```powershell
node --env-file=.env.local scripts/provision-runtime.mjs
```

Esse comando gera uma senha aleatória para `comandei_api`. **Reprovisionar o mesmo banco altera a senha compartilhada do runtime**; para outra máquina usando o mesmo ambiente, prefira obter a credencial existente pelo canal seguro da equipe. Nunca use `SUPABASE_DB_URL` no backend em execução ou no navegador. A senha administrativa não é necessária ao cliente Supabase.

O certificado público em `certs/supabase-ca.crt` foi obtido do [endpoint oficial do Supabase](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt). A conexão verifica a cadeia e o hostname, seguindo a [documentação de TLS](https://supabase.com/docs/guides/platform/ssl-enforcement).

## Verificação

```powershell
npm run db:check
npm run db:test
npm run typecheck
./.venv/Scripts/python.exe apps/api/comandei/core/db.py
```

`db:check` usa a credencial real do runtime para verificar TLS, privilégios, 26 tabelas, RLS, bloqueio sem contexto, Auth e schema privado. `db:test` usa a conexão administrativa para montar fixtures dentro de uma transação, assume a role de execução e testa leituras/escritas A/B, FKs, mesa ativa única, bloqueio de vínculo e limpeza de contexto. Tudo termina em rollback, inclusive em caso de erro.

## Tabelas

| Área | Tabelas |
|---|---|
| Identidade e acesso | tenants, profiles, memberships, invitations, tenant_entitlements |
| Mesas e catálogo | dining_tables, categories, products, modifier_groups, modifier_options, product_modifier_groups |
| Atendimento | tabs, orders, order_items, order_item_modifiers, adjustments, approval_requests |
| Caixa e recebimentos | tab_settlements, payment_entries, cash_registers, cash_sessions, cash_movements |
| Infraestrutura | audit_events, outbox_events, idempotency_records, background_jobs |

Cadastros de identidade, equipe e plano são administrativos nesta etapa. O runtime consulta esses dados, mas não pode se promover ou criar vínculos. Recebimentos, movimentos e auditoria permitem apenas inclusão e leitura pelo runtime. As demais tabelas operacionais têm grants mínimos de inclusão/atualização; não há exclusão pelo runtime.

## Migrations e próximos passos

SQL em `supabase/migrations/` é a fonte única do schema. As migrations desta entrega já foram aplicadas ao projeto remoto e seus identificadores estão sincronizados com o histórico remoto. A CLI está fixada no projeto; crie novas migrations com `npm run supabase -- migration new nome`. `supabase/config.toml` configura apenas a stack local, não altera automaticamente as configurações remotas. Não usar `SQLAlchemy.create_all` ou histórico paralelo Alembic.

Esta entrega prepara banco e conexões. Ainda faltam a aplicação Next.js, servidor HTTP FastAPI, verificação JWT/JWKS, matriz de ações por perfil, provisionamento de restaurantes/usuários, políticas de canais Realtime e os serviços transacionais de pedidos/pagamentos. O helper `tenant_transaction` só deve ser chamado com identidade de JWT previamente verificado; ele valida vínculo atual e restaurante ativo, mas não substitui autorização por ação.

As constraints já protegem a estrutura e valores básicos. Locks financeiros, cálculo de saldo, transições de estado, execução atômica de aprovação e estornos requerem os serviços previstos no roadmap antes de uso operacional. Ainda não foi realizado replay das migrations em uma stack local vazia nem teste de carga. Nenhum restaurante ou usuário operacional foi cadastrado nesta entrega.
