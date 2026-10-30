# Comandei

O **Comandei** é um sistema web de gestão e atendimento para restaurantes. Ele reúne a organização de mesas, comandas, pedidos, catálogo de produtos, equipe e caixa, com acesso por função e separação dos dados de cada restaurante.

O projeto combina uma interface em **Next.js e React**, uma API em **Python com FastAPI** e serviços do **Supabase** para PostgreSQL, autenticação, armazenamento de fotos e atualizações em tempo real.

## Como funciona

1. O usuário entra na conta e acessa os restaurantes aos quais está vinculado.
2. O atendimento organiza mesas e comandas e registra o consumo, incluindo adicionais dos produtos.
3. No fechamento, o caixa confere os valores, serviço e descontos, registra os pagamentos e encerra a comanda quitada.
4. Administradores e gerentes acompanham a equipe, as configurações e as informações financeiras conforme suas permissões.

Os perfis disponíveis são proprietário/administrador (`owner`), gerente (`manager`), operador de caixa (`cashier`) e garçom (`waiter`). Criar uma conta não concede automaticamente permissão para criar restaurantes: a primeira unidade depende de aprovação administrativa; os demais integrantes podem entrar por convite.

## Funcionalidades

- **Restaurantes e mesas:** cadastro de unidades, endereço, foto privada, configuração e organização das mesas.
- **Atendimento:** abertura e acompanhamento de comandas, pedidos, adicionais, cancelamentos e aprovações.
- **Catálogo e disponibilidade:** categorias, produtos, preços e indicação de disponibilidade na tela de estoque. O módulo não mantém saldos físicos nem movimentações de mercadorias.
- **Caixa:** abertura e fechamento de turnos, suprimentos, sangrias, pagamentos parciais, troco, descontos e recibo não fiscal.
- **Equipe:** vínculos por restaurante, funções, convites e controle de acesso.
- **Financeiro:** consultas, relatórios e exportações, com processamento de tarefas pelo worker.
- **Conta:** login, confirmação de e-mail e recuperação de senha.

O registro de Pix e cartões representa um recebimento confirmado pelo operador. O projeto não inclui integração bancária, emissão fiscal ou operação offline.

## Estrutura do projeto

```text
apps/
  api/                 API FastAPI e dependências Python
  web/                 Interface Next.js, React e TypeScript
packages/
  api-client/          Contrato OpenAPI e tipos TypeScript gerados
supabase/
  migrations/          Histórico SQL do banco
scripts/               Inicialização, validação e ferramentas administrativas
tests/                 Testes da API e testes de navegador
docs/                  Documentação técnica e guias de validação
```

A interface usa a API para as operações de negócio. O Supabase Auth cuida das sessões; a API valida o token e as permissões do usuário. Os dados operacionais ficam no schema privado `app`, com isolamento por restaurante e políticas de segurança no banco. O worker processa tarefas de publicação de eventos e exportação.

## Requisitos e configuração

- Node.js 22 ou superior e npm.
- Python 3.12, com ambiente virtual local.
- Projeto Supabase configurado com as migrations e credenciais apropriadas para cada serviço.

Copie `.env.example` para `.env.local` e preencha os valores do seu ambiente. Esse arquivo deve permanecer fora do Git.

| Variável | Finalidade |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave publicável para o cliente |
| `NEXT_PUBLIC_API_URL` | Endereço da API usado pela interface |
| `DATABASE_URL` | Conexão restrita da API |
| `WORKER_DATABASE_URL` | Conexão restrita do worker |
| `PLATFORM_DATABASE_URL` | Conexão administrativa da plataforma |
| `SUPABASE_DB_URL` | Conexão administrativa para migrations e ferramentas |
| `SUPABASE_DB_CA` | Caminho do certificado usado na conexão TLS |
| `PLATFORM_OPERATOR_IDS` | UUIDs dos operadores autorizados da plataforma |
| `CORS_ORIGINS` | Origens da interface autorizadas a acessar a API |
| `METRICS_TOKEN` | Token de acesso às métricas |

Somente as variáveis `NEXT_PUBLIC_*` devem ser expostas ao navegador. As senhas SQL pertencem aos processos de servidor. Consulte [o guia da API](docs/API.md) para provisionar os acessos e [o guia web](docs/WEB.md) para configurar confirmação de e-mail, URLs de redirecionamento e SMTP.

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

Projeto Supabase: [comandei](https://supabase.com/dashboard/project/ymrvogxanngxljxsdnlk), região `us-east-1`. O banco PostgreSQL de conexão se chama `postgres`. Selecione o schema **app** no painel para visualizar as 27 tabelas de negócio, a tabela de rate limit e o registro de administradores aprovados (29 tabelas ao todo).

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

Veja [docs/API.md](docs/API.md) para o contrato, regras, configuração inicial de operadores, deploy, testes e limites da homologação. Consulte o roadmap para acompanhar as etapas previstas e os limites de homologação.


## Outros comandos úteis

| Comando | Uso |
| --- | --- |
| `npm run api:check` | Verificar a conexão da API com o banco |
| `npm run web:test` | Executar testes das regras e utilitários da interface |
| `npm run web:build` | Gerar a compilação de produção da interface |
| `npm run web:start` | Iniciar a interface após a compilação |
| `npm run test:playwright` | Executar os testes de navegador, com o ambiente de testes configurado |

Os comandos de verificação têm requisitos diferentes. Consulte os guias antes de executar testes que criam dados no banco. As ferramentas de provisionamento administrativo não fazem parte da inicialização diária.

## Documentação complementar

- [Especificação do projeto](Documentacao.md)
- [Roadmap](Roadmap.md)
- [API, segurança e implantação](docs/API.md)
- [Interface e fluxos de uso](docs/WEB.md)
- [Validação da API](docs/VALIDACAO-API.md)
- [Testes com Playwright](docs/PLAYWRIGHT.md)
- [Desempenho](docs/PERFORMANCE.md)
