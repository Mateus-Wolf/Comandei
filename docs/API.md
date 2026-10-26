# API Comandei

Implementação do MVP descrito em `Documentacao.md`. Código em `apps/api/comandei`, PostgreSQL no projeto Supabase `comandei`. A interface web está documentada em `docs/WEB.md`. Não inclui integração bancária, fiscal ou operação offline.

## Gestão de restaurantes

`GET /v1/restaurants` retorna as unidades vinculadas ao usuário e `can_create`. `POST /v1/restaurants`, com `Idempotency-Key`, cria a unidade e seu vínculo `owner` de forma atômica. O corpo contém `name`, `address`, `cnpj`, `opens_at`, `closes_at` e `service_type` (`rodizio`, `alacarte`, `both`). Somente administradores aprovados ou proprietários ativos, com e-mail confirmado, podem criar; cadastro comum não concede esse direito.

Os campos também podem ser alterados em `PATCH /v1/tenants/{id}/settings`, com `expected_version` e `Idempotency-Key`. `photo_path` deve apontar para o próprio restaurante no bucket privado `restaurant-photos`. O navegador envia a imagem diretamente pelo Storage, com RLS, sem usar chave de serviço.

A escrita em `/tables` exige a permissão `tables.write`, exclusiva de `owner`. Gerentes e funcionários mantêm leitura. As demais permissões de catálogo não mudam. O provisionamento de plataforma com MFA continua separado; esta entrega amplia o onboarding com criação de unidades pelos administradores aprovados, conforme solicitação do usuário.

## Executar

Requisitos: Python 3.12 e Node.js 22 ou superior.

```powershell
npm ci
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r apps/api/requirements-dev.lock.txt
npm run api:check
npm run api:dev
```

API: `http://127.0.0.1:8000`. Swagger: `http://127.0.0.1:8000/docs`. OpenAPI: `/openapi.json`. Em outro terminal:

```powershell
npm run api:worker
```

Nesta máquina, `.env.local` já contém credenciais distintas para API, worker e plataforma. O arquivo é ignorado pelo Git. Em outro ambiente, use `.env.example` como referência. Não copie a senha administrativa para o serviço HTTP; em produção injete somente as variáveis necessárias a cada processo.

`scripts/provision-runtime.mjs` e `scripts/provision-services.mjs` são ferramentas administrativas de configuração inicial. Reexecutá-las sem as variáveis existentes pode rotacionar senhas compartilhadas; não fazem parte da inicialização normal da aplicação.

## Identidade e segurança

O usuário faz login, renovação e recuperação de acesso diretamente pelo Supabase Auth. A API recebe apenas `Authorization: Bearer <access_token>`, sem refresh token, e não armazena senhas nem emite outro JWT.

- ES256/RS256: assinatura validada contra JWKS fixo do projeto, com cache de cinco minutos e atualização em rotação de chave.
- HS256 legado: Supabase `/auth/v1/user` valida a assinatura remotamente; a API também confere emissor, audiência, expiração, sujeito e papel. Nenhum segredo de assinatura é compartilhado com o backend.
- Somente usuários permanentes com role técnica `authenticated`. `user_metadata` não define autorização.
- O vínculo e papel atuais são consultados em banco em cada transação. Recurso de outro restaurante retorna 404; ação sem permissão retorna 403.
- Estornos e mudanças envolvendo proprietário exigem MFA (`aal2`, método MFA nos últimos 15 minutos) e sessão ainda ativa em `auth.sessions`.
- SQL usa `comandei_api`, sem superusuário, propriedade das tabelas ou bypass de RLS. Usuário e tenant são definidos com contexto local à transação. Leituras compostas usam snapshot `REPEATABLE READ`.
- CORS permite somente as origens configuradas, sem cookies. Respostas autenticadas são `private, no-store`.
- Limites: 120 requisições por usuário/restaurante/minuto no banco, 600 por IP/minuto/processo antes de validar JWT, corpo até 256 KiB, listas até 100 itens, até 100 linhas por pedido e até 50 adicionais por linha. O limite por IP não confia em `X-Forwarded-For` recebido diretamente; configure os proxies confiáveis no servidor/reverse proxy.
- `statement_timeout=15s`, `lock_timeout=5s`; API tem pool de cinco conexões sem overflow. Worker/plataforma têm pools separados de duas conexões. Some os pools ao escalar processos.
- A conexão direta exige IPv6. Para implantação IPv4 use o endereço Session Pooler obtido no painel do projeto; usernames com sufixo `.project_ref` são aceitos. Prepared statements automáticos ficam desativados também para compatibilidade com transaction pooling. A conexão direta foi verificada nesta máquina; endereço, certificado e capacidade do pooler precisam ser conferidos no ambiente de implantação.

O controle de rate limit tem uma tabela privada adicional (`app.request_buckets`), sem grants diretos ao runtime. A ausência de policy nela é intencional: o acesso ocorre somente por função estreita com `EXECUTE` específico. As 26 tabelas de negócio originais permanecem no schema `app` com RLS habilitada e forçada.

## Contrato

IDs UUID, datas ISO 8601 com fuso, quantidades em strings decimais e valores inteiros em centavos. Não enviar `tenant_id`, `user_id` ou `approved_by` no corpo de comandos operacionais. Campos extras são rejeitados. `tenant_id` é extraído da rota e validado contra o vínculo.

Rotas operacionais de escrita exigem `Idempotency-Key` entre 8 e 128 caracteres, preferencialmente um UUID novo por ação. Repetir a mesma rota/chave/corpo devolve o resultado original com `Idempotency-Replayed: true`. Trocar o conteúdo com a mesma chave retorna 409. O registro e o resultado são gravados na mesma transação da ação. O hash é independente da ordem dos campos JSON. A retenção mínima planejada é de sete dias; o código atual mantém esses registros até uma rotina administrativa de expurgo ser definida.

`operation_key` em pagamentos e movimentos é uma referência permanente adicional. Deve permanecer igual em todas as tentativas da mesma operação, inclusive depois da expiração de um cache idempotente. Não criar uma nova chave porque uma resposta demorou: repita a original ou consulte o estado.

Atualizações usam `expected_version`. Conflitos retornam `VERSION_CONFLICT` com a versão atual. Alteração de qualquer preço/regra de adicional invalida versões de cotação dos produtos do restaurante; envio com cotação antiga retorna `PRICE_CHANGED`. Esse mecanismo inicial privilegia consistência, com lock compartilhado para pedidos e exclusivo para manutenção do catálogo.

Erro padrão:

```json
{"error":{"code":"VERSION_CONFLICT","message":"O recurso foi atualizado. Revise os dados.","request_id":"uuid","details":{"current_version":8}}}
```

401: autenticação; 403: permissão; 404: recurso invisível; 409: conflito de versão/estado/idempotência; 422: conteúdo inválido; 429: limite; 503: falha transitória. 429 e 503 têm `Retry-After`. Não são expostos SQL, stack traces ou conteúdo do token.

## Rotas

Base `/v1`. Nas linhas abaixo, `t` é o UUID do tenant.

| Área | Rotas |
|---|---|
| Identidade | `GET /me/tenants`, `POST /invitations/accept` |
| Catálogo e mesas | `GET/POST /tenants/{t}/tables`, `categories`, `products`, `modifier-groups`, `modifier-options`, `product-modifier-groups`, `cash-registers`; `GET/PATCH` nos respectivos `/{id}` |
| Catálogo completo | `GET /tenants/{t}/catalog` com produtos paginados e seus grupos/opções |
| Configuração | `GET/PATCH /tenants/{t}/settings`, `GET /tenants/{t}/entitlements` |
| Comandas | `GET/POST /tenants/{t}/tabs`, `GET /tenants/{t}/tabs/{id}`, `GET .../prebill`, `GET .../receipt`, `POST .../cancel` |
| Pedidos e itens | `POST /tenants/{t}/tabs/{id}/orders`, `POST /tenants/{t}/items/{id}/transitions`, `POST .../cancel-requests` |
| Aprovações | `GET /tenants/{t}/approvals`, `POST /tenants/{t}/approvals/{id}/approve` |
| Liquidação | `POST /tenants/{t}/tabs/{id}/adjustments`, `POST .../start-closing`, `POST .../resume`, `POST .../payments`, `POST .../close` |
| Estorno | `POST /tenants/{t}/payments/{id}/refunds` |
| Caixa | `GET/POST /tenants/{t}/cash-sessions`, `GET /tenants/{t}/cash-sessions/{id}`, `POST .../movements`, `POST .../close` |
| Relatórios | `GET /tenants/{t}/reports/daily?day=YYYY-MM-DD`, `POST /tenants/{t}/exports`, `GET .../exports/{id}`, `GET .../exports/{id}/download` |
| Equipe | `GET /tenants/{t}/members`, `POST /tenants/{t}/invitations`, `PATCH /tenants/{t}/members/{user_id}` |
| Operação | `GET /tenants/{t}/audit-events`, `POST /tenants/{t}/outbox/{id}/retry` para avisos com falha definitiva |
| Plataforma | `GET/POST /platform/tenants`, `PATCH /platform/tenants/{id}/plan` |
| Saúde | `GET /health/live`, `GET /health/ready`; métricas em `/internal/metrics` com `METRICS_TOKEN` |

Listas usam `limit` e cursor opaco `cursor`; a resposta traz `items` e `next_cursor`. Catálogo e mesas são desativados por `PATCH {active:false,expected_version:...}`. Não há exclusão de histórico operacional. A lista de turnos do caixa já filtra o operador antes da paginação.

O contrato completo e tipos de requisição/respostas principais ficam em `packages/api-client/openapi.json` e `schema.d.ts`. Gere novamente com `npm run api:contract`.

## Regras de operação

### Atendimento e catálogo

- Garçom, caixa, gerente e proprietário consultam e colaboram nas comandas do restaurante. Somente gerente/proprietário mantêm catálogo e mesas; configurações comerciais e exportação completa exigem proprietário.
- Uma comanda ativa por mesa, com numeração por restaurante/dia operacional. Balcão aceita várias. Unicidade também é garantida em banco.
- Pedidos gravam itens e adicionais atomicamente, com nomes/preços/unidades congelados. Produtos indisponíveis, referências de outro tenant, grupos não vinculados e escolhas fora do mínimo/máximo são rejeitados. Quantidade fracionada em produto unitário é rejeitada.
- Preparo segue `submitted → preparing → ready → delivered`; caixa/gerente/proprietário operam preparo, e todos os perfis operacionais podem registrar entrega. Estado do pedido é derivado dos itens.
- Garçom/caixa solicitam cancelamento; gerente/proprietário autorizam. Solicitações expiram em 15 minutos, têm payload/hash e versão congelados e são executadas uma única vez. Mudança na comanda/item invalida a possibilidade de executar uma aprovação antiga. Item entregue exige compensação, sem apagamento retroativo.
- Comanda sem qualquer pedido ou recebimento pode ser cancelada. Consumo enviado e snapshots não são editados em silêncio.

### Valores e pagamentos

- Cada linha é arredondada `ROUND_HALF_UP` uma vez: quantidade × (preço + adicionais por unidade).
- Descontos são valores adicionais em centavos, acumulados na comanda e limitados ao subtotal. Caixa e gerente respeitam os limites configurados em pontos-base; exceder cria uma solicitação. Gerente não aprova acima do próprio limite; proprietário pode aprovar até o subtotal.
- Antes de recebimentos, gerente/proprietário podem anular um desconto em comanda aberta por `POST /tenants/{t}/tabs/{tab}/adjustments/{id}/void`, com versão e motivo. O valor original e a autoria são preservados; a anulação registra ator/horário/motivo e não pode ser desfeita. O detalhe da comanda inclui todos os ajustes. Isso permite corrigir consumo após remover um desconto que se tornou incompatível com o subtotal.
- Serviço é opcional, removível antes de recebimentos e calculado sobre subtotal menos descontos. Para ajuste de serviço, envie `type:"service"`, `accepted` e `amount_cents:0`; o servidor calcula o valor. No início de fechamento, `service_accepted` registra a confirmação final.
- O fechamento congela uma liquidação. Novo pedido e início de fechamento disputam o mesmo lock da comanda. Reabertura só é possível antes de qualquer recebimento e torna a liquidação anterior `superseded`.
- Recebimentos manuais somente em `closing`, com turno aberto e confirmação explícita. Parcela não pode exceder o saldo. Dinheiro entregue e troco são campos separados; receita registra só o valor recebido para a conta.
- Pagar a última parcela não encerra a comanda automaticamente. Chame `/close` com a nova versão; saldo precisa ser exatamente zero. Conta com total zero também pode ser encerrada.
- Estorno exige comanda encerrada, MFA recente, motivo, aprovador autenticado e referência ao recebimento original. É uma nova entrada compensatória, limitada à parcela ainda estornável. Usa um turno atualmente aberto, não modifica o turno histórico e não reabre o consumo nem gera nova cobrança automática.
- Ordem de locks: comanda, depois turno. Pagamentos, movimentações e encerramento do turno compartilham o lock do turno. Versões e constraints complementam os locks.
- Caixa opera o próprio turno; gerente/proprietário operam todos. Saldo físico = inicial + dinheiro recebido − devoluções em dinheiro + suprimentos − sangrias. Pix/cartão não aumentam a gaveta. Divergência acima da tolerância exige justificativa. Sangria/devolução em dinheiro não podem deixar saldo físico negativo.
- Suspensão comercial bloqueia novas comandas/pedidos/cadastros/turnos, preservando consulta e encerramento de operações em andamento. `closed` bloqueia o tenant. Limites de mesas/usuários são aplicados em servidor.

Cartão e Pix são registros manuais de recebimento externo. Pré-conta, recibo e relatórios são não fiscais.

### Equipe e plataforma

Convites duram 48 horas e retornam um token para entrega assistida. A API não envia emails automaticamente. O convidado precisa de uma conta Supabase com email confirmado que corresponda ao convite. Gerente convida/gerencia apenas garçom e caixa; proprietário pode gerenciar os demais papéis. O último proprietário ativo não pode ser removido, bloqueado ou rebaixado, inclusive em concorrência. Uma aceitação repetida não cria novo vínculo; em resultado desconhecido, consulte `/me/tenants`.

Onboarding requer uma conta Supabase já criada. Configure `PLATFORM_OPERATOR_IDS` com os UUIDs autorizados dos operadores, faça MFA recente e use `/platform/tenants` com o UUID do proprietário. O papel de proprietário de restaurante não concede acesso à plataforma. A conexão `comandei_platform` só executa funções estreitas de metadados, plano e provisionamento; não consulta comandas/pagamentos. Sem allowlist, a área da plataforma permanece negada.

## Worker, Realtime e exportações

Outbox e auditoria entram na mesma transação da mutação. Worker usa credencial SQL exclusiva, claim com `SKIP LOCKED`, lease de 120 segundos, retomada após crash, backoff e até dez tentativas para Broadcast. Falhas definitivas ficam na outbox e podem ser reprocessadas por proprietário. O worker não recebe grants globais de leitura/escrita de tabelas de negócio.

A publicação padrão usa a função oficial `realtime.send`, encapsulada em função privada que aceita somente o ID de um evento reivindicado e seu lease. O payload contém evento, tipo/ID/versão do agregado e horário; o Supabase pode acrescentar um ID técnico. Não envia preços, notas ou dados de cliente. Como `realtime.send` pode emitir aviso em vez de erro, a função confirma a inserção antes de marcar o evento entregue. Não é necessária uma chave `service_role` para o worker.

Tópico: `tenant:{uuid}:operations`, evento `invalidate`, canal `private:true`. A policy verifica usuário atual, vínculo ativo e tópico exato, inclusive na leitura de linhas. Não há policy que permita publicação pelo cliente. Em projeto recém-criado, o primeiro canal inicializa as partições gerenciadas de Broadcast; `scripts/initialize-realtime.mjs` permite verificar essa conexão sem enviar conteúdo de negócio. [Orientação oficial sobre inicialização](https://supabase.com/docs/guides/troubleshooting/realtime-warn-sending-broadcast-message).

O frontend deve buscar snapshot ao conectar/reconectar, deduplicar eventos e usar polling quando necessário. Eventos não são um histórico recuperável por cliente. Uma revogação pode permitir que um canal já autorizado receba avisos mínimos até reautorização; consultas à API verificam o vínculo atual. A revogação imediata de qualquer aviso não é uma garantia desta implementação.

Exportação é um job privado, restrito a proprietário e solicitante. Período máximo de 31 dias, até 10 mil registros e resultado disponível por 24 horas. Worker confere novamente o vínculo de proprietário, neutraliza fórmulas em CSV e armazena o resultado no schema privado, sem URL pública ou caminho de servidor na resposta. Falhas transitórias têm até cinco tentativas; permissão revogada e limite excedido resultam em falha. O worker apaga resultados expirados.

## Testes e implantação

```powershell
npm run api:test
npm run db:replay
npm run db:check
npm run db:test
npm run typecheck
```

Por padrão, testes de integração são ignorados. Somente em banco de desenvolvimento/teste:

```powershell
$env:RUN_DB_TESTS='1'
npm run api:test
```

As fixtures HTTP usam usuários/tenants sintéticos com UUIDs novos e removem exclusivamente esses registros ao terminar. Testes SQL de RLS/Realtimes usam rollback. Tokens assinados de teste exercitam o verificador; testes de negócio substituem apenas a dependência de identidade e usam HTTP, role runtime, RLS e transações PostgreSQL reais. Não substituem login/MFA pelo navegador contra uma conta operacional real.

`db:replay` executa todas as migrations em PostgreSQL embarcado vazio com contratos mínimos de Auth/Realtime. A CI também prepara PostgreSQL 17 isolado, aplica migrations do zero e executa a suíte HTTP/concorrente. Os stubs de Auth/Realtime de CI não pertencem ao schema de produção.

Imagem: `docker build -f Dockerfile.api -t comandei-api .`. Execute API e worker como processos separados com variáveis injetadas; o worker usa a mesma imagem com comando `python -m comandei.worker`. Não publique `.env.local`. TLS verificado é obrigatório; a única exceção do código exige `APP_ENV=test`, flag explícita e hostname loopback.

Ainda precisam de homologação antes de operação real: login/recuperação/MFA no frontend, sessão e reconexão em dispositivos, carga de referência, restauração de backup, entrega/monitoramento de alertas, build Docker e execução da CI no GitHub. Nenhum deploy público foi realizado. No Auth do projeto, o advisor apontou [proteção contra senhas vazadas desabilitada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection); habilite a opção disponível para o plano antes de produção. Essa configuração não é alterável pelos comandos de banco utilizados aqui.
