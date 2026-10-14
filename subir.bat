@echo off
setlocal enabledelayedexpansion
title Despliegue a GitHub (GitHub Actions)
chcp 65001 >nul
cd /d "%~dp0"

echo =====================================================================
echo       FLUJO: DESCOMPRIMIR + CONTROL DE CAMBIOS + GITHUB ACTIONS
echo =====================================================================
echo.

:: -------------------------------------------------------------
:: 1. LOCALIZAR Y DESCOMPRIMIR EL ARCHIVO ZIP
:: -------------------------------------------------------------
set "zip_path="

:: Buscar si hay un zip dentro de la carpeta del proyecto
for %%F in (*.zip) do (
    set "zip_path=%%~fF"
)

:: Si no esta adentro, buscar en la carpeta superior
if not defined zip_path (
    if exist "..\hubops-suite.zip" set "zip_path=%~dp0..\hubops-suite.zip"
    if exist "..\HubSpotOperSuite.zip" set "zip_path=%~dp0..\HubSpotOperSuite.zip"
)

if defined zip_path (
    echo [INFO] Archivo ZIP detectado: !zip_path!
    set /p "descomprimir=Deseas descomprimir y sobrescribir archivos? (S/N, Enter para Si): "
    if "!descomprimir!"=="" set "descomprimir=S"
    if /i "!descomprimir!"=="S" (
        echo Descomprimiendo archivos...
        powershell -Command "Expand-Archive -Path '!zip_path!' -DestinationPath '.' -Force"
        if !errorlevel! neq 0 (
            echo [ERROR] No se pudo descomprimir el archivo.
            pause
            exit /b 1
        )
        echo [OK] Archivos extraidos y actualizados con exito.
    )
) else (
    echo [AVISO] No se encontro archivo ZIP. Se usaran los archivos existentes.
)

:: -------------------------------------------------------------
:: 2. DETECCION DE CAMBIOS REALES (LOG DETALLADO)
:: -------------------------------------------------------------
echo.
echo =====================================================================
echo  ARCHIVOS MODIFICADOS DETECTADOS POR GIT (Diff real de contenido)
echo =====================================================================
git status -s

echo.
git add .

set /p msg="Mensaje para el commit (Enter para 'Update desde Google AI Studio'): "
if "%msg%"=="" set msg=Update desde Google AI Studio

echo.
echo Guardando cambios en Git local...
git commit -m "%msg%"

:: -------------------------------------------------------------
:: 3. SUBIDA A GITHUB Y MONITOREO
:: -------------------------------------------------------------
echo.
echo Subiendo cambios a GitHub (git push origin main)...
git push origin main
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] No se pudo subir el codigo a GitHub. Revisa tu red o credenciales.
    pause
    exit /b 1
)

echo.
echo =====================================================================
echo  LISTO: El commit llego a GitHub.
echo  GitHub Actions ya inicio el despliegue automatico en tu VPS.
echo =====================================================================
echo.
echo Abriendo consola de GitHub Actions en tu navegador para ver el log...
start https://github.com/javiercullashuapaya3/HubSpotOperSuite/actions

pause