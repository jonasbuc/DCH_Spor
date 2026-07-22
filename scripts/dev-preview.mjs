import esbuild from "esbuild";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, relative, resolve } from "node:path";
import process from "node:process";

const cwd = process.cwd();
const outdir = resolve(cwd, ".preview");
const host = process.env.HOST ?? "127.0.0.1";
const watch = !process.argv.includes("--no-watch");
let port = Number(process.env.PORT ?? "3102");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await writeFile(resolve(outdir, "index.html"), previewHtml(), "utf8");

const context = await esbuild.context({
  entryPoints: [resolve(cwd, "src/preview/main.tsx")],
  bundle: true,
  sourcemap: true,
  outdir,
  entryNames: "app",
  format: "esm",
  define: {
    "process.env.NODE_ENV": JSON.stringify("development")
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

await context.rebuild();
if (watch) {
  await context.watch();
}

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

server.on("error", (error) => {
  if (error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE" && port < 3120) {
    port += 1;
    server.listen(port, host);
    return;
  }
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  process.stdout.write(`DcH real preview: http://${host}:${port}/\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown();
  });
}

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);

    if (url.pathname === "/api/health") {
      sendJson(response, 200, {
        success: true,
        data: {
          app: "DcH Sporplanlægger",
          mode: "real-preview",
          server: "ok"
        }
      });
      return;
    }

    if (url.pathname === "/api/geocode") {
      await geocode(url, response);
      return;
    }

    const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const target = resolve(outdir, `.${requestPath}`);
    const targetRelative = relative(outdir, target);

    if (targetRelative.startsWith("..") || targetRelative === "" || !existsSync(target)) {
      sendText(response, 404, "Ikke fundet");
      return;
    }

    response.writeHead(200, { "Content-Type": mimeFor(target) });
    createReadStream(target).pipe(response);
  } catch (error) {
    sendJson(response, 500, {
      success: false,
      error: { message: error instanceof Error ? error.message : "Serverfejl" }
    });
  }
}

async function geocode(url, response) {
  const query = url.searchParams.get("query")?.trim();
  if (!query) {
    sendJson(response, 400, { success: false, error: { message: "Skriv en adresse." } });
    return;
  }

  const upstreamUrl = new URL("https://nominatim.openstreetmap.org/search");
  upstreamUrl.searchParams.set("q", query);
  upstreamUrl.searchParams.set("format", "jsonv2");
  upstreamUrl.searchParams.set("limit", "6");
  upstreamUrl.searchParams.set("addressdetails", "1");
  upstreamUrl.searchParams.set("countrycodes", "dk");

  const upstream = await fetch(upstreamUrl, {
    headers: {
      "User-Agent": "dch-sporplanlaegger-local-preview/0.1"
    }
  });

  if (!upstream.ok) {
    sendJson(response, 502, { success: false, error: { message: "Adresseopslag kunne ikke hentes." } });
    return;
  }

  const payload = await upstream.json();
  const rows = Array.isArray(payload) ? payload : [];
  const data = rows
    .map((row) => ({
      label: String(row.display_name ?? "Ukendt adresse"),
      lat: Number(row.lat),
      lon: Number(row.lon)
    }))
    .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lon));

  sendJson(response, 200, { success: true, data });
}

async function shutdown() {
  server.close();
  await context.dispose();
  process.exit(0);
}

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

function sendText(response, status, text) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function mimeFor(path) {
  const ext = extname(path);
  const types = {
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".woff": "font/woff",
    ".woff2": "font/woff2"
  };
  return types[ext] ?? "application/octet-stream";
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
