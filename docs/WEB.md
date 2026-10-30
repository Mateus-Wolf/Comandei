# Login e cadastro

## Comandas nas mesas

### Dashboard de mesas

`/mesas` aparece no menu para todos os membros, incluindo garçom e caixa. O painel seleciona a unidade entre os vínculos do usuário e mostra contadores de mesas disponíveis, em atendimento, aguardando caixa e inativas. Busca por número/nome da mesa ou número da comanda e filtro por situação operam sobre todas as páginas carregadas, com ordenação numérica das mesas. Os contadores representam a unidade inteira, independentemente dos filtros.

A consulta utiliza a API de mesas existente e respeita suas permissões. O painel consulta novamente a cada 15 segundos enquanto visível, ao voltar à aba e ao recuperar conexão. Há atualização manual e horário da última consulta concluída. Falhas conservam o último resultado com aviso; perda de autorização remove os dados. Trocar de restaurante cancela a consulta anterior e não exibe o resultado de outra unidade. Não exige migração.

Cada mesa ativa permite abrir ou consultar sua comanda com as permissões já existentes. A consulta inicial da comanda busca dados atuais no servidor. Atualizações periódicas pausam enquanto o formulário está aberto; ao fechar, o painel é atualizado. Caixa, gerente e administrador também têm atalho para a tela de recebimentos.

Na página de mesas de cada restaurante, **Abrir comanda** inicia o atendimento e **Ver comanda** mostra o consumo existente. Cadastre os rodízios normal e premium como produtos no catálogo e escolha um por grupo de pagantes. A composição permite quantidades diferentes por rodízio e grupos de cortesia, como aniversariantes. Os assentos restantes aparecem como lugares vazios, sem cobrança. A quantidade de pessoas não pode ultrapassar a capacidade cadastrada.

O garçom pode atualizar pessoas, montar pedidos com produtos, quantidades e observações, enviar o pedido e fechar a mesa para consumo. O fechamento envia a conta ao caixa e mantém a mesa ocupada até a quitação e o encerramento financeiro. A tela do caixa mostra os grupos de rodízio e cortesias junto dos produtos consumidos.

A reabertura antes de recebimentos é permitida ao caixa e ao administrador por padrão. Na comanda, o administrador pode alterar os perfis autorizados para a unidade. A mesma mesa nunca aceita duas comandas simultâneas, inclusive enquanto aguarda o caixa.

O botão **Atualizar mesas** consulta novamente o servidor para conferir alterações realizadas por outros operadores. A atualização volta à primeira página e conserva a lista anterior se houver falha, exibindo o erro. Requisições anteriores são canceladas ao trocar de unidade ou iniciar outra consulta, evitando exibir respostas atrasadas. Esta atualização é manual.

## Executar login e cadastro

As telas Next.js usam o Supabase Auth já configurado em `.env.local` e a API FastAPI para consultar os vínculos com restaurantes.

```powershell
npm run api:dev
# Em outro terminal:
npm run web:dev
```

Abra http://localhost:3000. Rotas: `/entrar`, `/cadastro`, `/auth/confirm` e `/home`. O endereço anterior `/conta` redireciona para `/home`.

Após autenticar ou confirmar o e-mail, o usuário entra na home. A barra lateral contém Início, Restaurantes, Funcionários, Estoque, Caixa e Dashboard financeiro, além da identificação e Sair. No celular, o botão Menu abre e fecha a navegação. Financeiro mostra uma página de próxima etapa. Restaurantes, Funcionários, Estoque e Caixa têm fluxos próprios.

A troca entre login e cadastro anima a saída e a entrada do formulário, mantendo a ilustração parada. O login bem-sucedido anima a saída da tela e a entrada no espaço autenticado. A preferência `prefers-reduced-motion` desativa a animação e o atraso de navegação. Links mantêm o comportamento de abrir em nova aba com Ctrl/Cmd.

O formulário pede nome (`app.profiles.display_name`), e-mail e senha (Supabase Auth), além da confirmação da senha. A criação do usuário salva automaticamente o nome no perfil por trigger. Metadados do cadastro nunca concedem permissões ou vínculo a restaurante. A autorização de criar unidades vem de administradores aprovados no banco ou de um vínculo ativo de proprietário, com e-mail confirmado. A tela consulta `/v1/restaurants`, sem expor as tabelas privadas à Data API.

## Restaurantes e mesas

`/restaurantes` mostra as unidades vinculadas em cards e o botão Criar restaurante no topo direito. O formulário pede nome, foto opcional (JPG/PNG/WebP, até 5 MB), endereço, CNPJ, abertura, fechamento e atendimento (rodízio, à la carte ou ambos). O CNPJ é normalizado e tem os dígitos verificados, aceitando os formatos numérico e alfanumérico; isso não consulta a situação cadastral na Receita Federal. Horários que atravessam a meia-noite são aceitos.

O endereço é dividido em CEP, UF, cidade, bairro, logradouro, número e complemento opcional. O CEP usa máscara e consulta o [ViaCEP](https://viacep.com.br/); UF, cidade, bairro e logradouro continuam editáveis para corrigir dados ou concluir o cadastro quando a consulta falhar. Apenas o CEP é enviado ao ViaCEP. Respostas de consultas anteriores são descartadas ao trocar o CEP. O CNPJ usa máscara `00.000.000/0000-00`, com limite de 14 posições úteis (18 com pontuação), preservando o suporte a letras nas primeiras 12 posições.

A migration `restaurant_addresses` cria `app.restaurant_addresses`, com FK única `tenant_id` para `app.tenants(id)`. Criação e edição salvam os campos estruturados na mesma transação do restaurante e conservam o endereço formatado para os cards e clientes anteriores. Endereços antigos permanecem no campo original; os novos campos devem ser preenchidos ao editar, sem tentar deduzir cidade ou número de texto livre. RLS permite leitura aos membros da unidade e escrita ao proprietário da unidade ativa. Aplicar esta migration antes de usar a nova versão da API. Aplicada no projeto remoto `comandei`, com versão `20261027180824`, após autorização explícita.

A navegação entre páginas autenticadas e a abertura dos modais têm transições suaves, respeitando `prefers-reduced-motion`. O cancelamento do seletor de imagem é tratado no próprio campo e não fecha o modal de cadastro; cliques no preenchimento interno do modal também não são interpretados como clique no fundo.

O card abre `/restaurantes/{id}`, com mesas em cards, número, assentos e disponibilidade. O administrador pode adicionar e editar mesas e os dados do restaurante. `owner` corresponde ao administrador da unidade; `manager`, `cashier` e `waiter` apenas consultam essa tela. A restrição é verificada na API e há proteção adicional nas alterações de mesas no banco. Não há concessão pública de papel administrativo.

As fotos ficam no bucket privado `restaurant-photos`, com políticas por restaurante. A equipe vinculada pode visualizar; somente o proprietário da unidade ativa pode enviar e remover. A interface usa links assinados por uma hora. Falhas no envio da foto não apagam o cadastro: o formulário informa o que foi salvo e permite repetir.

A conta administrativa indicada pelo usuário foi habilitada por UUID em `app.restaurant_administrators`; nenhum e-mail administrativo ou credencial foi fixado no código. A aprovação permite criar a primeira unidade, que atribui ao criador o papel `owner`. Os demais usuários entram por convite.

Validação desta entrega: 85 testes unitários e 2 testes novos de integração no banco real aprovados; replay das 11 migrations (28 tabelas com RLS), TypeScript, compilação, conexão TLS e isolamento A/B aprovados. No navegador foram verificados login, criação com foto, abertura do card, inclusão e edição de mesas, celular e logout. Todos os recursos sintéticos foram removidos. O teste reproduzível `scripts/test-restaurant-browser.mjs` exige `RUN_DB_TESTS=1` e uma `TEST_BROWSER_PASSWORD` temporária; cria uma conta descartável e limpa unidades, fotos e identidade ao encerrar.

No painel Supabase, em **Authentication → URL Configuration**, inclua `http://localhost:3000/auth/confirm` nas Redirect URLs e configure a Site URL correspondente. Ao publicar, cadastre também a URL HTTPS real de confirmação e ajuste a Site URL. Configure SMTP para entrega dos e-mails em produção. Sem configurar a URL permitida, o Supabase pode enviar o usuário para a Site URL padrão.

`NEXT_PUBLIC_API_URL` aponta para a API (padrão: `http://localhost:8000`). Em outro domínio, ajuste também `CORS_ORIGINS` no backend. A URL e a chave publicável do Supabase são as únicas credenciais necessárias no cliente; senhas SQL ficam fora dos arquivos do frontend e do Git.

Validação: `npm run typecheck`, `npm run web:build`, `npm run db:replay`. O replay valida a persistência do perfil e impede que metadados de cadastro criem membros proprietários. A interface foi revisada em navegador desktop e viewport móvel, incluindo campos obrigatórios, divergência de senha, mostrar/ocultar senha e redirecionamento de conta sem sessão. Não é necessário desabilitar a confirmação de e-mail.

O teste integrado `scripts/test-web-auth.mjs` foi executado com a API ligada: login real no Supabase, perfil salvo, JWT aceito pela API, lista vazia de restaurantes, logout e rejeição de senha incorreta. Não envia e-mails: cria uma identidade sintética e a remove ao concluir. Para repetir **somente em desenvolvimento/teste**, defina `RUN_DB_TESTS=1` e execute `node --env-file=.env.local scripts/test-web-auth.mjs`. A entrega de e-mail/abertura do link em uma caixa postal real não foi testada.

Regressão após a migração: **96 testes da API aprovados**, incluindo os 22 testes de integração no PostgreSQL real. Compilação de produção, TypeScript e replay das 10 migrations aprovados. Auditoria npm das dependências de produção: nenhuma vulnerabilidade conhecida.

Validação da home e transições: TypeScript e compilação de produção aprovados; navegação login → cadastro → login e Voltar conferidas no navegador. Login real com identidade descartável abriu a home, consultou os vínculos e permitiu sair pelo menu móvel. Acesso à home sem sessão retornou ao login. A identidade de teste foi removida ao concluir.


## Funcionários e convites

`/funcionarios` permite selecionar um restaurante, buscar membros por nome ou função e consultar os convites pendentes. Administradores e gerentes gerenciam a equipe; garçons e operadores de caixa não acessam essa listagem. Administradores podem convidar gerentes, operadores de caixa e garçons. Gerentes convidam e editam apenas operadores de caixa e garçons. Mudanças em administradores ficam fora desta tela e mantêm a proteção existente de MFA e do último proprietário.

Cadastrar funcionário solicita e-mail e função, gera um convite válido por 48 horas e apresenta um link para cópia. Nenhum e-mail é enviado automaticamente. O nome vem do perfil que o próprio funcionário cadastra. A listagem de convites usa `GET /v1/tenants/{tenant_id}/invitations`, com os mesmos controles de acesso da equipe; não retorna tokens nem seus hashes.

O link `/convite#token=...` permite entrar ou criar uma conta e depois aceitar explicitamente o vínculo. O token é mantido na sessão da aba para retornar ao convite após login; o servidor confere o e-mail confirmado, a validade, o uso anterior e o limite do plano. Ao editar um funcionário, é possível alterar a função e ativar, bloquear ou revogar o acesso. Todas as alterações são verificadas novamente na API e no banco. Esta tela utiliza a estrutura existente de equipe e convites, sem nova migration.


Validação após aplicar `20261027180824_restaurant_addresses` no projeto `comandei`: 11 testes selecionados aprovados, incluindo cadastro de restaurante, gravação e edição de endereço estruturado, repetição idempotente, restrições de gerente e listagem privada de convites entre unidades. Fixtures sintéticas removidas pelo próprio teste. `npm run db:check` aprovou conexão TLS, credencial restrita, 29 tabelas com RLS, ausência de acesso sem contexto e schema privado. Replay das 12 migrations aprovado. Os avisos de segurança anteriores do projeto não foram alterados por esta migration.


As otimizações de carregamento, a comparação de tempos e os testes de regressão estão documentados em [PERFORMANCE.md](PERFORMANCE.md). A tela de equipe passou a carregar membros e convites juntos por `/v1/tenants/{tenant_id}/team`; as rotas individuais continuam disponíveis.


## Estoque: produtos e disponibilidade

`/estoque` utiliza o mesmo componente de seleção de restaurante de `/funcionarios`, exibindo as unidades em que o usuário é administrador ou gerente. A troca de unidade limpa os filtros e descarta respostas anteriores. A tela reúne resumo da unidade, busca por nome/SKU, categoria, situação, tabela paginada, cadastro/edição de produtos e gestão de categorias. A consulta `GET /v1/tenants/{tenant_id}/stock` carrega lista, categorias e indicadores em uma única consulta SQL após estabelecer o contexto, com limite de 30 itens por página e cursor vinculado à unidade e aos filtros.

Os formulários usam os endpoints já existentes de produtos e categorias, com chave de idempotência e versão esperada nas edições. O preço é convertido diretamente para centavos, com suporte à vírgula decimal. Unidades suspensas permanecem em modo de consulta. Esta entrega usa o catálogo existente: não cria saldos físicos, estoque mínimo ou movimentações de entrada/saída. Não exige migration no banco.

Validação: teste integrado com criação de categoria/produtos sintéticos, filtros de situação e busca literal, paginação, rejeição de cursor de outro restaurante e permissões de gerente/garçom. A consulta de estoque respeita o orçamento de cinco comandos SQL por requisição, incluindo contexto. Revisão visual da listagem, estado vazio e formulário; validação de preço com casas decimais excessivas; testes de centavos e preços inválidos em `npm run web:test`.


## Caixa

### Descontos e impressão na quitação

Na conferência da comanda, caixa, gerente e administrador podem informar um desconto adicional em reais e seu motivo antes do primeiro recebimento. A API preserva os limites acumulados por perfil configurados em `cashier_discount_limit_bps` e `manager_discount_limit_bps`; acima do limite, a solicitação fica pendente de aprovação e o valor ainda não é descontado. O limite padrão do caixa é zero: o administrador deve configurar um limite autorizado pela API de configurações para permitir descontos diretos. A interface informa quando é necessário aguardar aprovação e atualizar os valores.

O desconto também pode ser aplicado à comanda já aguardando caixa, antes de qualquer recebimento. Nesse caso a liquidação anterior é preservada como substituída e uma nova revisão congela os valores recalculados, sem reabrir o consumo. Após qualquer pagamento, novos descontos são bloqueados.

Ao registrar o último pagamento, o caixa encerra a comanda e libera a mesa. A opção **Imprimir recibo ao quitar e encerrar a comanda** vem marcada e abre a impressão do navegador após confirmação do encerramento. Quitação parcial não imprime. O recibo não fiscal inclui restaurante, mesa/comanda, pessoas e cortesias, consumo com adicionais e totais calculados pelo servidor, abertura/fechamento no fuso do restaurante, pagamentos, troco, serviço e descontos ativos com motivo. Há botão **Imprimir recibo** para repetir a impressão enquanto a conferência permanece aberta. Falha ao gerar/imprimir o recibo não desfaz o recebimento. A seleção da impressora e a confirmação da impressão são feitas pelo navegador; não há impressão silenciosa ou integração fiscal.

`/caixa` usa o filtro comum de restaurante e permite acesso a administradores, gerentes e operadores de caixa. A visão consolidada `GET /v1/tenants/{tenant_id}/cash-overview` retorna terminais, até 20 turnos recentes, resumo do turno selecionado, últimos 100 lançamentos e até 50 comandas ativas, com busca por número de comanda/mesa. O operador consulta somente seus turnos; a API rejeita a seleção de turno de outra pessoa. Administradores e gerentes podem consultar os turnos da unidade.

O turno exibido fica fixado após o carregamento, evitando que um turno recém-aberto por outra pessoa substitua silenciosamente a seleção. Abertura, suprimento, sangria e fechamento usam os endpoints existentes, com idempotência e versões. O formulário de movimentação/fechamento conserva o saldo e a versão do momento em que foi aberto; alterações concorrentes exigem atualização e conferência. Novos terminais são cadastrados apenas por administradores e gerentes. Unidades suspensas não abrem turnos novos, mas podem concluir os já existentes.

O fechamento pede contagem física, calcula a diferença e exige justificativa acima da tolerância configurada, além de confirmação explícita. Recebimentos líquidos incluem todos os meios, mas o saldo esperado da gaveta inclui apenas dinheiro, suprimentos e sangrias. Turnos fechados mostram os valores gravados na conferência.

Na seção de comandas é possível conferir o consumo, iniciar o fechamento com escolha do serviço, registrar pagamentos parciais (dinheiro, Pix, crédito, débito e outros), informar dinheiro entregue para cálculo de troco e encerrar a comanda quitada. Cada recebimento exige confirmação explícita de que o valor já foi recebido; o sistema registra a operação, sem acionar um provedor de pagamentos. O histórico de recebimentos aparece na conferência da comanda. Estornos continuam sujeitos ao fluxo sensível existente na API e não são disparados por esta tela.

Validação: teste integrado com turno sintético, suprimento/sangria, recebimentos Pix e dinheiro, troco, fechamento com divergência, privacidade por operador e isolamento entre unidades. A visão consolidada respeita o orçamento de cinco comandos SQL incluindo contexto. Revisão visual do resumo, histórico e formulário de fechamento; divergência exibida e justificativa obrigatória verificadas no navegador. Nenhuma migration foi necessária.

## Dashboard financeiro

`/financeiro` permite consultar os restaurantes acessíveis a administradores, gerentes e operadores de caixa. Os filtros incluem hoje, últimos sete dias, mês atual e período personalizado de até 31 dias. Os atalhos usam o dia operacional calculado no servidor com o fuso e o horário de corte do restaurante. Datas personalizadas são aplicadas apenas após a confirmação do filtro; respostas de seleções anteriores são descartadas.

O endpoint `GET /v1/tenants/{tenant_id}/reports/financial` retorna indicadores, série diária, formas de pagamento e resumo de caixa em uma única consulta SQL após estabelecer o contexto de acesso. Aceita `period=today|week|month` (padrão: `week`) ou `start_date` e `end_date` inclusivos. Vendas e pagamentos são agregados separadamente para evitar multiplicar valores de comandas pagas em várias formas. Dias sem atividade aparecem com zero; dias com apenas estornos podem ter recebimento líquido negativo. Valores monetários são representados em centavos.

A tela mostra recebimentos líquidos, vendas de comandas encerradas, ticket médio, estornos, gráfico alternável entre recebimentos e vendas, participação de cada forma nos recebimentos brutos, consumo/descontos/serviço, suprimentos, sangrias, diferenças dos turnos fechados e tabela diária. Vendas seguem o dia operacional da comanda; pagamentos e movimentações seguem o dia operacional do turno. Suprimentos e sangrias não entram nas vendas. O relatório é operacional não fiscal e não calcula lucro ou despesas que não existem no modelo atual.

As consultas utilizam o cache em memória existente. Operações relacionadas de comanda, pagamento e caixa invalidam os relatórios do restaurante afetado; mudanças de configurações também invalidam os relatórios para respeitar alterações de fuso ou corte. Não há consulta periódica automática nem sincronização de alterações externas.

Validação local: 102 testes da API sem integração remota, 17 testes do front, TypeScript, Ruff e compilação de produção aprovados. A consulta SQL real foi executada em PostgreSQL em memória com fixtures de vendas, pagamentos divididos, estornos, turnos, movimentos, dias vazios e outro restaurante. Os testes integrados em `tests/api/test_financial.py` estão preparados, mas a execução remota foi bloqueada pela revisão automática por criar registros financeiros no Supabase. A revisão visual não pôde ser concluída porque a ferramenta não confirmou a URL do Chrome. Nenhuma migration foi necessária.


### Logins de funcionários

No cadastro de funcionários, marque **Cadastrar como usuário também** para definir
nome, usuário único (3 a 40 letras minúsculas, números, `.`, `_` ou `-`), senha
(mínimo 8 caracteres) e perfil Garçom ou Operador de caixa. O login aceita usuário
ou e-mail. Garçom acessa mesas; caixa acessa mesas e caixa. Relatórios financeiros
ficam restritos a gerentes e administradores.

Aplique a migração `20261027203902_employee_logins.sql` e configure
`SUPABASE_SECRET_KEY` (ou `SUPABASE_SERVICE_ROLE_KEY`) no ambiente da API.
Esta credencial administrativa nunca deve ter prefixo `NEXT_PUBLIC_`.
As contas usam um endereço interno derivado do usuário, sem envio de e-mail.
O fluxo de convite por e-mail continua disponível para contas existentes.
Se a transação falhar, a API tenta remover a conta criada; falhas nessa compensação
são registradas como `employee_login_cleanup_failed` para revisão operacional.

## Configurações da unidade

A rota `/configuracoes`, disponível no menu de administradores (`owner`), permite selecionar a unidade e editar taxa de serviço, limites de desconto de caixa e gerente, tolerância de divergência em reais, fuso IANA e horário de corte do dia operacional. Usa GET/PATCH de settings existentes, com versão e chave de idempotência. Conflitos exigem recarregar os valores antes de salvar novamente. Percentuais são convertidos para pontos-base e reais para centavos. Não exige migration. A alteração invalida os relatórios pelo cache existente.

## Recuperação de senha

O login oferece **Esqueci minha senha**, com solicitação em `/recuperar-senha`. O link enviado pelo Supabase retorna a `/auth/nova-senha`, que valida a sessão de recuperação, remove os tokens da barra de endereço e permite definir e confirmar uma senha de 8 a 128 caracteres. Após salvar, encerra a sessão local e orienta novo login. Links ausentes, inválidos ou expirados oferecem nova solicitação. A confirmação do envio não revela se o e-mail está cadastrado. Contas internas de funcionários devem procurar o administrador.

Em Supabase Authentication → URL Configuration → Redirect URLs, permitir `http://localhost:3000/auth/nova-senha` no desenvolvimento e a URL HTTPS equivalente na publicação. O template de recuperação deve preservar `{{ .ConfirmationURL }}`. Entrega real depende do provedor de e-mail/SMTP configurado. Não exige migration. A entrega de e-mail real e o ciclo completo pelo link não foram verificados nesta implementação.

## Atualização entre dispositivos

Caixa, financeiro e detalhes de comandas consultam o servidor a cada 15 segundos enquanto a aba está visível e online, e também ao retornar à janela ou recuperar conexão. As consultas ignoram o cache de leitura, não se sobrepõem e são canceladas ao trocar de unidade/recurso ou sair da tela. Falhas de rede preservam os últimos dados; caixa e financeiro removem os dados quando a API rejeita autorização.

O caixa pausa a visão geral durante operações e recebimentos para preservar os valores conferidos. A conferência monitora alterações externas e bloqueia ações até o operador atualizar os valores. A comanda pausa consultas automáticas enquanto há edição de pessoas, serviço, observações ou itens no carrinho. Campos em foco também adiam consultas. Atualizações existentes por versão e idempotência continuam sendo a proteção final contra concorrência. Esta sincronização usa consultas periódicas HTTP; a convergência normalmente ocorre no próximo ciclo de 15 segundos, sem depender do worker de Broadcast. Não exige migration.

## Adicionais de produtos

Em Estoque → Editar produto, a seção Adicionais permite criar e editar grupos (nome, mínimo/máximo de escolhas e estado ativo), opções (nome, preço e estado ativo), e vincular/desvincular grupos ao produto. Grupos são compartilhados entre produtos; a interface avisa que editar seus dados afeta todos os vínculos. Para produtos novos, primeiro salve o produto e depois abra a edição. Cada operação é salva separadamente pela API existente, com versão e idempotência; erros oferecem recarregar para revisar conflitos.

O atendimento carrega o catálogo com grupos e opções ativos. Selecionar um produto mostra seus adicionais e limites; escolhas obrigatórias e máximo de 50 adicionais são validados antes de adicionar ao pedido. Cada linha conserva suas escolhas no carrinho e envia `modifier_option_ids` à API, que valida vínculos, preços e limites novamente. O consumo mostra os nomes gravados dos adicionais e o preço da linha incluindo complementos. Caixa e recibo já utilizam os snapshots existentes. Nenhuma migration necessária.

Validação: TypeScript e 23 testes existentes do front aprovados; a verificação do fluxo completo no navegador permanece pendente.

## Aprovações

`/aprovacoes` permite a gerentes e administradores selecionar uma unidade, consultar todas as páginas de solicitações e aprovar descontos e cancelamentos de itens pela API existente. A lista apresenta motivo, valor do desconto, referências, solicitante e expiração. Ao revisar, consulta o número atual da comanda e o item solicitado. A confirmação executa a alteração; não existe ação de rejeição na API atual.

A lista atualiza a cada 15 segundos enquanto visível e online, pausando durante a confirmação. Solicitações expiradas desaparecem automaticamente. Aprovações usam uma chave de idempotência preservada em tentativas após falha de rede. Conflitos recarregam a lista; limites do aprovador, versões e permissões continuam validados no servidor. Trocar de unidade cancela leituras anteriores. Sem migration.

Validação: TypeScript e os 23 testes existentes do front aprovados. Fluxo visual e aprovação real no navegador ainda não verificados.
