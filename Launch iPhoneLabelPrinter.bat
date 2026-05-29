@echo off
setlocal

rem Launch the iPhoneLabelPrinter app from a double-click on Windows.
rem Mirrors the macOS .command launcher: no shell parsing, clear error dialogs.

set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%" || (
    echo Could not change to project directory: %PROJECT_DIR%
    pause
    exit /b 1
)

if not exist "app.py" (
    echo app.py was not found next to this launcher.
    pause
    exit /b 1
)

if not exist ".venv\Scripts\pythonw.exe" (
    echo.
    echo The local Python environment is missing.
    echo Open a terminal in this folder and run:
    echo.
    echo     py -3.12 -m venv .venv
    echo     .venv\Scripts\activate
    echo     pip install --upgrade pip
    echo     pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)

rem pythonw.exe avoids opening a console window for the GUI app.
start "" ".venv\Scripts\pythonw.exe" "app.py"

endlocal
