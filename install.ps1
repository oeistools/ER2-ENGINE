<#
.SYNOPSIS
    Install ER2-ENGINE into the current Quarto project.

.DESCRIPTION
    Checks that Quarto (>= 1.9) and ER2 are available, then installs the
    extension with `quarto add`. The extension can also be installed directly,
    without cloning this repository:

        quarto add oeistools/ER2-ENGINE

    ER2 is looked for the way the engine looks for it: $env:ER2_PYTHON, else
    the interpreter recorded in the `er2` launcher on PATH, else `python`.

.PARAMETER Check
    Only report what is present and what is missing; install nothing.

.PARAMETER NoCheck
    Install without checking the prerequisites first.

.EXAMPLE
    ./install.ps1
.EXAMPLE
    ./install.ps1 -Check
#>
[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$NoCheck
)

$Repo      = 'oeistools/ER2-ENGINE'
$QuartoMin = [version]'1.9.0'
$script:Missing = 0

function Write-Ok   { param($m) Write-Host "  [OK] $m"   -ForegroundColor Green }
function Write-Bad  { param($m) Write-Host "  [--] $m"   -ForegroundColor Red; $script:Missing++ }
function Write-Warn { param($m) Write-Host "  [!!] $m"   -ForegroundColor Yellow }

function Test-Quarto {
    $exe = Get-Command quarto -ErrorAction SilentlyContinue
    if (-not $exe) {
        Write-Bad 'quarto not found - install it from https://quarto.org/docs/download/'
        return
    }
    $raw = (& quarto --version 2>$null | Select-Object -First 1).Trim()
    try { $v = [version]$raw } catch { $v = $null }
    if ($v -and $v -ge $QuartoMin) {
        Write-Ok "quarto $raw (engine extensions need >= $QuartoMin)"
    } else {
        Write-Bad "quarto $raw is too old - engine extensions need >= $QuartoMin"
    }
}

# The interpreter the engine will use (src/er2.ts, resolvePython). A Windows
# launcher - pip's or uv's - keeps the path of its Python as text near the
# end of the .exe; the last X:\...\python.exe there is the one.
function Get-Er2Python {
    if ($env:ER2_PYTHON) { return $env:ER2_PYTHON }
    $er2 = Get-Command er2 -ErrorAction SilentlyContinue
    if ($er2 -and $er2.Source -match '\.exe$') {
        $bytes = [System.IO.File]::ReadAllBytes($er2.Source)
        $start = [Math]::Max(0, $bytes.Length - 65536)
        $tail  = [System.Text.Encoding]::GetEncoding(28591).GetString(
                     $bytes, $start, $bytes.Length - $start)
        $found = [regex]::Matches($tail, '[A-Za-z]:\\[^\x00\r\n"<>|*?]*?pythonw?\.exe',
                                  'IgnoreCase')
        if ($found.Count -gt 0) { return $found[$found.Count - 1].Value }
    }
    return 'python'
}

function Test-Er2 {
    $er2 = Get-Command er2 -ErrorAction SilentlyContinue
    if ($er2) { Write-Ok "er2 command at $($er2.Source)" }
    elseif (-not $env:ER2_PYTHON) { Write-Warn 'no er2 command on PATH; trying python' }

    $py = Get-Er2Python
    $v = (& $py -c 'import er2; print(er2.__version__)' 2>$null | Out-String).Trim()
    if (-not $v) {
        Write-Bad "$py cannot import er2 - install ER2 (https://github.com/oeistools/ER2):"
        Write-Host '        uv tool install git+https://github.com/oeistools/ER2'
        Write-Host ''
        Write-Host '        If ER2 is installed in another environment, put this in your document:'
        Write-Host '            er2:'
        Write-Host '              python: C:/path/to/python.exe'
        return
    }
    Write-Ok "er2 $v in $py"

    # A working ER2 must actually evaluate ER2: ^ is a power, / is exact.
    $code = 'import er2' + "`n" + 'from er2 import prelude' + "`n" +
            'print(eval(er2.preparse("2^10 + 1/2"), prelude.namespace()))'
    $answer = (& $py -c $code 2>&1 | Out-String).Trim()
    if ($answer -eq '2049/2') {
        Write-Ok 'ER2 evaluates 2^10 + 1/2 exactly'
    } else {
        Write-Bad "ER2 did not evaluate 2^10 + 1/2 as expected (got: $answer)"
    }

    & $py -c 'import matplotlib' 2>$null
    if ($LASTEXITCODE -eq 0) { Write-Ok 'matplotlib is available for figures' }
    else { Write-Warn 'matplotlib is not installed in that environment; figures need it' }
}

function Test-Extension {
    if ((Test-Path '_extensions/er2/er2.js') -or
        (Test-Path '_extensions/oeistools/er2/er2.js')) {
        Write-Ok 'the er2 engine is installed in this project'
    } else {
        Write-Warn 'the er2 engine is not installed in this project yet'
    }
}

Write-Host 'ER2-ENGINE - checking prerequisites'
Write-Host ''
Test-Quarto
Test-Er2
if ($Check) { Test-Extension }
Write-Host ''

if ($Check) {
    if ($script:Missing -eq 0) { Write-Host 'Everything needed is present.'; exit 0 }
    Write-Host "$($script:Missing) requirement(s) missing."; exit 1
}

if ($script:Missing -ne 0 -and -not $NoCheck) {
    Write-Host "Not installing: $($script:Missing) requirement(s) missing (use -NoCheck to override)."
    exit 1
}

Write-Host "Installing $Repo into $(Get-Location) ..."
& quarto add $Repo --no-prompt
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Bad 'quarto add failed'
    exit 1
}

Write-Host ''
Write-Ok 'installed'
Write-Host @'

Use it by setting the engine in a document's front matter:

    ---
    title: "My document"
    engine: er2
    ---

    ```{er2}
    sym x
    factor(x^2 - 1), phi(2^61 - 1), 1/3
    ```

Then: quarto render my-document.qmd
'@
