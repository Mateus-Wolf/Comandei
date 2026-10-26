import { spawn } from "node:child_process";
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import path from "node:path";

if (existsSync(".env.local")) loadEnvFile(".env.local");
const task = process.argv[2] ?? "dev";
if (!["dev", "build", "start"].includes(task))
  throw new Error("Tarefa web inválida.");
// The browser only receives NEXT_PUBLIC_* variables. Database credentials stay server-side.
const child = spawn(
  process.execPath,
  [
    path.resolve("node_modules/next/dist/bin/next"),
    task,
    "apps/web",
    ...process.argv.slice(3),
  ],
  { stdio: "inherit", env: process.env },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
