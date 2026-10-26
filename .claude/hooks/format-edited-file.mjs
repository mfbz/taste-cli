// Formats the file an agent just edited, so every change lands formatted without a pre-commit rewrite.
// The path comes from tool input, so it is treated as untrusted: resolved inside the project, passed after
// `--` so it can never become a Prettier option, and run through node directly so no shell ever parses it.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, relative, resolve } from "node:path";

const projectDir = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;

let filePath;
try {
  filePath = JSON.parse(input || "{}")?.tool_input?.file_path;
} catch {
  process.exit(0);
}
if (typeof filePath !== "string" || filePath.length === 0) process.exit(0);

const target = resolve(projectDir, filePath);
const fromProject = relative(projectDir, target);
if (fromProject.startsWith("..") || isAbsolute(fromProject)) process.exit(0);
if (!existsSync(target)) process.exit(0);

let prettierBin;
try {
  prettierBin = createRequire(resolve(projectDir, "package.json")).resolve(
    "prettier/bin/prettier.cjs"
  );
} catch {
  prettierBin = createRequire(import.meta.url).resolve(
    "prettier/bin/prettier.cjs"
  );
}

spawnSync(
  process.execPath,
  [prettierBin, "--write", "--ignore-unknown", "--", target],
  { stdio: "ignore", cwd: projectDir }
);
