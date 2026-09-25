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
- `tests/run-tests.sh` and `make test`.
