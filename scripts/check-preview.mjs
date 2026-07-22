import { spawn } from "node:child_process";
import process from "node:process";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "3199");
let serverUrl = `http://${host}:${port}`;
let output = "";

const server = spawn(process.execPath, ["scripts/dev-preview.mjs", "--no-watch"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOST: host,
    PORT: String(port)
  },
  stdio: ["ignore", "pipe", "pipe"]
});

server.stdout.on("data", (chunk) => {
  const text = String(chunk);
  output += text;
  process.stdout.write(text);
  const match = output.match(/http:\/\/[^\s]+/);
  if (match) {
    serverUrl = match[0].replace(/\/$/, "");
  }
});

server.stderr.on("data", (chunk) => {
  process.stderr.write(String(chunk));
});

try {
  await waitForServer();
  await assertText(`${serverUrl}/`, "DcH Sporplanlægger");
  await assertHealth(`${serverUrl}/api/health`);
  process.stdout.write(`Preview check ok: ${serverUrl}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Preview check fejlede"}\n`);
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
  await sleep(250);
  if (server.exitCode === null) {
    server.kill("SIGKILL");
  }
}

async function waitForServer() {
  const deadline = Date.now() + 45_000;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Preview-serveren stoppede før health-check. Output: ${output}`);
    }

    try {
      const response = await fetch(`${serverUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      await sleep(500);
    }
  }

  throw new Error(`Preview-serveren svarede ikke på ${serverUrl}/api/health`);
}

async function assertText(url, expectedText) {
  const response = await fetch(url);
  const text = await response.text();

  if (!response.ok || !text.includes(expectedText)) {
    throw new Error(`${url} gav ikke forventet preview-HTML`);
  }
}

async function assertHealth(url) {
  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok || payload.success !== true || payload.data?.server !== "ok") {
    throw new Error(`${url} gav ikke en gyldig health-status`);
  }
}

function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
