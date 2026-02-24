#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const TEST_ROOT = join(ROOT, "tests");

function isTestFile(name) {
  return name.endsWith(".test.js");
}

async function collectTestFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTestFiles(full)));
      continue;
    }
    if (entry.isFile() && isTestFile(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function runNodeTests(files) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--test", ...files.map((f) => relative(ROOT, f))],
      { stdio: "inherit", shell: false }
    );
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const files = (await collectTestFiles(TEST_ROOT)).sort();
  if (files.length === 0) {
    console.error("No test files found under ./tests");
    process.exit(1);
  }

  const code = await runNodeTests(files);
  process.exit(code);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
