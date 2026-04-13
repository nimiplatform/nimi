import { spawnSync } from "node:child_process";

export function runNodeScript(scriptPath, args = [], options = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: "pipe",
    encoding: "utf8",
    shell: false,
  });

  return {
    ok: result.status === 0,
    exitCode: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

export function runCommand(command, options = {}) {
  const result = spawnSync(command, {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: "pipe",
    encoding: "utf8",
    shell: true,
  });

  return {
    ok: result.status === 0,
    exitCode: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}
