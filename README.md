# ER2-ENGINE

[![Quarto](https://img.shields.io/badge/quarto-%E2%89%A5%201.9-2596be)](https://quarto.org)
[![ER2](https://img.shields.io/badge/ER2-mathematical%20Python-8a2be2)](https://github.com/oeistools/ER2)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Run [ER2](https://github.com/oeistools/ER2) code inside
[Quarto](https://quarto.org) documents as ` ```{er2} ` cells, and have it
highlighted as ER2.

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
| **Platforms** | Linux; macOS and Windows are implemented but not yet tested |
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

## Development

```bash
make build      # compile src/er2.ts -> _extensions/er2/er2.js
make test       # render the test documents and check the output
make examples   # render examples/
make check      # all of the above, plus lint
make doctor     # report whether quarto and er2 are usable
```

`ER2_PYTHON=/path/to/ER2/.venv/bin/python make test` runs the tests against a
particular ER2 checkout; the figure tests are skipped where Matplotlib is not
installed.

## License

MIT, see [LICENSE](LICENSE). `er2.xml` comes from
[ER2](https://github.com/oeistools/ER2) (`examples/er2.xml`), also MIT.
