# Desempenho da API e carregamento das telas

## Otimização adicional de comandas e formulários — 27/10/2026

O cálculo de uma comanda agora agrega os adicionais na mesma consulta dos itens, mantendo o arredondamento por linha e os limites monetários no domínio Python. São três consultas por cálculo, independentemente da quantidade de itens: com 50 itens não cancelados, passam de 53 para 3. Essa contagem cobre a função de cálculo, sem incluir autenticação, contexto e outras etapas da rota. Não é uma medição de tempo de resposta.

O detalhamento busca pedidos, itens e adicionais em lotes. A montagem dessas três coleções passa de `1 + quantidade de pedidos + quantidade de itens` consultas para no máximo três. A ordenação, os itens cancelados no histórico e os filtros por restaurante e comanda são preservados. Leituras concorrentes ignoram registros de novos pedidos que não constavam da primeira consulta, evitando falhas durante a montagem.

Os formulários de produtos, categorias, funcionários, restaurantes, mesas, ações de caixa e pagamento são carregados sob demanda. A compilação de produção confirmou os seguintes arquivos separados, ausentes dos scripts iniciais das páginas; os tamanhos são do JavaScript minificado sem compressão, não uma comparação de latência ou do tamanho total da página:

| Tela | JavaScript dos formulários adiado |
| --- | ---: |
| Caixa | 14.730 bytes |
| Estoque | 5.713 bytes |
| Funcionários | 4.784 bytes |
| Restaurantes | 9.742 bytes |

Validação desta alteração: 112 testes Python passaram e 34 testes condicionais foram ignorados; 18 testes Node passaram, incluindo execução das novas consultas em PostgreSQL em memória (PGlite). TypeScript, Ruff e a compilação de produção passaram. Os novos testes cobrem orçamento de consultas com 1 e 50 pedidos, arredondamento por item, proteção contra descontos excessivos, histórico de comandas abertas/em fechamento/fechadas, adicionais fracionários e isolamento entre comandas e restaurantes. Não foi executado benchmark no banco remoto nesta alteração.

## Medições anteriores

Medição em 27/10/2026: API executada nesta máquina, PostgreSQL remoto do projeto `comandei` em `us-east-1`. Fixtures sintéticas descartáveis, mesmas rotas e mesma quantidade de mesas nas duas medições. Os números incluem a comunicação com o banco e variam com a rede; não são metas universais de latência.

| Ação | Antes | Depois | Consultas SQL antes/depois |
| --- | ---: | ---: | ---: |
| Listar 13 mesas com ocupação | 3.952 ms | 1.278 ms | 21 / 5 |
| Cadastrar mesa | 3.511 ms | 2.254 ms | 18 / 12 |
| Listar restaurantes | conexão inicial incluída | conexão inicial incluída | 3 / 2 |

A listagem de mesas usa uma subconsulta correlacionada no mesmo comando SQL, apoiada no índice único de comanda ativa por mesa. O número de viagens ao banco não cresce com a quantidade de mesas. A verificação de plano é carregada uma vez por requisição apenas para novas operações. Permissões continuam sendo verificadas em cada ação; o plano não é guardado entre requisições.

O contexto de usuário e o consumo de limite são avaliados em um único comando independente, com commit automático. Erros na operação de negócio continuam consumindo o limite. O contexto é local à transação e não permanece na conexão reutilizada. Restaurante e vínculo são consultados juntos; auditoria e outbox são gravados juntos, na mesma transação da alteração. Locks de idempotência e releituras após locks permanecem separados para preservar o comportamento concorrente.

No front, a sessão local permite desenhar a estrutura da página sem aguardar uma chamada remota de perfil. A API continua validando o JWT em todas as requisições. As respostas ficam em memória durante a sessão da página, sem expiração por tempo, com registros identificados por usuário, restaurante, tipo e ID. Listagens guardam referências aos registros, evitando duplicar seus dados. Renovar o token mantém o cache; sair da conta, mudar de usuário ou sessão e recarregar a página descartam os dados. Não há persistência em disco nem sincronização entre abas ou dispositivos: alterações externas exigem recarregar a página.

Leituras repetidas, inclusive com cancelamento individual, usam o cache; chamadas idênticas simultâneas sem cancelamento compartilham uma requisição. Edições de mesas e funcionários atualizam apenas o registro nas listagens existentes; configurações atualizam o restaurante correspondente. Criações e exclusões invalidam os índices da coleção afetada. Estoque invalida suas consultas filtradas, paginação e totais; mutações de catálogo também invalidam produtos, pois o servidor altera suas versões para invalidar cotações. Operações de comanda e caixa invalidam ocupação, detalhes e resumos dependentes do mesmo restaurante. Outros restaurantes e recursos continuam em cache. Erros de autenticação ou permissão limpam o cache; conflitos de versão invalidam as consultas relacionadas para permitir uma nova leitura. Falhas comuns de gravação preservam os dados anteriores. Respostas iniciadas antes de uma alteração ou saída da conta não repovoam o cache com dados antigos. Equipe e convites são carregados por uma única chamada `GET /v1/tenants/{tenant_id}/team`, sem expor tokens de convite.

## Reproduzir

```powershell
npm run web:test
npm run api:test
# Somente no ambiente de desenvolvimento/testes com credenciais configuradas:
$env:RUN_DB_TESTS = '1'
npm run api:test -- -k restaurant_screen_query_budget -s
```

Os testes de desempenho verificam o número máximo de consultas, sem exigir um tempo fixo dependente da rede. Há regressões para ocupação e paginação de mesas, consumo de limite em operações rejeitadas, limpeza de contexto na conexão e privacidade da visão de equipe. O teste integrado usa dados sintéticos e os remove ao concluir.

Conexões novas com o banco remoto ainda têm custo de inicialização. A compilação inicial de cada rota no servidor Next.js de desenvolvimento também pode acrescentar espera; `npm run web:build` seguido de `npm run web:start` permite comparar sem essa compilação durante a navegação.


Validação concluída: 121 testes na regressão completa com PostgreSQL remoto, mais três testes de escopo de plano e o teste integrado da nova visão de equipe (125 casos da API no total). Os quatro testes de compartilhamento de requisições do front passaram, assim como TypeScript, Ruff e a compilação de produção. As fixtures descartáveis foram removidas pelos testes. O workflow de CI executa `npm run web:test` junto das verificações existentes.
