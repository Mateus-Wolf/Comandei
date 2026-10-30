@echo off
setlocal
title Comandei - API
cd /d "%~dp0"

echo Iniciando a API em http://127.0.0.1:8000 ...
echo Documentacao: http://127.0.0.1:8000/docs
call npm run api:dev
set "codigo=%errorlevel%"

if not "%codigo%"=="0" (
    echo.
    echo Nao foi possivel iniciar a API. Confira o erro acima.
    pause
)
exit /b %codigo%
