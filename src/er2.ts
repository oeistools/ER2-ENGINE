/*
 * er2.ts — a Quarto execution engine for ER2.
 *
 * Executes ```{er2} cells with ER2 (https://github.com/oeistools/ER2), in
 * one session per document, so symbols and values defined in one cell are
 * visible in the next.
 *
 * Execution model
 * ---------------
 * Every cell and inline expression of the document, in order, goes into one
 * JSON job. The job is written to er2_runner.py, which runs under a Python
 * that can `import er2`, executes everything in a single ER2 namespace, and
 * answers with one JSON result: per cell, a notebook-shaped list of outputs
 * (streams, display bundles, figures, an error). There is no Jupyter kernel
 * in between, and — unlike PARI-GP-ENGINE, which has to split gp's text on
 * sentinel lines — nothing is parsed out of free text.
 */

import type {
  DependenciesOptions,
  EngineProjectContext,
  ExecuteOptions,
  ExecuteResult,
  ExecutionEngineDiscovery,
  ExecutionEngineInstance,
  ExecutionTarget,
  MappedString,
  Metadata,
  PostProcessOptions,
  QuartoAPI,
} from "@quarto/types";

let quarto: QuartoAPI;

const kEngineName = "er2";
const kCellLanguage = "er2";
/** Class put on emitted code blocks; matches <language name="ER2"> in er2.xml. */
const kHighlightLanguage = "er2";
const kSyntaxDefinition = "er2.xml";
const kRunner = "er2_runner.py";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface Er2Config {
  python?: string;
  timeout: number;
  prelude?: string;
  highlight: boolean;
  latex: boolean;
  figFormat?: string;
  figDpi: number;
  // cell-option defaults
  echo: boolean;
  output: boolean;
  error: boolean;
  warning: boolean;
  eval: boolean;
  include: boolean;
}

const kDefaultConfig: Er2Config = {
  timeout: 300,
  highlight: true,
  latex: true,
  figDpi: 96,
  echo: true,
  output: true,
  error: false,
  warning: true,
  eval: true,
  include: true,
};

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (/^(true|yes|on)$/i.test(v)) return true;
    if (/^(false|no|off)$/i.test(v)) return false;
  }
  return fallback;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) {
    return Number(v);
  }
  return undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string") return v.split(/\s+/).filter((s) => s.length > 0);
  return undefined;
}

function readConfig(metadata: Metadata | undefined): Er2Config {
  const cfg: Er2Config = { ...kDefaultConfig };
  const raw = metadata?.[kEngineName];
  if (!raw || typeof raw !== "object") return cfg;
  const m = raw as Record<string, unknown>;

  if (typeof m.python === "string") cfg.python = m.python;
  cfg.timeout = asNumber(m.timeout) ?? cfg.timeout;
  if (typeof m.prelude === "string") cfg.prelude = m.prelude;
  cfg.highlight = asBool(m.highlight, cfg.highlight);
  cfg.latex = asBool(m.latex, cfg.latex);
  if (typeof m["fig-format"] === "string") cfg.figFormat = m["fig-format"];
  cfg.figDpi = asNumber(m["fig-dpi"]) ?? cfg.figDpi;
  cfg.echo = asBool(m.echo, cfg.echo);
  cfg.output = asBool(m.output, cfg.output);
  cfg.error = asBool(m.error, cfg.error);
  cfg.warning = asBool(m.warning, cfg.warning);
  cfg.eval = asBool(m.eval, cfg.eval);
  cfg.include = asBool(m.include, cfg.include);
  return cfg;
}

/** Per-cell options, resolved against the document-level defaults. */
interface CellOptions {
  eval: boolean;
  echo: boolean;
  output: boolean | "asis";
  error: boolean;
  warning: boolean;
  include: boolean;
  latex: boolean;
  classes: string[];
  filename?: string;
  label?: string;
  figCap?: string;
  figAlt?: string;
  figWidth?: string;
}

function readCellOptions(
  raw: Record<string, unknown> | undefined,
  cfg: Er2Config,
): CellOptions {
  const o = raw ?? {};
  let output: boolean | "asis" = cfg.output;
  if (o.output === "asis" || o.results === "asis") output = "asis";
  else if (o.output !== undefined) output = asBool(o.output, cfg.output);

  return {
    eval: asBool(o.eval, cfg.eval),
    echo: asBool(o.echo, cfg.echo),
    output,
    error: asBool(o.error, cfg.error),
    warning: asBool(o.warning, cfg.warning),
    include: asBool(o.include, cfg.include),
    latex: asBool(o.latex, cfg.latex),
    classes: asStringArray(o.classes)?.map((c) => c.replace(/^\./, "")) ?? [],
    filename: typeof o.filename === "string" ? o.filename : undefined,
    label: typeof o.label === "string" ? o.label : undefined,
    figCap: typeof o["fig-cap"] === "string" ? o["fig-cap"] : undefined,
    figAlt: typeof o["fig-alt"] === "string" ? o["fig-alt"] : undefined,
    figWidth: o["fig-width"] !== undefined ? String(o["fig-width"]) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Finding a Python with ER2
// ---------------------------------------------------------------------------

/**
 * The interpreter that has ER2: `er2: python:` if the document names one,
 * then $ER2_PYTHON, then the interpreter of the `er2` command on PATH, then
 * `python3`.
 *
 * The `er2` command is the one thing every install route leaves behind —
 * `uv tool install`, `pipx` and `pip install` all write a script whose
 * shebang is the interpreter of the environment ER2 lives in. Reading it
 * finds that environment without the author having to know where it is.
 */
function resolvePython(cfg: Er2Config): string[] {
  if (cfg.python) return [cfg.python];
  const env = Deno.env.get("ER2_PYTHON");
  if (env) return [env];
  const fromShebang = er2Interpreter();
  if (fromShebang) return fromShebang;
  return [Deno.build.os === "windows" ? "python" : "python3"];
}

function er2Interpreter(): string[] | undefined {
  const sep = Deno.build.os === "windows" ? ";" : ":";
  for (const dir of (Deno.env.get("PATH") ?? "").split(sep)) {
    if (!dir) continue;
    const candidate = `${dir}/er2`;
    let head: string;
    try {
      const file = Deno.openSync(candidate, { read: true });
      const buf = new Uint8Array(512);
      const n = file.readSync(buf) ?? 0;
      file.close();
      head = new TextDecoder().decode(buf.subarray(0, n));
    } catch {
      continue;
    }
    const first = head.split(/\r?\n/, 1)[0];
    if (!first.startsWith("#!")) return undefined;
    const words = first.slice(2).trim().split(/\s+/);
    // `#!/usr/bin/env python3` names a program, not a path.
    if (/(^|\/)env$/.test(words[0])) return words.slice(1);
    return words;
  }
  return undefined;
}

const kMissingPython = (python: string) =>
  `ER2-ENGINE could not start Python ("${python}").\n\n` +
  `Install ER2 (https://github.com/oeistools/ER2) so that the "er2" command ` +
  `is on your PATH, or point the engine at a Python that can "import er2":\n\n` +
  `    ---\n    engine: er2\n    er2:\n      python: /path/to/python\n    ---\n`;

// ---------------------------------------------------------------------------
// Running ER2
// ---------------------------------------------------------------------------

interface FigureRequest {
  format: string;
  dir: string;
  stem: string;
}

interface JobItem {
  kind: "cell" | "inline";
  code: string;
  figures?: FigureRequest;
}

interface Output {
  type: "stream" | "display" | "figure" | "error";
  name?: string;
  text?: string;
  data?: Record<string, string>;
  ename?: string;
  evalue?: string;
  traceback?: string;
}

interface ItemResult {
  outputs: Output[];
  error: boolean;
}

async function runEr2(
  items: JobItem[],
  cfg: Er2Config,
  cwd: string,
): Promise<ItemResult[]> {
  if (items.length === 0 && !cfg.prelude) return [];

  const job = JSON.stringify({
    items,
    prelude: cfg.prelude,
    figure_dpi: cfg.figDpi,
  });
  const [python, ...pythonArgs] = resolvePython(cfg);
  const runner = extensionDir() + kRunner;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeout * 1000);

  let stdout: string;
  let stderr: string;
  let code: number;
  try {
    const child = new Deno.Command(python, {
      // -I would drop the user's site-packages, which is where a
      // `pip install --user er2` lives, so only -u (unbuffered) is set.
      args: [...pythonArgs, "-u", runner],
      cwd,
      env: { MPLBACKEND: "Agg", PYTHONIOENCODING: "utf-8" },
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
      signal: controller.signal,
    }).spawn();

    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(job));
    await writer.close().catch(() => {/* the runner may have died already */});

    const result = await child.output();
    stdout = new TextDecoder().decode(result.stdout);
    stderr = new TextDecoder().decode(result.stderr);
    code = result.code;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      throw new Error(kMissingPython(python));
    }
    if (controller.signal.aborted) {
      throw new Error(
        `ER2 did not finish within ${cfg.timeout}s. Raise the limit with ` +
          `"er2: { timeout: <seconds> }" in the document front matter.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  let parsed: { items?: ItemResult[]; fatal?: string };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(
      `The ER2 runner (${python}) exited with code ${code} without a ` +
        `result.\n\n${stderr.trim() || stdout.trim() || "(no output)"}`,
    );
  }
  if (parsed.fatal) throw new Error(parsed.fatal);
  return parsed.items ?? [];
}

// ---------------------------------------------------------------------------
// Markdown emission
// ---------------------------------------------------------------------------

function trimOutput(s: string): string {
  return s.replace(/^\s*\n/, "").replace(/\s+$/, "");
}

/** Fence long enough not to be closed by backticks inside the content. */
function fence(content: string): string {
  let longest = 0;
  for (const m of content.matchAll(/^`{3,}/gm)) longest = Math.max(longest, m[0].length);
  return "`".repeat(Math.max(3, longest + 1));
}

function codeBlock(content: string, attrs: string): string {
  const f = fence(content);
  return `${f}${attrs}\n${content}\n${f}\n`;
}

function outputDiv(kind: string, body: string): string {
  return `\n::: {.cell-output .${kind}}\n${body}:::\n`;
}

/**
 * The markdown for a display bundle, choosing as a notebook front end does:
 * markdown first (ER2's `Tex`, i.e. `latex(f)` and `show(f)`), then LaTeX
 * (every ER2 type and SymPy expression), then plain text.
 *
 * LaTeX goes in as maths, which pandoc carries into every output format —
 * MathJax in HTML, real maths in PDF, OMML in docx — so no format has to be
 * special-cased. `latex: false` shows the plain text instead.
 */
function displayMarkdown(data: Record<string, string>, opts: CellOptions): string {
  if (opts.latex) {
    const rich = data["text/markdown"] ?? displayMath(data["text/latex"]);
    if (rich !== undefined) return outputDiv("cell-output-display", `\n${rich}\n\n`);
  }
  return outputDiv("cell-output-display", codeBlock(data["text/plain"] ?? "", ""));
}

/**
 * SymPy's `_repr_latex_` is `$\displaystyle …$`: inline maths forced to look
 * like display maths, which is how a notebook gets a large formula into a
 * one-line output area. A document has display maths, so it gets that.
 */
function displayMath(latex: string | undefined): string | undefined {
  if (latex === undefined) return undefined;
  const m = latex.trim().match(/^\$\\displaystyle\s*([\s\S]*)\$$/);
  return m ? `$$${m[1].trim()}$$` : latex;
}

/**
 * Inline code: `` `{er2} expr` `` in prose. Quarto's own inline syntax, matched
 * only outside fenced blocks so that a documentation page may show the syntax
 * without it being evaluated.
 */
const kInlineEr2 = /`\{er2\}([^`]+)`/g;

/** Split markdown into fenced-code and prose runs; only prose is scanned. */
function proseRuns(md: string): { text: string; code: boolean }[] {
  const runs: { text: string; code: boolean }[] = [];
  const fence = /^(\s*)(`{3,}|~{3,}).*$/gm;
  let at = 0;
  let open: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(md)) !== null) {
    const marker = m[2];
    if (open === null) {
      runs.push({ text: md.slice(at, m.index), code: false });
      at = m.index;
      open = marker[0].repeat(marker.length);
    } else if (marker[0] === open[0] && marker.length >= open.length) {
      const end = m.index + m[0].length;
      runs.push({ text: md.slice(at, end), code: true });
      at = end;
      open = null;
    }
  }
  runs.push({ text: md.slice(at), code: open !== null });
  return runs;
}

function findInlineExpressions(md: string): string[] {
  const found: string[] = [];
  for (const run of proseRuns(md)) {
    if (run.code) continue;
    for (const m of run.text.matchAll(kInlineEr2)) found.push(m[1].trim());
  }
  return found;
}

function substituteInline(md: string, values: string[]): string {
  let i = 0;
  return proseRuns(md).map((run) => {
    if (run.code) return run.text;
    return run.text.replace(kInlineEr2, () => values[i++] ?? "");
  }).join("");
}

/**
 * The text an inline expression is replaced by: its markdown if it has one
 * (so `` `{er2} latex(f)` `` is inline maths, as in ER2's Jupyter route),
 * otherwise its plain text, on one line.
 */
function inlineValue(result: ItemResult | undefined, cfg: Er2Config): string {
  const out = result?.outputs[0];
  if (!out) return "";
  if (out.type === "error") return `**${out.ename}: ${out.evalue}**`;
  const data = out.data ?? {};
  const text = (cfg.latex ? data["text/markdown"] : undefined) ??
    data["text/plain"] ?? "";
  return text.trim().replace(/\s*\n\s*/g, " ");
}

function attrEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * A figure, written by the runner into the document's `_files` directory
 * (which Quarto already copies next to the output and cleans up) and
 * referenced as an image. A `fig-` label makes it cross-referenceable; only
 * the first figure of a cell can carry the label, as in Quarto's Jupyter
 * engine.
 */
function emitFigure(path: string, opts: CellOptions, first: boolean): string {
  const attrs: string[] = [];
  if (opts.label && first) attrs.push(`#${opts.label}`);
  if (opts.figWidth) attrs.push(`width="${attrEscape(opts.figWidth)}"`);
  if (opts.figAlt) attrs.push(`fig-alt="${attrEscape(opts.figAlt)}"`);
  const attr = attrs.length ? `{${attrs.join(" ")}}` : "";
  const cap = first ? opts.figCap ?? "" : "";
  return outputDiv("cell-output-display", `\n![${cap}](${path})${attr}\n\n`);
}

function emitCell(
  code: string,
  result: ItemResult | undefined,
  opts: CellOptions,
  figureDir: string,
): string {
  if (!opts.include) return "";

  const parts: string[] = [];
  if (opts.echo) {
    const classes = [kHighlightLanguage, "cell-code", ...opts.classes]
      .map((c) => `.${c}`).join(" ");
    const attr = opts.filename ? `${classes} filename="${opts.filename}"` : classes;
    parts.push(codeBlock(code.replace(/\s+$/, ""), ` {${attr}}`));
  }

  if (result && opts.output !== false) {
    let figures = 0;
    for (const out of result.outputs) {
      if (out.type === "stream") {
        const text = trimOutput(out.text ?? "");
        if (!text) continue;
        if (out.name === "stderr") {
          if (opts.warning) parts.push(outputDiv("cell-output-stderr", codeBlock(text, "")));
        } else if (opts.output === "asis") {
          parts.push("\n" + text + "\n");
        } else {
          parts.push(outputDiv("cell-output-stdout", codeBlock(text, "")));
        }
      } else if (out.type === "display") {
        if (opts.output === "asis") {
          const d = out.data ?? {};
          parts.push("\n" + (d["text/markdown"] ?? d["text/plain"] ?? "") + "\n");
        } else {
          parts.push(displayMarkdown(out.data ?? {}, opts));
        }
      } else if (out.type === "figure") {
        parts.push(emitFigure(`${figureDir}/${out.name}`, opts, figures === 0));
        figures += 1;
      } else if (out.type === "error") {
        parts.push(outputDiv("cell-output-error", codeBlock(trimOutput(out.traceback ?? ""), "")));
      }
    }
  }

  if (parts.length === 0) return "";
  const cellAttrs = [".cell"];
  if (opts.label && !opts.label.startsWith("fig-")) cellAttrs.unshift(`#${opts.label}`);
  return `\n::: {${cellAttrs.join(" ")}}\n${parts.join("")}:::\n\n`;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Where figures for `input` are written: the `<stem>_files` directory Quarto
 * already knows how to copy next to the output and clean up afterwards.
 */
function figureDir(input: string, cwd: string): {
  absolute: string;
  relative: string;
  supporting: string;
} {
  const norm = input.replace(/\\/g, "/");
  const base = norm.slice(norm.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  const cwdNorm = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  return {
    absolute: `${cwdNorm}/${base}_files/figure-er2`,
    relative: `${base}_files/figure-er2`,
    supporting: `${cwdNorm}/${base}_files`,
  };
}

/**
 * The figure format the output format wants: vector for HTML (sharp at any
 * zoom) and PDF (so LaTeX can include it), bitmap for everything else, which
 * may not read SVG (docx, for one, before Word 2016).
 */
function figureFormat(cfg: Er2Config, to: string): string {
  if (cfg.figFormat) return cfg.figFormat;
  if (/html|revealjs|epub|dashboard/i.test(to)) return "svg";
  if (/latex|pdf|beamer/i.test(to)) return "pdf";
  return "png";
}

/** Directory holding this engine's files, so we can find er2.xml and the runner. */
function extensionDir(): string {
  const url = new URL(".", import.meta.url);
  let path = decodeURIComponent(url.pathname);
  // file:///C:/... has a pathname of /C:/...
  if (Deno.build.os === "windows" && /^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  return path;
}

/**
 * The path to hand pandoc for the syntax definition, relative to the document.
 *
 * It has to be relative because a frozen execution result is stored in
 * `_freeze/`, which is committed and replayed on other machines and in CI. An
 * absolute path baked in there would not exist on the next machine, and the
 * document would lose its highlighting or fail to render.
 *
 * The base is `options.cwd`, which is the document's own directory — and is
 * also what pandoc runs in. `options.target.input` is *not* usable here: it is
 * absolute when the file is part of a project render but relative when it is
 * rendered on its own. (Both lessons are PARI-GP-ENGINE's.)
 */
function syntaxDefinitionPath(documentDir: string): string {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const target = norm(extensionDir() + kSyntaxDefinition).split("/");
  const from = norm(documentDir).split("/");

  if (from[0] !== target[0]) return target.join("/"); // different roots
  let i = 0;
  while (i < from.length && i < target.length && from[i] === target[i]) i += 1;
  const rel = [...new Array(from.length - i).fill(".."), ...target.slice(i)];
  return rel.length > 0 ? rel.join("/") : target.join("/");
}

const er2Engine: ExecutionEngineDiscovery = {
  init: (quartoAPI: QuartoAPI) => {
    quarto = quartoAPI;
  },

  name: kEngineName,
  defaultExt: ".qmd",
  defaultYaml: () => ["engine: er2"],
  defaultContent: () => [
    "```{er2}",
    "sym x",
    "factor(x^2 - 1), phi(2^61 - 1), 1/3",
    "```",
  ],
  validExtensions: () => [],

  claimsFile: (_file: string, _ext: string) => false,

  claimsLanguage: (language: string, _firstClass?: string): boolean | number =>
    language.toLowerCase() === kCellLanguage,

  canFreeze: true,
  generatesFigures: true,

  launch: (_context: EngineProjectContext): ExecutionEngineInstance => {
    return {
      name: kEngineName,
      canFreeze: true,

      markdownForFile: (file: string): Promise<MappedString> =>
        Promise.resolve(quarto.mappedString.fromFile(file)),

      target: (file: string, _quiet?: boolean, markdown?: MappedString) => {
        const md = markdown ?? quarto.mappedString.fromFile(file);
        const target: ExecutionTarget = {
          source: file,
          input: file,
          markdown: md,
          metadata: quarto.markdownRegex.extractYaml(md.value),
        };
        return Promise.resolve(target);
      },

      partitionedMarkdown: (file: string) =>
        Promise.resolve(
          quarto.markdownRegex.partition(Deno.readTextFileSync(file)),
        ),

      execute: async (options: ExecuteOptions): Promise<ExecuteResult> => {
        const cfg = readConfig(options.format?.metadata ?? options.target.metadata);
        const chunks = await quarto.markdownRegex.breakQuartoMd(
          options.target.markdown,
        );
        const to = options.format?.pandoc?.to ?? "html";
        const figures = figureDir(options.target.input, options.cwd);
        const format = figureFormat(cfg, to);

        // Pass 1: collect every cell and inline expression we are going to
        // run, in document order, so that `` `{er2} p` `` in prose sees
        // exactly the state the cells above it left behind.
        const cells = chunks.cells.map((cell) => {
          const isEr2 = typeof cell.cell_type === "object" &&
            cell.cell_type.language === kCellLanguage;
          if (!isEr2) return { er2: false as const, cell };
          const opts = readCellOptions(
            cell.options as Record<string, unknown> | undefined,
            cfg,
          );
          return { er2: true as const, cell, opts };
        });

        const inlineCounts = new Map<number, number>();
        const job: JobItem[] = [];
        let cellNumber = 0;
        cells.forEach((c, i) => {
          if (c.er2) {
            cellNumber += 1;
            if (c.opts.eval) {
              job.push({
                kind: "cell",
                code: c.cell.source.value,
                figures: {
                  format,
                  dir: figures.absolute,
                  stem: c.opts.label ?? `cell-${cellNumber}`,
                },
              });
            }
            return;
          }
          if (c.cell.cell_type === "raw") return; // the YAML front matter
          const exprs = findInlineExpressions(c.cell.sourceVerbatim.value);
          if (exprs.length === 0) return;
          inlineCounts.set(i, exprs.length);
          for (const e of exprs) job.push({ kind: "inline", code: e });
        });

        const results = await runEr2(job, cfg, options.cwd);

        // Pass 2: rebuild the document.
        const out: string[] = [];
        let at = 0;
        for (const [i, c] of cells.entries()) {
          if (!c.er2) {
            const n = inlineCounts.get(i) ?? 0;
            if (n === 0) {
              out.push(c.cell.sourceVerbatim.value);
              continue;
            }
            const slice = results.slice(at, at + n);
            at += n;
            const failed = slice.find((r) => r.error);
            if (failed && !cfg.error) {
              const e = failed.outputs[0];
              throw new Error(
                `ER2 error in an inline {er2} expression:\n\n` +
                  `${trimOutput(e?.traceback ?? "")}\n\n` +
                  `Set "error: true" under "er2:" in the front matter to ` +
                  `show the error in the rendered document instead of stopping.`,
              );
            }
            out.push(substituteInline(
              c.cell.sourceVerbatim.value,
              slice.map((r) => inlineValue(r, cfg)),
            ));
            continue;
          }
          const code = c.cell.source.value;
          const result = c.opts.eval ? results[at++] : undefined;

          if (result?.error && !c.opts.error) {
            const e = result.outputs.find((o) => o.type === "error");
            throw new Error(
              `ER2 error in an {er2} cell${
                c.cell.cellStartLine ? ` at line ${c.cell.cellStartLine}` : ""
              }:\n\n${trimOutput(e?.traceback ?? "")}\n\n` +
                `Set "#| error: true" on the cell (or "error: true" under ` +
                `"er2:" in the front matter) to show the error in the ` +
                `rendered document instead of stopping.`,
            );
          }
          out.push(emitCell(code, result, c.opts, figures.relative));
        }

        const supporting: string[] = [];
        try {
          if (Deno.statSync(figures.absolute).isDirectory) {
            supporting.push(figures.supporting);
          }
        } catch {
          // no figures were written
        }

        const result: ExecuteResult = {
          engine: kEngineName,
          markdown: out.join(""),
          supporting,
          filters: [],
        };

        // Hand pandoc the syntax definition so ```{er2} cells are highlighted
        // without the author having to wire up `syntax-definitions` by hand.
        if (cfg.highlight) {
          const xml = syntaxDefinitionPath(options.cwd);
          const existing = options.format?.pandoc?.["syntax-definitions"];
          const defs = Array.isArray(existing) ? [...existing as string[]] : [];
          if (!defs.some((d) => String(d).endsWith(kSyntaxDefinition))) {
            defs.push(xml);
          }
          result.pandoc = { "syntax-definitions": defs };
        }

        return result;
      },

      dependencies: (_options: DependenciesOptions) =>
        Promise.resolve({ includes: {} }),

      postprocess: (_options: PostProcessOptions) => Promise.resolve(),
    };
  },
};

export default er2Engine;
