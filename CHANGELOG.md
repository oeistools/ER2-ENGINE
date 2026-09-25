# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] — 2026-09-25

The first release: ER2 as a Quarto language, with ` ```{er2} ` cells that
execute in one ER2 session per document, without Jupyter.

### Added

**Execution**

- The engine (`engine: er2`), executing ` ```{er2} ` cells in one ER2
  session per document through `er2_runner.py`, with no Jupyter kernel.
- Cell options `eval`, `echo`, `output`/`asis`, `error`, `warning`,
  `include`, `latex`, `classes`, `filename`, `label`, `fig-cap`, `fig-alt`,
  `fig-width`; document options under `er2:`.
- Inline `` `{er2} expr` ``, with `latex(f)` as inline maths. A code span
  that shows a cell fence in prose is not taken for inline code, and an
  error in inline code quotes the expression.
- Freezing, with a relative syntax-definition path in `_freeze/`.

**Output**

- Notebook-style display of a cell's last expression, as maths when it has
  a LaTeX form; `show()` as display maths; a trailing `;` suppresses it.
- HTML display: a value with `_repr_html_` (a pandas `DataFrame`, say) is
  shown as a table in HTML formats, and as LaTeX or text elsewhere.
- Matplotlib figures, with captions and cross-references.
- ER2's syntax definition, injected automatically.

**Finding ER2**

- The Python ER2 runs in is found from `er2: python:`, `$ER2_PYTHON`, or
  the `er2` command on `PATH` — including pip's `#!/bin/sh` wrapper, which
  pip writes when the path has spaces or is too long for a shebang.
- The engine also looks inside a Windows `er2.exe` launcher. Untested: ER2
  itself cannot be installed on Windows yet, because `cypari2` has no
  Windows build; use WSL.
- `install.sh` with `--check`, used by `make doctor`.

**Project**

- Examples: `hello.qmd` and the series `01-syntax` to `05-plots`.
- The documentation site in `docs/`, rendered by the engine itself.
- `tests/run-tests.sh` and `make test`; `tests/clean-install.sh` and
  `make clean-install`.
- GitHub Actions: `test.yml`, `clean-install.yml`, `release.yml`,
  `pages.yml`.
