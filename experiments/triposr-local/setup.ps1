param(
    [string]$PythonExe = '',
    [string]$IndexUrl = 'https://pypi.org/simple',
    [string]$TorchIndexUrl = 'https://download.pytorch.org/whl/cpu',
    [switch]$DirectDownload
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path '.venv/Scripts/python.exe')) {
    if (-not $PythonExe) {
        $PythonExe = & py -3.12 -c 'import sys; print(sys.executable)'
        if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.12 or pass -PythonExe with its full path.' }
    }
    & $PythonExe -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create Python environment.' }
}
& .\.venv\Scripts\python.exe -m pip install --index-url $TorchIndexUrl torch==2.6.0 torchvision==0.21.0
if ($LASTEXITCODE -ne 0) { throw 'PyTorch installation failed.' }
& .\.venv\Scripts\python.exe -m pip install --index-url $IndexUrl -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
$downloadArgs = @('download.py')
if ($DirectDownload) { $downloadArgs += '--direct' }
& .\.venv\Scripts\python.exe @downloadArgs
if ($LASTEXITCODE -ne 0) { throw 'Source or model download failed. Re-run setup to resume.' }
Write-Host 'Ready. Double-click launch.cmd.'
