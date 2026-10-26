# Validação da API — 26/10/2026

## Evidências

| Verificação | Resultado |
|---|---|
| Inicialização Uvicorn + conexão real | Aprovada; `/health/live` e `/health/ready` responderam 200 |
| Proteção HTTP sem token | 401 com envelope padrão e `WWW-Authenticate: Bearer` |
| Contrato OpenAPI | 71 operações em 53 caminhos, incluindo saúde; tipos TypeScript gerados |
| Testes unitários atuais | 74 aprovados |
| Integração HTTP/SQL | 22 cenários atuais aprovados em execuções de integração e verificações dirigidas após ajustes |
| Cálculo isolado (`domain.finance`) | Cobertura 100% na execução dirigida |
| JWT/MFA (`core.auth`) | Cobertura 95% na execução dirigida |
| Checks de permissão (`core.permissions`) | Cobertura 100% na execução dirigida |
| Gate combinado de cálculo/JWT/permissões | 96,84%, acima do gate de 85% |
| Migrations do zero | Nove migrations aplicadas em PostgreSQL embarcado vazio, com 27 tabelas protegidas por RLS |
| Supabase remoto | Migrations aplicadas; nomes/versões locais sincronizados com o histórico remoto |
| Checks de conexão/RLS originais | TLS, role restrita, schema privado, Auth, FKs e isolamento A/B aprovados |
| Qualidade | Ruff, TypeScript e `pip check` aprovados |

O total atual coletado pelo pytest é de 96 casos. Durante o desenvolvimento também houve uma execução completa com 149 casos antes de simplificar testes de matriz redundantes; todos passaram. Os ajustes posteriores de onboarding e anulação de desconto tiveram testes dirigidos, incluindo repetição do cenário financeiro de referência. Não se trata de medição de cobertura de produção nem de homologação operacional.

## Cenários relevantes

- Subtotal 6.400, desconto 400, serviço 600, total 6.600 centavos.
- Parciais de 4.000 em dinheiro e 2.600 em Pix, troco de 1.000 e saldo final zero.
- Estorno parcial compensatório, excesso de estorno negado e turno histórico preservado.
- Duas quitações simultâneas não duplicam recebimento.
- Duas requisições com a mesma chave criam um pedido.
- Aberturas simultâneas da mesma mesa deixam apenas uma comanda ativa.
- Novo pedido versus início de fechamento e pagamento versus encerramento de turno têm somente um vencedor válido.
- Falha depois da gravação e antes do commit desfaz a comanda; repetir a chave depois da falha funciona.
- Aprovação executada uma única vez, limite do aprovador respeitado e último proprietário protegido.
- Anulação de desconto preserva seu valor original e autoria, permitindo corrigir consumo antes de pagamentos.
- Isolamento A/B por HTTP e SQL, usuário bloqueado negado, contexto limpo após rollback e FK composta impedindo relacionamento cruzado.
- Canal privado exige tópico e vínculo corretos; cliente não publica mensagens. Lease incorreto não confirma outbox.
- CSV privado, negação para outro tenant e verificação de proprietário no worker; resultado com expiração configurada.
- Operador da plataforma provisiona metadados, sem adquirir acesso automático às comandas do novo restaurante.

Os testes HTTP de negócio substituem a dependência de identidade por identidades sintéticas; o verificador JWT tem testes independentes com assinatura real, claims inválidas, adulteração e falhas de JWKS/Auth. As transações e a role SQL de execução são reais. Usuários/tenants sintéticos foram removidos ao final, e testes SQL descartáveis usam rollback.

## Limites desta verificação

Não houve login/MFA com conta operacional pelo navegador, carga de 500 sessões, prova de latência p95, restore de backup, build Docker, execução do workflow no GitHub ou deploy público. A conexão testada é a direta com TLS; pooler deve ser validado no ambiente escolhido. O servidor HTTP temporário foi encerrado após a verificação; inicie com `npm run api:dev`.

O advisor de segurança indicou proteção contra senhas vazadas desabilitada no Auth. Essa configuração deve ser avaliada/habilitada no painel antes de produção: [orientação oficial](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). A tabela privada de rate limit tem RLS sem policy e sem grants diretos, intencionalmente; somente a função autorizada manipula os contadores. Índices sem uso recente são informativos em um banco novo.
