import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const roots = ["src", "prisma", "scripts"];
const files = roots.flatMap((root) => walk(root)).filter((file) => /\.(ts|tsx|mjs)$/.test(file));
const errors = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");

  lines.forEach((line, index) => {
    if (/\s+$/.test(line)) {
      errors.push(`${file}:${index + 1} trailing whitespace`);
    }
    if (/\bany\b/.test(line) && !line.includes("no-explicit-any")) {
      errors.push(`${file}:${index + 1} forbidden broad type keyword`);
    }
  });

  if (/\bconsole\.log\s*\(/.test(source) && !file.endsWith("prisma/seed.ts")) {
    errors.push(`${file}: console logging is not allowed outside seed scripts`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  process.exit(0);
}

function walk(root) {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (["node_modules", ".next", "coverage"].includes(entry)) {
        return [];
      }
      return walk(path);
    }
    return [path];
  });
}
