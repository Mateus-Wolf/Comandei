@echo off
setlocal
title Comandei - Front
cd /d "%~dp0"

echo Iniciando o front em http://localhost:3000 ...
call npm run web:dev
set "codigo=%errorlevel%"

if not "%codigo%"=="0" (
    echo.
    echo Nao foi possivel iniciar o front. Confira o erro acima.
    pause
)
exit /b %codigo%
