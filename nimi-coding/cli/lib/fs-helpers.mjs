import { readFile, stat, writeFile } from "node:fs/promises";

export async function pathExists(targetPath) {
  try {
    return await stat(targetPath);
  } catch {
    return null;
  }
}

export async function readTextIfFile(filePath) {
  const info = await pathExists(filePath);
  if (!info || !info.isFile()) {
    return null;
  }

  return readFile(filePath, "utf8");
}

export async function appendGitignoreEntries(gitignorePath, entries) {
  const existing = (await pathExists(gitignorePath))
    ? await readFile(gitignorePath, "utf8")
    : "";
  const missing = entries.filter((entry) => !existing.includes(entry));

  if (missing.length === 0) {
    return false;
  }

  const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  await writeFile(gitignorePath, `${existing}${prefix}${missing.join("\n")}\n`, "utf8");
  return true;
}
