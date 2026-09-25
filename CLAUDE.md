# CLAUDE.md

Working notes for Claude Code (and anyone else) in this repository.

## What this is

A Quarto **engine extension** that runs ER2 code cells (` ```{er2} `), plus
ER2's **Skylighting syntax definition**. It is the sibling of
[PARI-GP-ENGINE](https://github.com/oeistools/PARI-GP-ENGINE) and follows its
layout, Makefile, tests and style on purpose. `PLAN.md` holds the milestones
and the settled decisions — read it before proposing a different
architecture, in particular a Jupyter-backed one (ER2 rejected that design,
and this project agrees).

## Layout

```text
_extensions/er2/
  _extension.yml    extension manifest (contributes.engines)
  er2.js            COMPILED engine — committed, but never edit by hand
  er2_runner.py     the Python side: executes the cells; edit this directly
  er2.xml           ER2's syntax definition, copied from ER2's examples/
src/er2.ts          the engine source; edit this
tests/              run-tests.sh, cases/*.qmd, expect-fail/*.qmd,
                    freeze/ (a project of its own, see below)
examples/           hello.qmd and the numbered series 01..05
docs/               the documentation site (its own Quarto project;
                    docs/_extensions is a symlink to ../_extensions)
install.sh          prerequisite check (--check) and quarto add
.github/workflows/  test, clean-install, release, pages
_quarto.yml         makes the repo a Quarto project so examples/ and tests/
                    find _extensions without installing the extension
```

`er2.js` is a build product (`make build` from `src/er2.ts`) and is
committed, because it is what Quarto loads on `quarto add`.

## How execution works

The engine collects every ` ```{er2} ` cell and inline `` `{er2} …` ``
expression in document order into one JSON job, starts
`python -u er2_runner.py` once with the job on stdin, and reads one JSON
result: per item, a notebook-shaped list of outputs (`stream`, `display`
with a MIME bundle, `figure`, `error`). No sentinels, no Jupyter.

The runner keeps a private copy of fd 1 for the result and redirects both
Python-level and fd-level stdout/stderr per cell, so neither `print` nor C
code (PARI) can corrupt the JSON.

## After changing anything

```bash
make build && make test && make lint
```

`make build` type-checks against Quarto's own types. `make test` renders the
documents in `tests/` and greps the HTML. Add a case for any behaviour worth
keeping. To test against a particular ER2 (for instance the one with
Matplotlib, so the figure tests run instead of being skipped):

```bash
ER2_PYTHON=/path/to/ER2/.venv/bin/python make test
```

## Things that will bite you

**Quarto's engine API is not documented.** The types are the reference:
`/opt/quarto/share/extension-build/quarto-types.d.ts`.

**`freeze` applies only to whole-project renders.** Rendering one file always
executes it. That is why `tests/freeze/` is its own project, with an
`_extensions` symlink to the repository's, and the test renders the
directory. (PARI-GP-ENGINE's freeze test renders one file and passes only
because gp's `random()` is deterministic.)

**`options.cwd` is the document's directory; `options.target.input` is not
reliable** (absolute in a project render, relative otherwise). Figure and
syntax-definition paths are computed from `options.cwd`, and the latter is
made relative so a committed `_freeze/` replays on other machines.

**Test documents live under a Quarto project.** Rendering a `.qmd` from
outside the project root makes Quarto fall back to jupyter.

**SymPy's `_repr_latex_` is `$\displaystyle …$`.** The engine turns it into
`$$…$$`; ER2's own `Tex` already chooses `$` or `$$` and is used as is.

**The runner must only use stable ER2 names**: `er2.preparse`,
`er2.prelude.inject`, `er2.session.start`, `er2.printing.latex`, and
`er2.session._is_internal` guarded by a fallback. It is tested against both
ER2 0.4.2 and 0.7.0 on this machine.

**A code span can contain `{er2}` without being inline code**, as in
"` ```{er2} ` cells". The inline pattern requires a lone opening backtick
and a non-blank expression; `tests/cases/inline.qmd` pins both.

**No Node here**, so markdownlint cannot run locally, and CI does not run it
yet either.

**ER2 does not install on Windows**: `cypari2` has no Windows wheel and no
conda-forge win-64 build. Do not re-add a Windows CI job until it does; the
last one failed compiling `cypari2`, before the engine was reached.

## Releasing

As in PARI-GP-ENGINE: `make bump-version V=x.y.z`, write the `CHANGELOG.md`
section by hand, `make release-check`, `make tag`. **Only the maintainer
tags**: pushing a `v*` tag publishes a release.

## Style

Match the existing code: comments explain *why*, particularly where the
reason is a Quarto or ER2 quirk. Error messages tell the reader what to
change and where. The runner is PEP 8, line length 79, ruff-clean
(`make lint`). Everything in the repository is in English.
