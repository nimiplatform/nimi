import { existsSync as defaultExistsSync } from 'node:fs';
import path from 'node:path';

export function parseFirstJsonDocument(output, reasonCode) {
  const raw = String(output ?? '').replace(/^\ufeff/u, '').trim();
  for (let start = 0; start < raw.length; start += 1) {
    const opening = raw[start];
    if (opening !== '{' && opening !== '[') continue;

    const stack = [];
    let inString = false;
    let escaped = false;
    for (let cursor = start; cursor < raw.length; cursor += 1) {
      const character = raw[cursor];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }

      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === '{' || character === '[') {
        stack.push(character);
        continue;
      }
      if (character !== '}' && character !== ']') continue;

      const expectedOpening = character === '}' ? '{' : '[';
      if (stack.pop() !== expectedOpening) break;
      if (stack.length !== 0) continue;

      try {
        return {
          value: JSON.parse(raw.slice(start, cursor + 1)),
          diagnostics: [raw.slice(0, start).trim(), raw.slice(cursor + 1).trim()]
            .filter(Boolean)
            .join('\n'),
        };
      } catch {
        break;
      }
    }
  }

  throw Object.assign(
    new Error('PowerShell command did not return a complete valid JSON document.'),
    {
      reasonCode,
      actionHint: 'inspect_powershell_command_output',
    },
  );
}

export function parsePowerShellJsonResult(result, reasonCode, {
  writeDiagnostics = (value) => process.stderr.write(value),
} = {}) {
  const receipt = parseFirstJsonDocument(result?.stdout, reasonCode);
  const diagnostics = [String(result?.stderr ?? '').trim(), receipt.diagnostics]
    .filter(Boolean)
    .join('\n');
  if (diagnostics) writeDiagnostics(`${diagnostics}\n`);
  return receipt.value;
}

export function resolveWindowsPowerShell7(options = {}) {
  const env = options.env ?? process.env;
  const existsSync = options.existsSync ?? defaultExistsSync;
  const explicit = String(env.NIMI_PWSH_PATH || '').trim();
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!path.isAbsolute(explicit) || !existsSync(resolved)) {
      throw new Error(`NIMI_PWSH_PATH must identify an existing absolute PowerShell 7 executable: ${explicit}`);
    }
    return resolved;
  }
  const programFiles = String(env.ProgramW6432 || env.ProgramFiles || 'C:\\Program Files').trim();
  const bundledPath = path.join(programFiles, 'PowerShell', '7', 'pwsh.exe');
  if (!existsSync(bundledPath)) {
    throw new Error(`PowerShell 7 is required for protected Windows development workflows: ${bundledPath}`);
  }
  return bundledPath;
}
