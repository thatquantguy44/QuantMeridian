@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Runs every local fallback snapshot pipeline for the terminal.
rem
rem Optional args:
rem   run_all_snapshot_fallbacks.bat [MARKET_START_DATE] [MACRO_START_YEAR]
rem
rem Defaults:
rem   MARKET_START_DATE=2015-01-01
rem   MACRO_START_YEAR=2000
rem
rem Optional env:
rem   FRED_API_KEY=...       Enables FRED econ snapshot + FRED master JSON refresh.
rem   AAII_SENTIMENT_URL=... Defaults to https://www.aaii.com/sentimentsurvey/sent_results.
rem   MDP_OFFLINE=1          Forces the market pipeline to synthetic/offline sources.
rem   MARKET_DATA_DIR=...    Defaults to market_data_pipeline\data\export.
rem   FRED_PYTHON_FALLBACK=1 Allows Node FRED refreshes to retry via Python fredapi.

set "ROOT=%~dp0.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"
cd /d "%ROOT%" || exit /b 1

set "MARKET_START_DATE=%~1"
if "%MARKET_START_DATE%"=="" set "MARKET_START_DATE=2015-01-01"

set "MACRO_START_YEAR=%~2"
if "%MACRO_START_YEAR%"=="" set "MACRO_START_YEAR=2000"

call :LoadEnv "%ROOT%\.env"
call :LoadEnv "%ROOT%\.proxy"

if "%MARKET_DATA_DIR%"=="" set "MARKET_DATA_DIR=%ROOT%\market_data_pipeline\data\export"
if "%AAII_SENTIMENT_URL%"=="" set "AAII_SENTIMENT_URL=https://www.aaii.com/sentimentsurvey/sent_results"
set "PYTHONPATH=%ROOT%;%PYTHONPATH%"
if "%MDP_ALLOW_YAHOO%"=="" set "MDP_ALLOW_YAHOO=1"
if "%MDP_MARKET_REFRESH_LOOKBACK_DAYS%"=="" set "MDP_MARKET_REFRESH_LOOKBACK_DAYS=14"

set "VENV=%ROOT%\batchers\.venv-snapshots"
set "PY=%VENV%\Scripts\python.exe"
set "FAILED=0"

echo.
echo === Market Terminal local snapshot fallback refresh ===
echo Root:              %ROOT%
echo Market start date: %MARKET_START_DATE%
echo Macro start year:  %MACRO_START_YEAR%
echo MARKET_DATA_DIR:   %MARKET_DATA_DIR%
echo.

if not exist "%PY%" (
  echo [setup] Creating local snapshot venv at %VENV%
  python -m venv "%VENV%" || exit /b 1
)

call "%VENV%\Scripts\activate.bat" || exit /b 1

echo [setup] Installing/updating Python pipeline dependencies
python -m pip install --upgrade pip || exit /b 1
python -m pip install -e "%ROOT%\services\macro_data_etl" || exit /b 1
python -m pip install polars duckdb pyarrow httpx tenacity pydantic pydantic-settings pyyaml fastapi "uvicorn[standard]" apscheduler structlog yfinance fredapi pytest pytest-asyncio || exit /b 1

if not exist "%ROOT%\node_modules" (
  echo [setup] Installing npm dependencies
  call npm install || exit /b 1
)

set "BACKUP=%ROOT%\batchers\.snapshot-backup\%DATE:/=-%_%TIME::=-%"
set "BACKUP=%BACKUP: =0%"
mkdir "%BACKUP%\src-data-etl" >nul 2>nul
mkdir "%BACKUP%\src-data-market" >nul 2>nul
mkdir "%BACKUP%\src-data" >nul 2>nul
if exist "%ROOT%\src\data\etl\*.json" copy /Y "%ROOT%\src\data\etl\*.json" "%BACKUP%\src-data-etl\" >nul
if exist "%ROOT%\src\data\market\*.json" copy /Y "%ROOT%\src\data\market\*.json" "%BACKUP%\src-data-market\" >nul
if exist "%ROOT%\src\data\sentimentAaiiSnapshot.json" copy /Y "%ROOT%\src\data\sentimentAaiiSnapshot.json" "%BACKUP%\src-data\" >nul

echo.
echo === 1. FRED committed econ snapshot + master JSON cache ===
if "%FRED_API_KEY%"=="" (
  echo [skip] FRED_API_KEY is not set. Econ snapshot and FRED master cache remain unchanged.
) else (
  call npm run refresh:fred-master || (echo [warn] FRED master refresh failed. Keeping existing cache where present. & set "FAILED=1")
  call npm run export:econ-snapshot || (echo [warn] Econ snapshot export failed. Keeping existing snapshot. & set "FAILED=1")
)

echo.
echo === 2. AAII investor sentiment snapshot ===
call npm run refresh:aaii-sentiment || (echo [warn] AAII sentiment refresh failed. Keeping existing snapshot. & set "FAILED=1")

echo.
echo === 3. Market data pipeline snapshots ===
python -m market_data_pipeline.cli run --start "%MARKET_START_DATE%" || (echo [warn] Market pipeline run failed. & set "FAILED=1")
python -m market_data_pipeline.cli export-views --out "%MARKET_DATA_DIR%" || (echo [warn] Market exported-file cache failed. & set "FAILED=1")
python -m market_data_pipeline.cli export-views --out "%ROOT%\src\data\market" || (echo [warn] Committed market snapshot export failed. & set "FAILED=1")

echo.
echo === 4. Macro ETL gold snapshots + FedWatch fallback ===
macro-etl run --source all --start-year "%MACRO_START_YEAR%" || (echo [warn] Macro ETL run finished with errors. Exporting available gold tables. & set "FAILED=1")
macro-etl fedwatch || (echo [warn] FedWatch pipeline failed. Keeping previous fed probability snapshot if export fails. & set "FAILED=1")

macro-etl export country_macro_latest --out "%ROOT%\src\data\etl" || set "FAILED=1"
macro-etl export inflation_timeseries --out "%ROOT%\src\data\etl" || set "FAILED=1"
macro-etl export policy_rate_timeseries --out "%ROOT%\src\data\etl" || set "FAILED=1"
macro-etl export fed_probabilities --out "%ROOT%\src\data\etl" || set "FAILED=1"

call :GuardMacroExports "%BACKUP%"

echo.
echo === 5. Verification ===
call npm run typecheck || set "FAILED=1"
call npm test || set "FAILED=1"
python -m pytest "%ROOT%\services\macro_data_etl\tests" || set "FAILED=1"

echo.
echo === Snapshot fallback refresh complete ===
echo Local exported market cache: %MARKET_DATA_DIR%
echo Committed market fallback:   %ROOT%\src\data\market
echo Committed macro fallback:    %ROOT%\src\data\etl
echo Committed econ fallback:     %ROOT%\src\data\econSnapshot.json
echo Committed AAII fallback:     %ROOT%\src\data\sentimentAaiiSnapshot.json
echo FRED master cache:           %ROOT%\data\master
echo Backup for this run:         %BACKUP%
echo.

if "%FAILED%"=="1" (
  echo Completed with warnings or failures. Review the output above before committing snapshot changes.
  exit /b 1
)

echo Completed successfully.
exit /b 0

:LoadEnv
if not exist "%~1" exit /b 0
for /f "usebackq tokens=1,* delims==" %%A in ("%~1") do (
  set "ENV_KEY=%%A"
  set "ENV_VAL=%%B"
  if /I "!ENV_KEY:~0,7!"=="export " set "ENV_KEY=!ENV_KEY:~7!"
  if not "!ENV_KEY!"=="" if not "!ENV_KEY:~0,1!"=="#" (
    set "!ENV_KEY!=!ENV_VAL!"
  )
)
exit /b 0

:GuardMacroExports
set "RUN_BACKUP=%~1"
set "RESTORE_MACRO=0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='%ROOT%\src\data\etl\policy_rate_timeseries.json'; try { $j=Get-Content -Raw $p | ConvertFrom-Json; if (@($j).Count -eq 0) { exit 2 } } catch { exit 2 }" >nul 2>nul
if errorlevel 1 (
  echo [guard] policy_rate_timeseries export is empty or invalid. Restoring prior policy-rate fallback.
  set "RESTORE_MACRO=1"
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='%ROOT%\src\data\etl\country_macro_latest.json'; try { $j=Get-Content -Raw $p | ConvertFrom-Json; $n=@($j | Where-Object { $null -ne $_.policy_rate }).Count; if ($n -eq 0) { exit 2 } } catch { exit 2 }" >nul 2>nul
if errorlevel 1 (
  echo [guard] country_macro_latest has no policy rates. Restoring prior country macro fallback.
  set "RESTORE_MACRO=1"
)

if "%RESTORE_MACRO%"=="1" (
  if exist "%RUN_BACKUP%\src-data-etl\country_macro_latest.json" copy /Y "%RUN_BACKUP%\src-data-etl\country_macro_latest.json" "%ROOT%\src\data\etl\country_macro_latest.json" >nul
  if exist "%RUN_BACKUP%\src-data-etl\policy_rate_timeseries.json" copy /Y "%RUN_BACKUP%\src-data-etl\policy_rate_timeseries.json" "%ROOT%\src\data\etl\policy_rate_timeseries.json" >nul
)
exit /b 0
