# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [Unreleased]

### Added

- The engine (`engine: er2`), executing ` ```{er2} ` cells in one ER2
  session per document through `er2_runner.py`, with no Jupyter kernel.
- Cell options `eval`, `echo`, `output`/`asis`, `error`, `warning`,
  `include`, `latex`, `classes`, `filename`, `label`, `fig-cap`, `fig-alt`,
  `fig-width`; document options under `er2:`.
- Notebook-style display of a cell's last expression, as maths when it has
  a LaTeX form; `show()` as display maths; a trailing `;` suppresses it.
- Inline `` `{er2} expr` ``, with `latex(f)` as inline maths.
- Matplotlib figures, with captions and cross-references.
- ER2's syntax definition, injected automatically.
- Freezing, with a relative syntax-definition path in `_freeze/`.
- `tests/run-tests.sh` and `make test`; `tests/clean-install.sh` and
  `make clean-install`.
- `install.sh` with `--check`, used by `make doctor`.
- Examples: `hello.qmd` and the series `01-syntax` to `05-plots`.
- The documentation site in `docs/`, rendered by the engine itself.
- GitHub Actions: `test.yml`, `clean-install.yml`, `release.yml`,
  `pages.yml`.

- HTML display: a value with `_repr_html_` (a pandas `DataFrame`, say) is
  shown as a table in HTML formats, and as LaTeX or text elsewhere.
- The engine looks for ER2's Python inside a Windows `er2.exe` launcher.
  Untested: ER2 itself cannot be installed on Windows yet, because
  `cypari2` has no Windows build; use WSL.
- The `er2` interpreter is also found behind pip's `#!/bin/sh` wrapper, which
  pip writes when the path has spaces or is too long for a shebang.

### Fixed

- A code span showing a cell fence in prose (`` ` ```{er2} ` ``) was read as
  an empty inline expression and stopped the render. An inline error now
  quotes the expression.
