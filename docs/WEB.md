# Login e cadastro

As telas Next.js usam o Supabase Auth já configurado em `.env.local` e a API FastAPI para consultar os vínculos com restaurantes.

```powershell
npm run api:dev
# Em outro terminal:
npm run web:dev
```

Abra http://localhost:3000. Rotas: `/entrar`, `/cadastro`, `/auth/confirm` e `/home`. O endereço anterior `/conta` redireciona para `/home`.

Após autenticar ou confirmar o e-mail, o usuário entra na home. A barra lateral contém Início, Restaurantes, Funcionários, Estoque, Caixa e Dashboard financeiro, além da identificação e Sair. No celular, o botão Menu abre e fecha a navegação. Funcionários, Estoque, Caixa e Financeiro mostram uma página de próxima etapa; o fluxo implementado nesta entrega é Restaurantes.

A troca entre login e cadastro anima a saída e a entrada do formulário, mantendo a ilustração parada. O login bem-sucedido anima a saída da tela e a entrada no espaço autenticado. A preferência `prefers-reduced-motion` desativa a animação e o atraso de navegação. Links mantêm o comportamento de abrir em nova aba com Ctrl/Cmd.

O formulário pede nome (`app.profiles.display_name`), e-mail e senha (Supabase Auth), além da confirmação da senha. A criação do usuário salva automaticamente o nome no perfil por trigger. Metadados do cadastro nunca concedem permissões ou vínculo a restaurante. A autorização de criar unidades vem de administradores aprovados no banco ou de um vínculo ativo de proprietário, com e-mail confirmado. A tela consulta `/v1/restaurants`, sem expor as tabelas privadas à Data API.

## Restaurantes e mesas

`/restaurantes` mostra as unidades vinculadas em cards e o botão Criar restaurante no topo direito. O formulário pede nome, foto opcional (JPG/PNG/WebP, até 5 MB), endereço, CNPJ, abertura, fechamento e atendimento (rodízio, à la carte ou ambos). O CNPJ é normalizado e tem os dígitos verificados, aceitando os formatos numérico e alfanumérico; isso não consulta a situação cadastral na Receita Federal. Horários que atravessam a meia-noite são aceitos.

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
