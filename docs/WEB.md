# Login e cadastro

As telas Next.js usam o Supabase Auth já configurado em `.env.local` e a API FastAPI para consultar os vínculos com restaurantes.

```powershell
npm run api:dev
# Em outro terminal:
npm run web:dev
```

Abra http://localhost:3000. Rotas: `/entrar`, `/cadastro`, `/auth/confirm` e `/conta`.

O formulário pede nome (`app.profiles.display_name`), e-mail e senha (Supabase Auth), além da confirmação da senha. A criação do usuário salva automaticamente o nome no perfil por trigger. Metadados do cadastro nunca concedem permissões ou vínculo a restaurante; o onboarding continua assistido, conforme a documentação. A tela da conta exibe os vínculos retornados por `/v1/me/tenants`.

No painel Supabase, em **Authentication → URL Configuration**, inclua `http://localhost:3000/auth/confirm` nas Redirect URLs e configure a Site URL correspondente. Ao publicar, cadastre também a URL HTTPS real de confirmação e ajuste a Site URL. Configure SMTP para entrega dos e-mails em produção. Sem configurar a URL permitida, o Supabase pode enviar o usuário para a Site URL padrão.

`NEXT_PUBLIC_API_URL` aponta para a API (padrão: `http://localhost:8000`). Em outro domínio, ajuste também `CORS_ORIGINS` no backend. A URL e a chave publicável do Supabase são as únicas credenciais necessárias no cliente; senhas SQL ficam fora dos arquivos do frontend e do Git.

Validação: `npm run typecheck`, `npm run web:build`, `npm run db:replay`. O replay valida a persistência do perfil e impede que metadados de cadastro criem membros proprietários. A interface foi revisada em navegador desktop e viewport móvel, incluindo campos obrigatórios, divergência de senha, mostrar/ocultar senha e redirecionamento de conta sem sessão. Não é necessário desabilitar a confirmação de e-mail.

O teste integrado `scripts/test-web-auth.mjs` foi executado com a API ligada: login real no Supabase, perfil salvo, JWT aceito pela API, lista vazia de restaurantes, logout e rejeição de senha incorreta. Não envia e-mails: cria uma identidade sintética e a remove ao concluir. Para repetir **somente em desenvolvimento/teste**, defina `RUN_DB_TESTS=1` e execute `node --env-file=.env.local scripts/test-web-auth.mjs`. A entrega de e-mail/abertura do link em uma caixa postal real não foi testada.

Regressão após a migração: **96 testes da API aprovados**, incluindo os 22 testes de integração no PostgreSQL real. Compilação de produção, TypeScript e replay das 10 migrations aprovados. Auditoria npm das dependências de produção: nenhuma vulnerabilidade conhecida.
