#!/usr/bin/env bash
# Install ER2-ENGINE into the current Quarto project, after checking that
# everything it needs is present.
#
#   ./install.sh            check the prerequisites, then install the extension
#   ./install.sh --check    only report what is present and what is missing
#   ./install.sh --no-check install without checking first
#
# The extension can also be installed directly, without cloning this repo:
#
#   quarto add oeistools/ER2-ENGINE
set -uo pipefail

REPO="oeistools/ER2-ENGINE"
QUARTO_MIN="1.9.0"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

# Compare dotted versions: version_ge 1.9.38 1.9.0
version_ge() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]
}

MISSING=0

check_quarto() {
  if ! command -v quarto >/dev/null 2>&1; then
    bad "quarto not found — install it from https://quarto.org/docs/download/"
    MISSING=$((MISSING+1)); return
  fi
  local v; v="$(quarto --version 2>/dev/null)"
  if version_ge "$v" "$QUARTO_MIN"; then
    ok "quarto $v (engine extensions need >= $QUARTO_MIN)"
  else
    bad "quarto $v is too old — engine extensions need >= $QUARTO_MIN"
    MISSING=$((MISSING+1))
  fi
}

# The Python the engine will use, found the same way the engine finds it
# (src/er2.ts, resolvePython): $ER2_PYTHON, else the interpreter the `er2`
# command was installed with, else python3.
er2_python() {
  if [ -n "${ER2_PYTHON:-}" ]; then echo "$ER2_PYTHON"; return; fi
  local er2 first second
  er2=$(command -v er2 2>/dev/null) || { echo python3; return; }
  case "$er2" in
    *.exe|*.EXE)
      # A Windows launcher keeps the interpreter as text near its end.
      local found
      found=$(tail -c 65536 "$er2" | LC_ALL=C grep -aoE '[A-Za-z]:\\[^"<>|*?]*pythonw?\.exe' | tail -1)
      echo "${found:-python}"; return ;;
  esac
  first=$(head -1 "$er2"); second=$(sed -n 2p "$er2")
  case "$first" in
    '#!/bin/sh'*)
      # pip's wrapper for a path with spaces: '''exec' "/path/python" ...
      second=${second#\'\'\'exec\' \"}; echo "${second%%\"*}" ;;
    '#!/usr/bin/env '*) echo "${first#\#!/usr/bin/env }" ;;
    '#!'*)              echo "${first#\#!}" ;;
    *)                  echo python3 ;;
  esac
}

check_er2() {
  local py; py="$(er2_python)"
  if command -v er2 >/dev/null 2>&1; then
    ok "er2 command at $(command -v er2)"
  elif [ -z "${ER2_PYTHON:-}" ]; then
    warn "no er2 command on PATH; trying $py"
  fi
  local v; v="$("$py" -c 'import er2; print(er2.__version__)' 2>/dev/null)"
  if [ -z "$v" ]; then
    bad "$py cannot import er2 — install ER2 (https://github.com/oeistools/ER2):"
    echo "        uv tool install er2"
    echo
    echo "        If ER2 is installed in another environment, put this in your document:"
    echo "            er2:"
    echo "              python: /path/to/python"
    MISSING=$((MISSING+1)); return
  fi
  ok "er2 $v in $py"

  # A working ER2 must actually evaluate ER2: ^ is a power, / is exact.
  local answer
  answer="$(printf 'import er2\nfrom er2 import prelude\nprint(eval(er2.preparse("2^10 + 1/2"), prelude.namespace()))\n' \
            | "$py" - 2>&1 | tr -d '[:space:]')"
  if [ "$answer" = "2049/2" ]; then
    ok "ER2 evaluates 2^10 + 1/2 exactly"
  else
    bad "ER2 did not evaluate 2^10 + 1/2 as expected (got: ${answer:-<nothing>})"
    MISSING=$((MISSING+1))
  fi

  if "$py" -c 'import matplotlib' 2>/dev/null; then
    ok "matplotlib is available for figures"
  else
    warn "matplotlib is not installed in that environment; figures need it"
  fi
}

check_extension() {
  if [ -f "_extensions/er2/er2.js" ] ||
     [ -f "_extensions/oeistools/er2/er2.js" ]; then
    ok "the er2 engine is installed in this project"
  else
    warn "the er2 engine is not installed in this project yet"
  fi
}

echo "ER2-ENGINE — checking prerequisites"
echo
check_quarto
check_er2
[ "${1:-}" = "--check" ] && check_extension
echo

if [ "${1:-}" = "--check" ]; then
  if [ "$MISSING" -eq 0 ]; then echo "Everything needed is present."; exit 0
  else echo "$MISSING requirement(s) missing."; exit 1; fi
fi

if [ "$MISSING" -ne 0 ] && [ "${1:-}" != "--no-check" ]; then
  echo "Not installing: $MISSING requirement(s) missing (use --no-check to override)."
  exit 1
fi

echo "Installing $REPO into $(pwd) ..."
if quarto add "$REPO" --no-prompt; then
  echo
  ok "installed"
  cat <<'EOT'

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
EOT
else
  echo
  bad "quarto add failed"
  exit 1
fi
