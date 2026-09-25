"""Execute the ER2 cells of one Quarto document (the ER2-ENGINE runner).

The engine (``er2.js``) starts this script once per document with a
Python that can ``import er2``, writes a JSON job to its stdin, and
reads one JSON result from its stdout.  Every cell runs in the same
namespace, in document order, so state carries from cell to cell.

Job::

    {"items": [{"kind": "cell" | "inline", "code": "...",
                "figures": {"format": "svg", "dir": "...", "stem": "..."}}],
     "prelude": "...", "figure_dpi": 96}

Result::

    {"er2": "0.7.0", "items": [{"outputs": [...], "error": false}]}

where each output is ``{"type": "stream", "name": "stdout", "text": ...}``,
``{"type": "display", "data": {mime: text}}``, ``{"type": "figure",
"path": ...}`` or ``{"type": "error", "ename", "evalue", "traceback"}``
-- the shape of a notebook's outputs, because that is what an ER2 user
expects a cell to produce.

Only stdlib and ``er2`` are used.  The job's JSON is the whole protocol:
there are no sentinels to parse, and user ``print`` cannot reach the
real stdout, which is saved before any cell runs and written to once.
"""

import ast
import io
import json
import linecache
import os
import sys
import tempfile
import tokenize
import traceback

# Matplotlib must never pick a GUI backend while rendering: with no
# display it would fall back to Agg *silently* and every figure would be
# lost (ER2 ARCHITECTURE.md §1.3).  Agg is set before anything imports it.
os.environ.setdefault("MPLBACKEND", "Agg")

MISSING_ER2 = (
    "ER2-ENGINE: this Python ({python}) cannot import er2.\n\n"
    "Install ER2 (https://github.com/oeistools/ER2), or point the engine "
    "at a Python that has it:\n\n"
    "    ---\n    engine: er2\n    er2:\n      python: /path/to/python\n"
    "    ---\n"
)

FIGURE_FORMATS = ("svg", "png", "pdf")


def main():
    """Read the job from stdin, run it, write the result to stdout."""
    # The only writes to the real stdout are the JSON result; cells get
    # their own streams.  Keep a private copy of the descriptor so that
    # C code writing to fd 1 (PARI, NumPy) cannot corrupt the result.
    result_fd = os.dup(1)
    job = json.load(sys.stdin)
    try:
        import er2
        from er2 import prelude, session
    except ImportError as exc:
        _write(
            result_fd,
            {
                "fatal": MISSING_ER2.format(python=sys.executable)
                + f"\n({exc})"
            },
        )
        return 1
    session.start()

    namespace = {"__name__": "__main__", "__builtins__": __builtins__}
    sys.path.insert(0, os.getcwd())
    runner = Runner(namespace, prelude, job)
    namespace["show"] = runner.show

    if job.get("prelude"):
        record = runner.run_cell(job["prelude"], "<prelude>", None)
        if record["error"]:
            error = next(o for o in record["outputs"] if o["type"] == "error")
            _write(
                result_fd,
                {
                    "fatal": "ER2 error in the er2: prelude:\n\n"
                    + error["traceback"]
                },
            )
            return 1

    items = []
    for index, item in enumerate(job["items"]):
        if item["kind"] == "inline":
            items.append(runner.run_inline(item["code"]))
        else:
            name = f"<cell {index + 1}>"
            items.append(
                runner.run_cell(item["code"], name, item.get("figures"))
            )
    _write(result_fd, {"er2": er2.__version__, "items": items})
    return 0


def _write(fd, payload):
    with os.fdopen(fd, "w", encoding="utf-8") as out:
        json.dump(payload, out)


class Runner:
    """Run cells in one ER2 namespace and record what they produce."""

    def __init__(self, namespace, prelude, job):
        """Keep the namespace, the prelude module and the job settings."""
        self.namespace = namespace
        self.prelude = prelude
        self.dpi = job.get("figure_dpi", 96)
        self.outputs = None  # the current cell's output list

    # -- output recording -------------------------------------------------

    def stream(self, name, text):
        """Append ``text`` to the current cell's ``name`` stream."""
        if not text or self.outputs is None:
            return
        last = self.outputs[-1] if self.outputs else None
        if last and last["type"] == "stream" and last["name"] == name:
            last["text"] += text
        else:
            self.outputs.append({"type": "stream", "name": name, "text": text})

    def display(self, value):
        """Append ``value`` to the current cell as a display bundle."""
        self.outputs.append({"type": "display", "data": bundle(value)})

    def show(self, *objs):
        """ER2's ``show``: display math, as it does in a notebook."""
        from er2.printing import latex

        for obj in objs:
            self.display(latex(obj, display=True))

    # -- execution --------------------------------------------------------

    def run_cell(self, source, filename, figures):
        """Run one cell; return its record."""
        self.outputs = []
        failed = False
        with Capture(self):
            try:
                body, last = self.compile_cell(source, filename)
                self.prelude.inject(self.namespace, body)
                exec(body, self.namespace)
                if last is not None:
                    self.prelude.inject(self.namespace, last)
                    value = eval(last, self.namespace)
                    if value is not None and not is_plot_artist(value):
                        self.namespace["_"] = value
                        self.display(value)
            except KeyboardInterrupt:
                raise
            except BaseException as exc:  # noqa: BLE001 - report it
                failed = True
                self.outputs.append(error_output(exc))
        if figures:
            self.save_figures(figures)
        record = {"outputs": self.outputs, "error": failed}
        self.outputs = None
        return record

    def run_inline(self, expression):
        """Evaluate an inline expression; return its text or its error."""
        self.outputs = []
        try:
            with Capture(self):
                code = compile(
                    preparse(expression.strip(), "<inline>"),
                    "<inline>",
                    "eval",
                )
                self.prelude.inject(self.namespace, code)
                value = eval(code, self.namespace)
        except KeyboardInterrupt:
            raise
        except BaseException as exc:  # noqa: BLE001 - report it
            return {"outputs": [error_output(exc)], "error": True}
        finally:
            self.outputs = None
        return {
            "outputs": [{"type": "display", "data": bundle(value)}],
            "error": False,
        }

    def compile_cell(self, source, filename):
        """Compile ``source``; split off a final expression to display.

        As in a notebook, a cell whose last statement is an expression
        shows its value, unless the line ends with ``;``.
        """
        # Tracebacks show the ER2 source: the preparser keeps line
        # numbers, so the lines of ``source`` are the right ones.
        linecache.cache[filename] = (
            len(source),
            None,
            source.splitlines(keepends=True),
            filename,
        )
        tree = ast.parse(preparse(source, filename), filename)
        last = None
        if (
            tree.body
            and isinstance(tree.body[-1], ast.Expr)
            and not ends_with_semicolon(source)
        ):
            expr = ast.Expression(tree.body.pop().value)
            last = compile(expr, filename, "eval")
        return compile(tree, filename, "exec"), last

    def save_figures(self, figures):
        """Save and close every open Matplotlib figure."""
        pyplot = sys.modules.get("matplotlib.pyplot")
        if pyplot is None:
            return
        fmt = figures.get("format", "svg")
        if fmt not in FIGURE_FORMATS:
            fmt = "svg"
        os.makedirs(figures["dir"], exist_ok=True)
        for number in pyplot.get_fignums():
            figure = pyplot.figure(number)
            name = f"{figures['stem']}-{number}.{fmt}"
            figure.savefig(
                os.path.join(figures["dir"], name),
                format=fmt,
                dpi=self.dpi,
                bbox_inches="tight",
            )
            self.outputs.append({"type": "figure", "name": name})
        pyplot.close("all")


def preparse(source, filename):
    """Translate ER2 to Python (``er2.preparse``, imported lazily)."""
    from er2 import preparse as er2_preparse

    return er2_preparse(source, filename)


def ends_with_semicolon(source):
    """Whether the last token of ``source`` (comments aside) is ``;``."""
    ignored = {
        tokenize.COMMENT,
        tokenize.NL,
        tokenize.NEWLINE,
        tokenize.INDENT,
        tokenize.DEDENT,
        tokenize.ENDMARKER,
    }
    last = None
    try:
        for token in tokenize.generate_tokens(io.StringIO(source).readline):
            if token.type not in ignored:
                last = token
    except (tokenize.TokenError, SyntaxError):
        return False
    return last is not None and last.string == ";"


def is_plot_artist(value):
    """Whether ``value`` is what a Matplotlib call returns, not a result.

    ``plt.plot(...)`` as the last line of a cell returns a list of
    ``Line2D``; a notebook shows its repr above the figure, which is
    noise in a document.  The figure itself is what the author asked for.
    """
    if isinstance(value, (list, tuple)) and value:
        return all(is_plot_artist(item) for item in value)
    return type(value).__module__.startswith(("matplotlib.", "mpl_toolkits."))


def bundle(value):
    """Return the MIME bundle of ``value``, as a notebook would show it."""
    data = {"text/plain": text_of(value)}
    for mime, method in (
        ("text/latex", "_repr_latex_"),
        ("text/markdown", "_repr_markdown_"),
    ):
        rich = getattr(value, method, None)
        if callable(rich):
            try:
                text = rich()
            except Exception:  # noqa: BLE001 - a broken repr is not fatal
                text = None
            if isinstance(text, str):
                data[mime] = text
    return data


def text_of(value):
    """Plain text of a value: ``str`` for strings, ``repr`` otherwise."""
    return value if isinstance(value, str) else repr(value)


def error_output(exc):
    """Format ``exc`` as ER2 does: without the runner's or ER2's frames."""
    if isinstance(exc, SyntaxError):
        # As Python reports a syntax error in a script: no stack, just
        # the offending ER2 line.  The preparser raises from its own
        # frames, which are no business of the reader.
        if exc.text is None and exc.filename and exc.lineno:
            exc.text = linecache.getline(exc.filename, exc.lineno) or None
        text = "".join(traceback.format_exception_only(exc))
        return {
            "type": "error",
            "ename": type(exc).__name__,
            "evalue": str(exc.msg),
            "traceback": text,
        }
    report = traceback.TracebackException.from_exception(exc)
    for part in _chain(report):
        frames = [f for f in part.stack if f.filename != __file__]
        while len(frames) > 1 and _is_internal(frames[-1].filename):
            frames.pop()
        for frame in frames:
            # Columns refer to the preparsed line, not the ER2 one shown.
            if frame.filename.startswith("<"):
                frame.colno = frame.end_colno = None
        part.stack = traceback.StackSummary.from_list(frames)
    return {
        "type": "error",
        "ename": type(exc).__name__,
        "evalue": str(exc),
        "traceback": "".join(report.format()),
    }


def _chain(report):
    seen = set()
    while report is not None and id(report) not in seen:
        seen.add(id(report))
        yield report
        report = report.__cause__ or report.__context__


def _is_internal(filename):
    try:
        from er2.session import _is_internal as er2_internal
    except ImportError:  # an ER2 without it: hide nothing
        return False
    try:
        return er2_internal(filename)
    except (OSError, ValueError):
        return False


class Capture:
    """Route a cell's output into its record, at both levels.

    Python-level writes go through ``sys.stdout``/``sys.stderr`` objects
    that record in order, so ``print`` and ``show`` interleave correctly.
    Descriptors 1 and 2 are pointed at temporary files as well, because
    C code (PARI's warnings, for one) writes to them directly.
    """

    def __init__(self, runner):
        """Remember the runner that owns the current cell."""
        self.runner = runner

    def __enter__(self):
        """Start capturing."""
        sys.stdout.flush()
        sys.stderr.flush()
        self.saved = (sys.stdout, sys.stderr)
        # Closed in __exit__, which is what a context manager would do.
        self.files = [tempfile.TemporaryFile() for _ in range(2)]  # noqa: SIM115
        self.fds = [os.dup(1), os.dup(2)]
        for target, file in zip((1, 2), self.files, strict=True):
            os.dup2(file.fileno(), target)
        sys.stdout = Stream(self.runner, "stdout")
        sys.stderr = Stream(self.runner, "stderr")
        return self

    def __exit__(self, *exc_info):
        """Stop capturing and record what C code wrote."""
        sys.stdout, sys.stderr = self.saved
        for target, fd in zip((1, 2), self.fds, strict=True):
            os.dup2(fd, target)
            os.close(fd)
        for name, file in zip(("stdout", "stderr"), self.files, strict=True):
            file.seek(0)
            text = file.read().decode("utf-8", "replace")
            file.close()
            self.runner.stream(name, text)
        return False


class Stream(io.TextIOBase):
    """A text stream that records into the current cell."""

    def __init__(self, runner, name):
        """Write to ``runner``'s current cell as stream ``name``."""
        self.runner = runner
        self.name = name

    def writable(self):
        """Report that the stream is writable."""
        return True

    def write(self, text):
        """Record ``text``; return its length."""
        self.runner.stream(self.name, text)
        return len(text)

    @property
    def encoding(self):
        """Report UTF-8, as a notebook's streams do."""
        return "utf-8"


if __name__ == "__main__":
    sys.exit(main())
