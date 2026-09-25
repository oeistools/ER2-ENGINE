# ER2-ENGINE

[![CI](https://github.com/oeistools/ER2-ENGINE/actions/workflows/test.yml/badge.svg)](https://github.com/oeistools/ER2-ENGINE/actions/workflows/test.yml)
[![Pages](https://github.com/oeistools/ER2-ENGINE/actions/workflows/pages.yml/badge.svg)](https://oeistools.github.io/ER2-ENGINE/)
[![Quarto](https://img.shields.io/badge/quarto-%E2%89%A5%201.9-2596be)](https://quarto.org)
[![ER2](https://img.shields.io/badge/ER2-mathematical%20Python-8a2be2)](https://github.com/oeistools/ER2)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Run [ER2](https://github.com/oeistools/ER2) code inside
[Quarto](https://quarto.org) documents as ` ```{er2} ` cells, and have it
highlighted as ER2.

**[Documentation →](https://oeistools.github.io/ER2-ENGINE/)**

This repository is the sibling of
[PARI-GP-ENGINE](https://github.com/oeistools/PARI-GP-ENGINE): the same kind
of extension, the same layout, for a different language. It provides:

| Part | What it is |
| --- | --- |
| **Engine** | A Quarto [engine extension](https://quarto.org/docs/extensions/engine.html) that executes ` ```{er2} ` cells with ER2, one session per document, and puts the results — text, LaTeX, figures — in the rendered document. |
| **Highlighting** | ER2's own KDE/Skylighting syntax definition (`er2.xml`: `sym`, `5r`, `^^` on top of Python), applied automatically. |

````markdown
---
engine: er2
---

```{er2}
sym x
factor(x^2 - 1), phi(2^61 - 1), 1/3
```
````

| | |
| --- | --- |
| **Quarto** | 1.9 or newer |
| **ER2** | installed, with the `er2` command on `PATH` (or named explicitly) |
| **Platforms** | Linux, macOS and Windows, all three in CI |
| **Install** | `quarto add oeistools/ER2-ENGINE` |
| **Licence** | MIT |

**Status: 0.1.0, in development.** See [PLAN.md](PLAN.md) for the
milestones and the decisions behind the design.

## Why an engine, when ER2 already runs in Quarto

ER2 runs in Quarto through its Jupyter kernel: `jupyter: er2` and
` ```{python} ` cells. That route is ER2's own and stays the right one when a
document needs editor Python tooling or has to mix languages. What it cannot
do is execute a block written ` ```{er2} ` — Quarto picks the engine from the
block's language before any kernel is asked.

This engine does not use Jupyter at all. Like PARI-GP-ENGINE with `gp`, it
runs ER2's interpreter as an external program, once per document: a small
runner script, shipped inside the extension, under the Python ER2 is
installed in. So there is no kernel to install and no daemon to restart.
[PLAN.md](PLAN.md) has the comparison.

## Requirements

- **Quarto ≥ 1.9** — engine extensions do not exist in earlier versions.
- **ER2**, for instance `uv tool install git+https://github.com/oeistools/ER2`.
  The engine uses the Python behind the `er2` command, so whatever
  environment ER2 is installed in is the one documents run in.
- **Matplotlib**, only for figures, in that same environment.

## Installing

```bash
quarto add oeistools/ER2-ENGINE
```

Or clone the repository and run the installer, which checks the
prerequisites first and tells you exactly what is missing:

```bash
./install.sh            # check, then install into the current project
./install.sh --check    # report only, install nothing
./install.ps1 -Check    # the same on Windows
```

## Using it

Set `engine: er2` in the front matter, then write ` ```{er2} ` cells. Every
cell runs in **one** ER2 session, in order, so anything a cell defines is
still there in the next one. As in a notebook, a cell whose last line is an
expression shows its value — as maths when it has a LaTeX form — unless the
line ends with `;`.

### Cell options

Written as `#|` comments at the top of a cell.

| Option | Default | Effect |
| --- | --- | --- |
| `eval` | `true` | Run the cell. `false` shows the code without running it. |
| `echo` | `true` | Show the source. |
| `output` | `true` | Show the output. `asis` inserts printed text as raw markdown. |
| `error` | `false` | `true` renders exceptions into the document; `false` stops the render. |
| `warning` | `true` | `false` hides what the cell wrote to stderr. |
| `include` | `true` | `false` drops the cell from the output entirely (it still runs). |
| `latex` | `true` | `false` shows values as plain text instead of maths. |
| `classes` | — | Extra CSS classes for the code block. |
| `filename` | — | Filename label above the code block. |
| `label` | — | Cell label; a `fig-…` label makes the first figure cross-referenceable. |
| `fig-cap` | — | Figure caption. |
| `fig-alt` | — | Alternative text of a figure. |
| `fig-width` | — | Width of a figure. |

### Document options

Everything under `er2:` in the front matter, all optional:

```yaml
---
engine: er2
er2:
  python: /path/to/python   # a Python that can `import er2`
  timeout: 300              # seconds before the render gives up
  highlight: true           # inject the syntax definition automatically
  latex: true               # show values as maths
  fig-format: svg           # default: svg for HTML, pdf for LaTeX, png otherwise
  fig-dpi: 96
  prelude: |                # ER2 code run once, before the first cell
    sym x, y
  echo: true                # defaults for every cell in the document
  output: true
  error: false
  warning: true
---
```

Without `python:`, the engine uses `$ER2_PYTHON`, then the interpreter of the
`er2` command on `PATH`, then `python3`.

### Inline code

`` `{er2} expr` `` in prose is evaluated where it appears, so it sees whatever
the cells above it left behind. `` `{er2} latex(f)` `` is inline maths.

### Figures

Every Matplotlib figure left open at the end of a cell is saved and shown,
then closed: SVG for HTML, PDF for LaTeX, PNG otherwise.

### Caching

`freeze: auto` or `freeze: true` work as with any engine. Note that Quarto
honours `freeze` only in a render of a whole project; a single file rendered
on its own is always executed.

## Examples

`examples/` holds a numbered series, each document short and about one thing.
`make examples` renders all of them. They use ER2 0.7 features (matrices,
finite fields, series); the engine itself also works with older ER2.

| | |
| --- | --- |
| [`hello.qmd`](examples/hello.qmd) | The smallest thing that works. |
| [`01-syntax.qmd`](examples/01-syntax.qmd) | The five differences from Python, and nothing else. |
| [`02-number-theory.qmd`](examples/02-number-theory.qmd) | Factorisation, arithmetic functions and primes, on PARI. |
| [`03-algebra.qmd`](examples/03-algebra.qmd) | Matrices, finite fields, resultants, Gröbner bases, number fields. |
| [`04-series.qmd`](examples/04-series.qmd) | Power series, generating functions, Dirichlet series, Euler products. |
| [`05-plots.qmd`](examples/05-plots.qmd) | Matplotlib figures with captions and cross-references. |

## Development

```bash
make build      # compile src/er2.ts -> _extensions/er2/er2.js
make test       # render the test documents and check the output
make examples   # render examples/
make check      # all of the above, plus lint
make doctor     # report whether quarto and er2 are usable
make lint       # ruff on the runner
make docs       # render the documentation site into docs/_site
make clean-install  # install the published release into an empty directory
```

`ER2_PYTHON=/path/to/ER2/.venv/bin/python make test` runs the tests against a
particular ER2 checkout; the figure tests are skipped where Matplotlib is not
installed.

`make clean-install` is the one check that does not use the repository: it
runs `quarto add` in an empty directory outside it and renders a document
with execution, inline code, highlighting and a figure. `REF=--local`
installs the working tree instead.

### Continuous integration

- [`test.yml`](.github/workflows/test.yml), on every push and pull request,
  on Linux and macOS: installs ER2 from its repository and Quarto, rebuilds
  the engine and **fails if the committed `er2.js` is stale**, then runs the
  tests, the examples, the docs site and a clean install of the working tree.
  A Windows job runs `install.ps1 -Check`, the tests and the clean install,
  in Git Bash, with ER2 found by the engine itself.
- [`clean-install.yml`](.github/workflows/clean-install.yml), weekly: installs
  the *published* release with `quarto add` and renders with it.
- [`release.yml`](.github/workflows/release.yml), on a `v*` tag: checks the
  tag agrees with `VERSION`, `_extension.yml` and `CITATION.cff`, runs
  everything, publishes the release with that version's changelog section,
  and installs what it just published on Linux and macOS.
- [`pages.yml`](.github/workflows/pages.yml): renders `docs/` and deploys it
  to GitHub Pages.

## Limitations

- Quarto allows **one engine per document**, so a document using `er2`
  cannot also run `{python}` cells. ER2's Jupyter route does not have this
  limit.
- Only Matplotlib figures are captured.
- HTML output (`_repr_html_`, such as a pandas table) is used only in HTML
  formats; elsewhere the value falls back to LaTeX or plain text.

## License

MIT, see [LICENSE](LICENSE). `er2.xml` comes from
[ER2](https://github.com/oeistools/ER2) (`examples/er2.xml`), also MIT.
