#!/usr/bin/env bash
# Render every test document and check the output for the expected markers.
#
#   ./tests/run-tests.sh          run all tests
#   ./tests/run-tests.sh state    run tests whose name matches "state"
#
# The engine finds ER2 the way it does for a user: $ER2_PYTHON, else the
# interpreter of the `er2` command on PATH. Set ER2_PYTHON to test against a
# particular ER2 checkout.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
FILTER="${1:-}"
PASS=0; FAIL=0; SKIP=0
LOG="${TMPDIR:-/tmp}/er2-engine-tests"
mkdir -p "$LOG"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

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

PY=$(er2_python)

# check <file> <present|absent> <pattern> <description>
check() {
  local file="$1" mode="$2" pat="$3" desc="$4"
  if grep -qF -- "$pat" "$file"; then found=yes; else found=no; fi
  if { [ "$mode" = present ] && [ "$found" = yes ]; } ||
     { [ "$mode" = absent ]  && [ "$found" = no  ]; }; then
    green "  PASS  $desc"; PASS=$((PASS+1))
  else
    red   "  FAIL  $desc (expected $mode: $pat)"; FAIL=$((FAIL+1))
  fi
}

render() {
  local qmd="$1"
  if ! quarto render "$qmd" --to html >"$LOG/render.log" 2>&1; then
    red "  ERROR rendering $qmd"; sed 's/^/        /' "$LOG/render.log" | tail -20
    return 1
  fi
  return 0
}

wanted() { [ -z "$FILTER" ] || [[ "$1" == *"$FILTER"* ]]; }

run_case() {
  local name="$1"; shift
  wanted "$name" || return 0
  echo "• $name"
  local qmd="tests/cases/$name.qmd" html="tests/cases/$name.html"
  if ! render "$qmd"; then FAIL=$((FAIL+1)); return; fi
  while [ $# -gt 0 ]; do
    check "$html" "$1" "$2" "$3"; shift 3
  done
}

echo "quarto $(quarto --version)   python $PY   er2 $("$PY" -c 'import er2; print(er2.__version__)' 2>/dev/null || echo MISSING)"
echo

run_case state \
  present '<code>42'           'a variable set in cell 1 is visible in cell 2' \
  present '(x - 1)*(x + 1)'     'a symbol declared with sym survives the cell' \
  present 'sourceCode er2'      'code is highlighted with the ER2 definition'

run_case options \
  absent  'ECHO_HIDDEN_CODE")'  'echo: false hides the source' \
  present 'ECHO_HIDDEN_CODE'    'echo: false still shows the output' \
  absent  'OUTPUT_HIDDEN<'      'output: false hides the output' \
  present 'OUTPUT_HIDDEN"'      'output: false still shows the source' \
  present 'NEVER_RUN'           'eval: false still shows the source' \
  absent  'NOT_INCLUDED'        'include: false drops the cell entirely' \
  present 'primes.er2'          'filename labels the code block' \
  present 'sourceCode er2 special' 'classes are added to the code block' \
  absent  'STDERR_HIDDEN<'      'warning: false hides stderr' \
  present 'STDOUT_KEPT<'        'warning: false keeps stdout'

run_case errors \
  present 'cell-output-error'   'Python exceptions are marked as error output' \
  present 'ZeroDivisionError: division by zero' 'the exception is shown' \
  present '&lt;cell 1&gt;", line 2' 'the traceback names the cell and line' \
  absent  'er2_runner.py'       'the runner is hidden from tracebacks' \
  absent  'preparser.py'        'ER2 internals are hidden from syntax errors' \
  present 'def broken(:'        'a syntax error shows the ER2 line' \
  present '<code>42</code>'     'the session survives an error' \
  present 'cell-output-stderr'  'a warning is shown as stderr' \
  present 'after the warning'   'a warning does not stop the cell'

run_case config \
  present '12345'               'the prelude is executed' \
  present '<code>(x + 1)^2</code>' 'latex: false shows plain text'

run_case asis \
  present '<h2'                 'output: asis is interpreted as markdown' \
  present 'made by ER2: 1024'   'asis output is ER2 output'

run_case inline \
  present 'is 100000000000000000039'  'inline code is evaluated' \
  present 'has 21 digits'             'inline code sees the state of earlier cells' \
  present 'position: 42'              'an inline expression is ER2 (exact integers)' \
  present 'applies: 1/2'              'an inline expression is ER2 (exact division)' \
  present 'math inline">\(\left(x + 1\right)^{2}\)' 'inline latex() is inline maths' \
  present '`{er2} p`'                 'inline code inside a fenced block is left alone' \
  present 'still works: 1024'         'substitution resumes after a fenced block' \
  present '<code>```{er2}</code>'     'a code span showing a cell fence is not evaluated' \
  present '<code>`{er2}`</code>'      'a bare {er2} with no expression is not evaluated'

run_case display \
  present 'math display">\[x^{3} + 3 x^{2} + 3 x + 1\]' 'a SymPy value is display maths' \
  present 'math display">\[\frac{x^{2}}{2}\]'           'show() is display maths' \
  absent  '2^3 * 3^2 * 5'       'a trailing ; suppresses the value' \
  present '<code>a plain string</code>' 'a string is shown as text, without quotes' \
  present '<td>HTML_CELL</td>'  '_repr_html_ is raw HTML in an HTML page' \
  absent  'PLAIN_TABLE'         'the plain text is not shown beside the HTML'

# Outside an HTML page the HTML form must give way to the next one.
if wanted display; then
  echo "• display (non-HTML)"
  if quarto render tests/cases/display.qmd --to gfm >"$LOG/display-gfm.log" 2>&1; then
    check tests/cases/display.md absent  'er2-html-table' 'raw HTML is not emitted for gfm'
    check tests/cases/display.md present 'PLAIN_TABLE'    'the plain text is shown instead'
  else
    red "  ERROR rendering tests/cases/display.qmd to gfm"; FAIL=$((FAIL+1))
  fi
fi

# Highlighting is a component of its own: er2.xml is ER2's syntax definition,
# three rules on top of Python's. Assert on each rule, and on Python's still
# being there underneath.
run_case highlight \
  present '<span class="kw">sym</span>'     'sym is a keyword' \
  present '<span class="op">^^</span>'      '^^ is an ER2 operator' \
  present '<span class="bn">3r</span>'      'a raw literal is highlighted' \
  present '<span class="co"># a comment with sym and ^ inside</span>' 'sym in a comment is not a keyword' \
  present '<span class="st">"sym in a string"</span>' 'sym in a string is not a keyword' \
  present '<span class="cf">for</span>'     'Python keywords still highlight' \
  present '<span class="bu">range</span>'   'Python builtins still highlight'

# Figures need Matplotlib in the environment ER2 runs in, which ER2 itself
# does not depend on.
if wanted figures; then
  if "$PY" -c 'import matplotlib' 2>/dev/null; then
    rm -rf tests/cases/figures_files
    run_case figures \
      present 'figures_files/figure-er2/fig-primes-1.svg' 'a Matplotlib figure is saved as SVG for HTML' \
      absent  'matplotlib.lines.Line2D' 'the repr of plot artists is not shown' \
      present 'alt="A staircase plot"'  'fig-alt becomes the alt text' \
      present 'href="#fig-primes"'      'a labelled figure can be cross-referenced' \
      present 'Figure&nbsp;1'           'a labelled figure is numbered' \
      present 'figure-er2/cell-2-1.svg' 'an unlabelled figure is saved too'

    echo "• figures (non-HTML)"
    rm -rf tests/cases/figures_files
    if quarto render tests/cases/figures.qmd --to gfm >"$LOG/gfm.log" 2>&1; then
      if [ -f tests/cases/figures_files/figure-er2/fig-primes-1.png ]; then
        green "  PASS  a PNG is written for a non-HTML format"; PASS=$((PASS+1))
      else
        red   "  FAIL  no PNG was written"; FAIL=$((FAIL+1))
      fi
      check tests/cases/figures.md present '](figures_files/figure-er2/' \
        'the document references the figure file'
    else
      red "  ERROR rendering tests/cases/figures.qmd to gfm"; FAIL=$((FAIL+1))
    fi
  else
    echo "• figures"
    yellow "  SKIP  $PY has no Matplotlib"; SKIP=$((SKIP+1))
  fi
fi

# Freezing: a second render must replay the cache instead of re-running ER2,
# and the cached pandoc options must not contain an absolute path, because
# _freeze/ is committed and replayed on other machines.
#
# tests/freeze/ is a project of its own: Quarto honours `freeze` only when a
# whole project is rendered, and re-executes a document rendered on its own.
# The value is random, so a document that was re-executed cannot pass.
if wanted freeze; then
  echo "• freeze"
  rm -rf tests/freeze/_freeze tests/freeze/freeze.html
  if quarto render tests/freeze >"$LOG/frz.log" 2>&1; then
    first=$(grep -oE '[0-9]{15,}' tests/freeze/freeze.html | head -1)
    quarto render tests/freeze >"$LOG/frz2.log" 2>&1
    second=$(grep -oE '[0-9]{15,}' tests/freeze/freeze.html | head -1)
    if [ -n "$first" ] && [ "$first" = "$second" ]; then
      green "  PASS  a frozen document is not re-executed"; PASS=$((PASS+1))
    else
      red   "  FAIL  the document was re-executed despite freeze: true"; FAIL=$((FAIL+1))
    fi
    frz=$(find tests/freeze/_freeze -name '*.json' | head -1)
    if [ -n "$frz" ] && grep -q '_extensions/er2/er2.xml' "$frz" &&
       ! grep -q '"/[^"]*er2.xml"' "$frz"; then
      green "  PASS  the cached syntax-definition path is relative"; PASS=$((PASS+1))
    else
      red   "  FAIL  the cached syntax-definition path is not relative"; FAIL=$((FAIL+1))
    fi
    check tests/freeze/freeze.html present 'sourceCode er2' 'a frozen document is still highlighted'
  else
    red "  ERROR rendering the tests/freeze project"; FAIL=$((FAIL+1))
  fi
fi

# The error case must make the render fail.
if wanted fail-on-error; then
  echo "• fail-on-error"
  if quarto render tests/expect-fail/fail-on-error.qmd --to html >"$LOG/fail.log" 2>&1; then
    red   "  FAIL  an unhandled ER2 error should stop the render"; FAIL=$((FAIL+1))
  else
    green "  PASS  an unhandled ER2 error stops the render"; PASS=$((PASS+1))
    check "$LOG/fail.log" present 'ZeroDivisionError' 'the message shows the exception'
    check "$LOG/fail.log" present 'error: true'       'the message explains how to allow the error'
  fi
fi

# A Python without ER2 must be reported as such, not as a crash.
if wanted missing-er2; then
  echo "• missing-er2"
  if ER2_PYTHON=/nonexistent/python quarto render tests/expect-fail/fail-on-error.qmd \
       --to html >"$LOG/missing.log" 2>&1; then
    red   "  FAIL  a missing Python should stop the render"; FAIL=$((FAIL+1))
  else
    check "$LOG/missing.log" present 'could not start Python' 'a missing Python is explained'
    check "$LOG/missing.log" present 'python: /path/to/python' 'the message says how to fix it'
  fi
fi

echo
summary="$PASS passed, $FAIL failed"
[ "$SKIP" -gt 0 ] && summary="$summary, $SKIP skipped"
if [ "$FAIL" -eq 0 ]; then green "$summary"; exit 0
else red "$summary"; exit 1; fi
