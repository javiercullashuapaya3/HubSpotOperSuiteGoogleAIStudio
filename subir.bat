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
:: 1. LOCALIZAR Y DESCOMPRIMIR EL ARCHIVO ZIP MAS RECIENTE
:: -------------------------------------------------------------
set "zip_path="

:: Buscar el archivo ZIP mas reciente (. o .. o Downloads) usando PowerShell
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "$z = Get-ChildItem -Path '.', '..', ([Environment]::GetFolderPath('UserProfile') + '\Downloads') -Filter '*.zip' -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'HubSpot|hubops|applet|suite' -or $_.DirectoryName -eq (Get-Location).Path } | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if ($z) { $z.FullName }"`) do (
    set "zip_path=%%A"
)

if defined zip_path (
    echo [INFO] Archivo ZIP mas reciente detectado:
    echo        !zip_path!
    powershell -NoProfile -Command "$z = Get-Item '!zip_path!'; Write-Host '       Fecha de descarga:' $z.LastWriteTime ' | Tamano:' ([math]::Round($z.Length/1MB, 2)) 'MB'"
    echo.
    set /p "descomprimir=Deseas descomprimir y sobrescribir con esta version? (S/N, Enter para Si): "
    if "!descomprimir!"=="" set "descomprimir=S"
    if /i "!descomprimir!"=="S" (
        echo Descomprimiendo archivos...
        powershell -NoProfile -Command "Expand-Archive -Path '!zip_path!' -DestinationPath '.' -Force"
        if !errorlevel! neq 0 (
            echo [ERROR] No se pudo descomprimir el archivo.
            pause
            exit /b 1
        )
        echo [OK] Archivos extraidos y actualizados con exito desde el ZIP mas reciente.
    )
) else (
    echo [AVISO] No se encontro archivo ZIP reciente. Se usaran los archivos existentes en la carpeta.
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