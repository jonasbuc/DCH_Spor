import esbuild from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const cwd = process.cwd();
const outdir = resolve(cwd, ".preview");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await esbuild.build({
  entryPoints: [resolve(cwd, "src/preview/main.tsx")],
  bundle: true,
  sourcemap: true,
  minify: true,
  outdir,
  entryNames: "app",
  format: "esm",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production")
  },
  loader: {
    ".gif": "file",
    ".jpg": "file",
    ".jpeg": "file",
    ".png": "file",
    ".svg": "file",
    ".woff": "file",
    ".woff2": "file"
  },
  plugins: [srcAliasPlugin()]
});

await writeFile(resolve(outdir, "index.html"), previewHtml(), "utf8");
process.stdout.write("Preview build skrevet til .preview\n");

function srcAliasPlugin() {
  return {
    name: "src-alias",
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => ({ path: resolveSourcePath(args.path) }));
    }
  };
}

function resolveSourcePath(path) {
  const basePath = resolve(cwd, "src", path.slice(2));
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}/index.ts`,
    `${basePath}/index.tsx`
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? basePath;
}

function previewHtml() {
  return `<!doctype html>
<html lang="da">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DcH Sporplanlægger Preview</title>
    <link rel="stylesheet" href="/app.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/app.js"></script>
  </body>
</html>
`;
}
