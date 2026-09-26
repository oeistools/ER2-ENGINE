# PLAN

What this project sets out to do, how, and what it deliberately does not do.
The point of this file is that a decision made once should not have to be
re-argued. It follows the shape of
[PARI-GP-ENGINE](https://github.com/oeistools/PARI-GP-ENGINE)'s `PLAN.md`,
because this repository is that project's sibling: the same kind of
extension, the same layout, the same tests, for a different language.

## Goal

Make [ER2](https://github.com/oeistools/ER2) a first-class language in
Quarto: ` ```{er2} ` cells that execute, correct ER2 highlighting, and an
install that is one command.

````markdown
---
engine: er2
---

```{er2}
sym x
factor(x^2 - 1), phi(2^61 - 1), 1/3
```
````

## Why an engine, when ER2 already runs in Quarto

ER2 runs in Quarto today through its Jupyter kernel: `jupyter: er2` in the
front matter and ` ```{python} ` cells (ER2's ARCHITECTURE.md §1.2, D9). That
route stays, and it stays the one ER2 recommends for notebooks. What it cannot
do is execute a block labelled ` ```{er2} `: Quarto decides which engine owns a
block from its language, before any kernel is consulted, and its Jupyter
engine claims a fixed set of languages. ER2 measured this and wrote it down —
an ` ```{er2} ` block is silently copied through unexecuted.

ER2 also recorded why it did **not** write an engine extension: "since we
would need Jupyter to do the executing, that extension would be a
reimplementation of Quarto's Jupyter engine". That objection is to a
*Jupyter-backed* engine. This one is not Jupyter-backed. It does what
PARI-GP-ENGINE does with `gp`: run the language's own interpreter as an
external program, once per document, in batch. For ER2 that interpreter is
a Python that can `import er2`, and the "program" is a small runner script
shipped inside the extension. No kernel, no ZMQ, no ipykernel.

What the author gets, compared with the Jupyter route:

| | `jupyter: er2` + ` ```{python} ` | `engine: er2` + ` ```{er2} ` |
| --- | --- | --- |
| Source says ER2 | no | **yes** |
| Needs Jupyter / ipykernel | yes | **no** |
| Kernel daemon to restart | yes | **no** |
| Highlighting | via a Lua filter + `er2.xml` per project | **automatic** |
| Inline code | `` `{python} …` `` | `` `{er2} …` `` |
| Editor Python tooling in cells | **yes** | no |
| Mix with `{python}` cells | yes (same kernel) | no — one engine per document |

Both are legitimate; they serve different authors. This project does not
change ER2 and does not ask ER2 to change.

## Components

| Part | What it is |
| --- | --- |
| **Engine** | `_extensions/er2/er2.js`, compiled from `src/er2.ts`. Claims the `er2` language, collects cells and inline expressions, runs the runner once, and turns its results back into markdown. |
| **Runner** | `_extensions/er2/er2_runner.py`. Plain Python, stdlib plus `er2`. Reads a JSON job on stdin, executes every cell in one ER2 namespace, writes a JSON result on stdout. |
| **Highlighting** | `_extensions/er2/er2.xml`, ER2's own KDE syntax definition (`sym`, `5r`, `^^`, then `##Python`), injected into pandoc automatically. |

## Status

| Milestone | Status |
| --- | --- |
| M1 — cells execute | ✅ done (2026-09-25) |
| M2 — rich output and figures | ✅ done (2026-09-25) |
| M3 — packaging, docs, CI | ✅ done: CI green on Linux and macOS, docs live, v0.1.0 released (2026-09-25) |

## Milestones

No calendar dates. A milestone is done when its acceptance criteria pass.

### M1 — 0.1.0: cells execute

1. Scaffold in the PARI-GP-ENGINE layout: `_extensions/er2/`, `src/`,
   `tests/`, `examples/`, `tools/`, `_quarto.yml`, `Makefile`, `VERSION`,
   `CITATION.cff`, `CHANGELOG.md`, `LICENSE`, `CLAUDE.md`, `README.md`.
2. The runner: one namespace per document built with `er2.prelude`; each
   cell preparsed with `er2.preparse`, compiled with its last expression
   split off and evaluated for display, as a notebook does; stdout and
   stderr captured per cell; exceptions formatted as ER2 formats them
   (runtime frames hidden); `er2.session.start()` for ER2 printing.
3. The engine: config under `er2:` in the front matter, cell options
   (`eval`, `echo`, `output`/`asis`, `error`, `include`, `classes`,
   `filename`), inline `` `{er2} expr` `` outside fenced blocks, errors that
   stop the render unless `error: true`, timeout, a clear message when no
   Python with `er2` is found.
4. Finding the interpreter: `er2: python:` if given; otherwise the
   interpreter of the `er2` command on `PATH` (read from its shebang, which is
   how `uv tool install` and `pip install` both leave it); otherwise
   `python3`. The runner itself checks `import er2` and says how to fix it.
5. Highlighting: `er2.xml` copied from ER2 with its provenance recorded,
   injected with a path relative to the document (the PARI-GP-ENGINE
   `_freeze/` lesson).
6. `tests/run-tests.sh` with cases for state, options, errors, inline,
   asis, config, highlighting.

**Acceptance:** `make build && make test` passes on this machine against the
installed ER2; a document with ` ```{er2} ` cells using `sym`, `^`, exact
`1/3` and a PARI function renders to HTML with the right values.

### M2 — 0.2.0: rich output and figures

1. Display values carry MIME bundles: `text/plain` always; `text/latex`
   from `_repr_latex_` (every ER2 type and SymPy expression has one);
   `text/markdown` from `_repr_markdown_` (ER2's `Tex`, so `latex(f)` and
   `show(f)` become maths).
2. Output format decides: HTML-ish formats and LaTeX/PDF take the LaTeX
   representation as display maths; other formats (gfm, docx…) keep it as
   maths too, since pandoc converts it; `#| output: plain` (engine-specific)
   forces text.
3. Matplotlib figures: the runner forces the Agg backend (ER2 §1.3 notes
   the silent-Agg trap), and after each cell saves every open figure —
   SVG for HTML, PDF for LaTeX, PNG otherwise — into `<stem>_files/figure-er2/`,
   then closes them. `label`, `fig-cap`, `fig-alt`, `fig-width`.
4. Freezing: `canFreeze: true`; paths stored in `_freeze/` are relative.

**Acceptance:** tests for LaTeX display, `show()`, inline `latex(f)`,
a Matplotlib figure with a cross-reference, and a frozen document.

### M3 — 0.3.0: packaging, docs, CI

1. `install.sh` / `install.ps1` with `--check`, `make doctor`.
2. `tests/clean-install.sh`: `quarto add` into an empty directory.
3. `examples/`: `hello.qmd` and a numbered series (syntax, number theory,
   algebra, series, plots, a short article).
4. `docs/` Quarto website on the engine itself, `docs/_extensions` symlink.
5. GitHub Actions: `test.yml` (Linux, macOS; fails if the committed
   `er2.js` is stale), `clean-install.yml` weekly, `release.yml` on `v*`
   tags, `pages.yml`.
6. `make bump-version`, `release-check`, `tag`, `package`, `lint`, `fmt`.

**Acceptance:** CI green on Linux and macOS; the published release installs
with `quarto add` and renders a document with execution, inline code,
highlighting and a figure.

## Settled decisions

**Batch execution, not a persistent co-process.** Quarto's engine API is one
call that takes the whole document and returns markdown. All cells go to one
runner process in one JSON job, and come back as one JSON result. Session
state for free; deterministic.

**JSON over stdio, not sentinels.** PARI-GP-ENGINE splits gp's output on
sentinel lines because gp can only print text. The runner is Python, so it
returns structured results — per-cell stdout, stderr, display bundles,
error, figures — and none of the sentinel parsing (or its failure modes)
exists. The runner's own stdout is redirected per cell, so user `print`
cannot corrupt the JSON; the result is written to the original stdout file
descriptor only at the end.

**The runner is shipped with the extension, not with ER2.** `quarto add`
must be enough; asking ER2 for an `er2 --quarto-runner` entry point would
couple two release cycles. The runner uses only public or long-stable ER2
names (`preparse`, `prelude.inject`, `session.start`, `printing.latex`) and
fails with a version message if they are missing.

**The cell language is `er2`; the engine is `er2`.** Unlike PARI-GP-ENGINE's
`pari-gp`/`gp` split, ER2 has one name and uses it for both.

**The highlighting language class is `er2`**, matching `<language name="ER2">`
(pandoc lower-cases it), which is also what ER2's own `er2-cells.lua`
produces. A document rendered either way highlights the same.

**Last expression is displayed, as in a notebook.** ER2 users come from
Jupyter; a cell ending in `factor(360)` should show the factorisation
without `print`. A trailing `;` suppresses it, as in IPython.

**Python exceptions are errors; warnings are not.** `warnings.warn` output
goes to the stderr stream, shown but never stopping a render.

**MIT.** ER2 is MIT too; the runner imports it at run time, nothing is
vendored except `er2.xml`, whose licence is MIT and whose source is noted.

## Found while building

**Freeze is honoured only in whole-project renders.** Rendering one file
always executes it, so the freeze test renders `tests/freeze/` as a project
of its own, with a value that changes on every execution. PARI-GP-ENGINE's
freeze test renders a single file and passes only because gp's `random()`
has a fixed seed; that is recorded for a fix there.

**A code span that shows a fence is not an inline expression.** Prose like
"` ```{er2} ` cells" contains `` `{er2} ` ``; the inline pattern now needs a
lone opening backtick and a non-blank expression. The docs site found this
(PARI-GP-ENGINE's pattern has the same gap).

**`2^10 + 1/2` needs the prelude.** `er2.preparse` emits calls to
`__er2_int__`, which only `er2.prelude` defines; `install.sh --check`
evaluates with `prelude.namespace()` for that reason.

## Left for later

- ~~HTML display (`_repr_html_`)~~ — done: raw HTML in HTML formats only,
  the next representation elsewhere. No ER2 type has one, so ER2 values
  display exactly as before.
- **Windows is blocked upstream.** ER2 depends on `cypari2`, which has no
  Windows wheel on PyPI and no win-64 build on conda-forge (checked
  2026-09-25; conda-forge has PARI itself for win-64, not `cypari2`). A
  Windows CI job was tried and fails installing ER2, before the engine is
  reached, so it was removed along with `install.ps1`. The engine keeps
  its Windows code — `er2.exe` launcher discovery, `python` instead of
  `python3` — untested, for the day `cypari2` ships Windows wheels. Until
  then Windows users run Quarto and ER2 inside WSL.
- ~~Pinning CI to a released ER2 once ER2 is on PyPI, instead of its
  `main`~~ — done: `er2==0.7.0` from PyPI in the test, release and pages
  workflows; clean-install takes the latest, as a user would.

## Not planned

- Bundling ER2 or a Python. The user installs ER2 (`uv tool install er2`,
  or from git); the engine finds it.
- A Jupyter-backed engine. That is the design ER2 rejected, rightly.
- Mixing ` ```{er2} ` with ` ```{python} ` in one document. Quarto allows one
  engine per document; the Jupyter route is the answer when that is needed.
