// src/er2.ts
var quarto;
var kEngineName = "er2";
var kCellLanguage = "er2";
var kHighlightLanguage = "er2";
var kSyntaxDefinition = "er2.xml";
var kRunner = "er2_runner.py";
var kDefaultConfig = {
  timeout: 300,
  highlight: true,
  latex: true,
  figDpi: 96,
  echo: true,
  output: true,
  error: false,
  warning: true,
  eval: true,
  include: true
};
function asBool(v, fallback) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (/^(true|yes|on)$/i.test(v)) return true;
    if (/^(false|no|off)$/i.test(v)) return false;
  }
  return fallback;
}
function asNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) {
    return Number(v);
  }
  return void 0;
}
function asStringArray(v) {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string") return v.split(/\s+/).filter((s) => s.length > 0);
  return void 0;
}
function readConfig(metadata) {
  const cfg = {
    ...kDefaultConfig
  };
  const raw = metadata?.[kEngineName];
  if (!raw || typeof raw !== "object") return cfg;
  const m = raw;
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
function readCellOptions(raw, cfg) {
  const o = raw ?? {};
  let output = cfg.output;
  if (o.output === "asis" || o.results === "asis") output = "asis";
  else if (o.output !== void 0) output = asBool(o.output, cfg.output);
  return {
    eval: asBool(o.eval, cfg.eval),
    echo: asBool(o.echo, cfg.echo),
    output,
    error: asBool(o.error, cfg.error),
    warning: asBool(o.warning, cfg.warning),
    include: asBool(o.include, cfg.include),
    latex: asBool(o.latex, cfg.latex),
    classes: asStringArray(o.classes)?.map((c) => c.replace(/^\./, "")) ?? [],
    filename: typeof o.filename === "string" ? o.filename : void 0,
    label: typeof o.label === "string" ? o.label : void 0,
    figCap: typeof o["fig-cap"] === "string" ? o["fig-cap"] : void 0,
    figAlt: typeof o["fig-alt"] === "string" ? o["fig-alt"] : void 0,
    figWidth: o["fig-width"] !== void 0 ? String(o["fig-width"]) : void 0
  };
}
function resolvePython(cfg) {
  if (cfg.python) return [
    cfg.python
  ];
  const env = Deno.env.get("ER2_PYTHON");
  if (env) return [
    env
  ];
  const fromShebang = er2Interpreter();
  if (fromShebang) return fromShebang;
  return [
    Deno.build.os === "windows" ? "python" : "python3"
  ];
}
function er2Interpreter() {
  const sep = Deno.build.os === "windows" ? ";" : ":";
  for (const dir of (Deno.env.get("PATH") ?? "").split(sep)) {
    if (!dir) continue;
    const candidate = `${dir}/er2`;
    let head;
    try {
      const file = Deno.openSync(candidate, {
        read: true
      });
      const buf = new Uint8Array(512);
      const n = file.readSync(buf) ?? 0;
      file.close();
      head = new TextDecoder().decode(buf.subarray(0, n));
    } catch {
      continue;
    }
    const first = head.split(/\r?\n/, 1)[0];
    if (!first.startsWith("#!")) return void 0;
    const words = first.slice(2).trim().split(/\s+/);
    if (/(^|\/)env$/.test(words[0])) return words.slice(1);
    return words;
  }
  return void 0;
}
var kMissingPython = (python) => `ER2-ENGINE could not start Python ("${python}").

Install ER2 (https://github.com/oeistools/ER2) so that the "er2" command is on your PATH, or point the engine at a Python that can "import er2":

    ---
    engine: er2
    er2:
      python: /path/to/python
    ---
`;
async function runEr2(items, cfg, cwd) {
  if (items.length === 0 && !cfg.prelude) return [];
  const job = JSON.stringify({
    items,
    prelude: cfg.prelude,
    figure_dpi: cfg.figDpi
  });
  const [python, ...pythonArgs] = resolvePython(cfg);
  const runner = extensionDir() + kRunner;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeout * 1e3);
  let stdout;
  let stderr;
  let code;
  try {
    const child = new Deno.Command(python, {
      // -I would drop the user's site-packages, which is where a
      // `pip install --user er2` lives, so only -u (unbuffered) is set.
      args: [
        ...pythonArgs,
        "-u",
        runner
      ],
      cwd,
      env: {
        MPLBACKEND: "Agg",
        PYTHONIOENCODING: "utf-8"
      },
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
      signal: controller.signal
    }).spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(job));
    await writer.close().catch(() => {
    });
    const result = await child.output();
    stdout = new TextDecoder().decode(result.stdout);
    stderr = new TextDecoder().decode(result.stderr);
    code = result.code;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      throw new Error(kMissingPython(python));
    }
    if (controller.signal.aborted) {
      throw new Error(`ER2 did not finish within ${cfg.timeout}s. Raise the limit with "er2: { timeout: <seconds> }" in the document front matter.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`The ER2 runner (${python}) exited with code ${code} without a result.

${stderr.trim() || stdout.trim() || "(no output)"}`);
  }
  if (parsed.fatal) throw new Error(parsed.fatal);
  return parsed.items ?? [];
}
function trimOutput(s) {
  return s.replace(/^\s*\n/, "").replace(/\s+$/, "");
}
function fence(content) {
  let longest = 0;
  for (const m of content.matchAll(/^`{3,}/gm)) longest = Math.max(longest, m[0].length);
  return "`".repeat(Math.max(3, longest + 1));
}
function codeBlock(content, attrs) {
  const f = fence(content);
  return `${f}${attrs}
${content}
${f}
`;
}
function outputDiv(kind, body) {
  return `
::: {.cell-output .${kind}}
${body}:::
`;
}
function displayMarkdown(data, opts) {
  if (opts.latex) {
    const rich = data["text/markdown"] ?? displayMath(data["text/latex"]);
    if (rich !== void 0) return outputDiv("cell-output-display", `
${rich}

`);
  }
  return outputDiv("cell-output-display", codeBlock(data["text/plain"] ?? "", ""));
}
function displayMath(latex) {
  if (latex === void 0) return void 0;
  const m = latex.trim().match(/^\$\\displaystyle\s*([\s\S]*)\$$/);
  return m ? `$$${m[1].trim()}$$` : latex;
}
var kInlineEr2 = /(?<!`)`\{er2\}\s+([^`\s][^`]*)`(?!`)/g;
function proseRuns(md) {
  const runs = [];
  const fence2 = /^(\s*)(`{3,}|~{3,}).*$/gm;
  let at = 0;
  let open = null;
  let m;
  while ((m = fence2.exec(md)) !== null) {
    const marker = m[2];
    if (open === null) {
      runs.push({
        text: md.slice(at, m.index),
        code: false
      });
      at = m.index;
      open = marker[0].repeat(marker.length);
    } else if (marker[0] === open[0] && marker.length >= open.length) {
      const end = m.index + m[0].length;
      runs.push({
        text: md.slice(at, end),
        code: true
      });
      at = end;
      open = null;
    }
  }
  runs.push({
    text: md.slice(at),
    code: open !== null
  });
  return runs;
}
function findInlineExpressions(md) {
  const found = [];
  for (const run of proseRuns(md)) {
    if (run.code) continue;
    for (const m of run.text.matchAll(kInlineEr2)) found.push(m[1].trim());
  }
  return found;
}
function substituteInline(md, values) {
  let i = 0;
  return proseRuns(md).map((run) => {
    if (run.code) return run.text;
    return run.text.replace(kInlineEr2, () => values[i++] ?? "");
  }).join("");
}
function inlineValue(result, cfg) {
  const out = result?.outputs[0];
  if (!out) return "";
  if (out.type === "error") return `**${out.ename}: ${out.evalue}**`;
  const data = out.data ?? {};
  const text = (cfg.latex ? data["text/markdown"] : void 0) ?? data["text/plain"] ?? "";
  return text.trim().replace(/\s*\n\s*/g, " ");
}
function attrEscape(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
function emitFigure(path, opts, first) {
  const attrs = [];
  if (opts.label && first) attrs.push(`#${opts.label}`);
  if (opts.figWidth) attrs.push(`width="${attrEscape(opts.figWidth)}"`);
  if (opts.figAlt) attrs.push(`fig-alt="${attrEscape(opts.figAlt)}"`);
  const attr = attrs.length ? `{${attrs.join(" ")}}` : "";
  const cap = first ? opts.figCap ?? "" : "";
  return outputDiv("cell-output-display", `
![${cap}](${path})${attr}

`);
}
function emitCell(code, result, opts, figureDir2) {
  if (!opts.include) return "";
  const parts = [];
  if (opts.echo) {
    const classes = [
      kHighlightLanguage,
      "cell-code",
      ...opts.classes
    ].map((c) => `.${c}`).join(" ");
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
        parts.push(emitFigure(`${figureDir2}/${out.name}`, opts, figures === 0));
        figures += 1;
      } else if (out.type === "error") {
        parts.push(outputDiv("cell-output-error", codeBlock(trimOutput(out.traceback ?? ""), "")));
      }
    }
  }
  if (parts.length === 0) return "";
  const cellAttrs = [
    ".cell"
  ];
  if (opts.label && !opts.label.startsWith("fig-")) cellAttrs.unshift(`#${opts.label}`);
  return `
::: {${cellAttrs.join(" ")}}
${parts.join("")}:::

`;
}
function figureDir(input, cwd) {
  const norm = input.replace(/\\/g, "/");
  const base = norm.slice(norm.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  const cwdNorm = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  return {
    absolute: `${cwdNorm}/${base}_files/figure-er2`,
    relative: `${base}_files/figure-er2`,
    supporting: `${cwdNorm}/${base}_files`
  };
}
function figureFormat(cfg, to) {
  if (cfg.figFormat) return cfg.figFormat;
  if (/html|revealjs|epub|dashboard/i.test(to)) return "svg";
  if (/latex|pdf|beamer/i.test(to)) return "pdf";
  return "png";
}
function extensionDir() {
  const url = new URL(".", import.meta.url);
  let path = decodeURIComponent(url.pathname);
  if (Deno.build.os === "windows" && /^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  return path;
}
function syntaxDefinitionPath(documentDir) {
  const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const target = norm(extensionDir() + kSyntaxDefinition).split("/");
  const from = norm(documentDir).split("/");
  if (from[0] !== target[0]) return target.join("/");
  let i = 0;
  while (i < from.length && i < target.length && from[i] === target[i]) i += 1;
  const rel = [
    ...new Array(from.length - i).fill(".."),
    ...target.slice(i)
  ];
  return rel.length > 0 ? rel.join("/") : target.join("/");
}
var er2Engine = {
  init: (quartoAPI) => {
    quarto = quartoAPI;
  },
  name: kEngineName,
  defaultExt: ".qmd",
  defaultYaml: () => [
    "engine: er2"
  ],
  defaultContent: () => [
    "```{er2}",
    "sym x",
    "factor(x^2 - 1), phi(2^61 - 1), 1/3",
    "```"
  ],
  validExtensions: () => [],
  claimsFile: (_file, _ext) => false,
  claimsLanguage: (language, _firstClass) => language.toLowerCase() === kCellLanguage,
  canFreeze: true,
  generatesFigures: true,
  launch: (_context) => {
    return {
      name: kEngineName,
      canFreeze: true,
      markdownForFile: (file) => Promise.resolve(quarto.mappedString.fromFile(file)),
      target: (file, _quiet, markdown) => {
        const md = markdown ?? quarto.mappedString.fromFile(file);
        const target = {
          source: file,
          input: file,
          markdown: md,
          metadata: quarto.markdownRegex.extractYaml(md.value)
        };
        return Promise.resolve(target);
      },
      partitionedMarkdown: (file) => Promise.resolve(quarto.markdownRegex.partition(Deno.readTextFileSync(file))),
      execute: async (options) => {
        const cfg = readConfig(options.format?.metadata ?? options.target.metadata);
        const chunks = await quarto.markdownRegex.breakQuartoMd(options.target.markdown);
        const to = options.format?.pandoc?.to ?? "html";
        const figures = figureDir(options.target.input, options.cwd);
        const format = figureFormat(cfg, to);
        const cells = chunks.cells.map((cell) => {
          const isEr2 = typeof cell.cell_type === "object" && cell.cell_type.language === kCellLanguage;
          if (!isEr2) return {
            er2: false,
            cell
          };
          const opts = readCellOptions(cell.options, cfg);
          return {
            er2: true,
            cell,
            opts
          };
        });
        const inlineCounts = /* @__PURE__ */ new Map();
        const job = [];
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
                  stem: c.opts.label ?? `cell-${cellNumber}`
                }
              });
            }
            return;
          }
          if (c.cell.cell_type === "raw") return;
          const exprs = findInlineExpressions(c.cell.sourceVerbatim.value);
          if (exprs.length === 0) return;
          inlineCounts.set(i, exprs.length);
          for (const e of exprs) job.push({
            kind: "inline",
            code: e
          });
        });
        const results = await runEr2(job, cfg, options.cwd);
        const out = [];
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
            const failedAt = slice.findIndex((r) => r.error);
            if (failedAt !== -1 && !cfg.error) {
              const e = slice[failedAt].outputs[0];
              const expr = job[at - n + failedAt].code;
              throw new Error(`ER2 error in the inline expression \`{er2} ${expr}\`:

${trimOutput(e?.traceback ?? "")}

Set "error: true" under "er2:" in the front matter to show the error in the rendered document instead of stopping.`);
            }
            out.push(substituteInline(c.cell.sourceVerbatim.value, slice.map((r) => inlineValue(r, cfg))));
            continue;
          }
          const code = c.cell.source.value;
          const result2 = c.opts.eval ? results[at++] : void 0;
          if (result2?.error && !c.opts.error) {
            const e = result2.outputs.find((o) => o.type === "error");
            throw new Error(`ER2 error in an {er2} cell${c.cell.cellStartLine ? ` at line ${c.cell.cellStartLine}` : ""}:

${trimOutput(e?.traceback ?? "")}

Set "#| error: true" on the cell (or "error: true" under "er2:" in the front matter) to show the error in the rendered document instead of stopping.`);
          }
          out.push(emitCell(code, result2, c.opts, figures.relative));
        }
        const supporting = [];
        try {
          if (Deno.statSync(figures.absolute).isDirectory) {
            supporting.push(figures.supporting);
          }
        } catch {
        }
        const result = {
          engine: kEngineName,
          markdown: out.join(""),
          supporting,
          filters: []
        };
        if (cfg.highlight) {
          const xml = syntaxDefinitionPath(options.cwd);
          const existing = options.format?.pandoc?.["syntax-definitions"];
          const defs = Array.isArray(existing) ? [
            ...existing
          ] : [];
          if (!defs.some((d) => String(d).endsWith(kSyntaxDefinition))) {
            defs.push(xml);
          }
          result.pandoc = {
            "syntax-definitions": defs
          };
        }
        return result;
      },
      dependencies: (_options) => Promise.resolve({
        includes: {}
      }),
      postprocess: (_options) => Promise.resolve()
    };
  }
};
var er2_default = er2Engine;
export {
  er2_default as default
};
