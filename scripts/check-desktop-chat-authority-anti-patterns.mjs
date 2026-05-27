#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const CHAT_ROOT = path.join(repoRoot, 'apps/desktop/src/shell/renderer/features/chat');
const PROVIDERS_ROOT = path.join(repoRoot, 'apps/desktop/src/shell/renderer/app-shell/providers');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const ALLOWED_CHAT_STORAGE_FILE = path.join(CHAT_ROOT, 'chat-settings-storage.ts');
const ALLOWED_AGENT_CHAT_MEDIA_INPUT_FILES = new Set([
  'chat-agent-voice-transcribe-runtime.ts',
]);

const BANNED_IDENTIFIER_PATTERNS = [
  {
    label: 'chat-owned global route selection state',
    regex: /\bglobalChatRouteSelection\b/gu,
  },
  {
    label: 'chat-owned global route selection setter',
    regex: /\bsetGlobalChatRouteSelection\b/gu,
  },
];

/**
 * T3-3: built-in chat scope authority anti-patterns.
 *
 * The four chat modes bind only the canonical built-in `feature` scopes
 * (feature:desktop.chat:nimi / feature:desktop.chat:agent) — see the product
 * manual "Chat AIScopeRef Targets" alignment rule: the generic
 * `{ kind: 'app', ownerId: 'desktop', surfaceId: 'chat' }` scope and the
 * generic `createDefaultAIScopeRef` factory are retired historical fallbacks
 * and must not be the mode-scope authority for the chat surface.
 *
 * These patterns are enforced only against the chat *mode-scope live path*
 * — the files that resolve and rebind a chat mode to its AIConfig scope.
 * `conversation-capability.ts` is intentionally excluded: it is the
 * D-AIPC-010 selection-store submodel bridge and legitimately re-exports the
 * generic SDK factory for non-mode-scoped bridging; it does not bind a chat
 * mode to a scope.
 */
const BANNED_BUILTIN_CHAT_SCOPE_PATTERNS = [
  {
    label: 'generic default AIConfig scope factory in chat mode-scope live path',
    regex: /\bcreateDefaultAIScopeRef\b/gu,
  },
  {
    // Forbid the generic `{ kind: 'app', ownerId: 'desktop', surfaceId: 'chat' }`
    // scope literal in either property order, tolerant of whitespace.
    label: 'generic app:desktop:chat AIConfig scope literal in chat mode-scope live path',
    regex: /\{[^{}]*\bkind\s*:\s*['"`]app['"`][^{}]*\bownerId\s*:\s*['"`]desktop['"`][^{}]*\bsurfaceId\s*:\s*['"`]chat['"`][^{}]*\}|\{[^{}]*\bsurfaceId\s*:\s*['"`]chat['"`][^{}]*\bownerId\s*:\s*['"`]desktop['"`][^{}]*\bkind\s*:\s*['"`]app['"`][^{}]*\}/gu,
  },
];

/**
 * The chat mode-scope live path: files that own resolving / rebinding which
 * AIConfig scope a chat mode is bound to. A future change that rebinds any of
 * these to the generic scope fails this guard.
 */
const BUILTIN_CHAT_SCOPE_LIVE_PATH = [
  'chat-shared-active-ai-config-scope.ts',
  'conversation-capability-projection.ts',
];

const BANNED_CHAT_STORAGE_PATTERNS = [
  {
    label: 'chat route storage key',
    regex: /\bCHAT_[A-Z0-9_]*ROUTE[A-Z0-9_]*STORAGE_KEY\b/gu,
  },
  {
    label: 'chat route persistence helper',
    regex: /\b(?:loadStoredChatRoute|persistStoredChatRoute)\b/gu,
  },
  {
    label: 'route string in chat settings storage',
    regex: /['"`][^'"`\n]*route[^'"`\n]*['"`]/giu,
  },
];

const BANNED_AGENT_CHAT_FILE_PATTERNS = [
  {
    label: 'desktop-owned agent chat orchestration file',
    regex: /^chat-agent-orchestration(?:-|\.|$)/u,
  },
  {
    label: 'desktop-owned agent chat turn plan file',
    regex: /^chat-agent-turn-plan\.tsx?$/u,
  },
  {
    label: 'desktop-owned nimi execution engine file',
    regex: /^chat-nimi-execution-engine(?:-|\.|$)/u,
  },
  {
    label: 'desktop-owned agent chat runtime execution helper file',
    regex: /^chat-agent-runtime-(?:text|image|voice)(?:-helpers)?\.tsx?$/u,
  },
  {
    label: 'desktop-owned agent chat voice workflow tracker file',
    regex: /^chat-agent-voice-workflow-tracker\.tsx?$/u,
  },
  {
    label: 'desktop-owned agent chat behavior resolver file',
    regex: /^chat-agent-behavior-resolver(?:-|\.|$)/u,
  },
  {
    label: 'desktop-owned agent chat output contract file',
    regex: /^chat-output-contract\.tsx?$/u,
  },
];

const BANNED_AGENT_CHAT_EXECUTION_PATTERNS = [
  {
    label: 'desktop agent chat executeScenario path',
    regex: /\bexecuteScenario\b/gu,
  },
  {
    label: 'desktop agent chat output media execution path',
    regex: /\bmedia\.(?:image|tts)\b/gu,
  },
  {
    label: 'desktop agent chat runtime STT outside explicit voice input capture',
    regex: /\bmedia\.stt\b/gu,
    allowedBasenames: ALLOWED_AGENT_CHAT_MEDIA_INPUT_FILES,
  },
  {
    label: 'desktop agent chat execution binding truth',
    regex: /\bexecutionBinding\s*:/gu,
  },
  {
    label: 'desktop-owned agent chat resolved action runner',
    regex: /\brunResolvedEnvelopeActions\b/gu,
  },
  {
    label: 'desktop-owned agent chat text execution request builder',
    regex: /\bbuildAgentLocalChatExecutionTextRequest\b/gu,
  },
  {
    label: 'desktop-owned agent chat image generation helper',
    regex: /\bgenerateChatAgentImageRuntime\b/gu,
  },
  {
    label: 'desktop-owned agent chat voice synthesis helper',
    regex: /\bsynthesizeChatAgentVoiceRuntime\b/gu,
  },
  {
    label: 'desktop-owned agent chat voice workflow helper',
    regex: /\b(?:submitChatAgentVoiceWorkflowRuntime|pollChatAgentVoiceWorkflowRuntime|synthesizeChatAgentVoiceReferenceRuntime)\b/gu,
  },
  {
    label: 'desktop-owned agent chat behavior resolver',
    regex: /\b(?:resolveAgentChatBehavior|resolveAgentTurnMode|resolveAgentExperiencePolicy)\b/gu,
  },
  {
    label: 'desktop-owned raw agent output parser',
    regex: /\b(?:parseAgentResolvedMessageActionEnvelopeWithDiagnostics|parseAgentResolvedMessageActionEnvelope|resolveAgentModelOutputEnvelope|composeDesktopChatSystemPrompt)\b/gu,
  },
];

function toRepoRelative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

function getLineColumn(source, index) {
  const prefix = source.slice(0, index);
  const line = prefix.split('\n').length;
  const lastBreak = prefix.lastIndexOf('\n');
  const column = index - lastBreak;
  return { line, column };
}

async function collectSourceFiles(dir) {
  const files = [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(fullPath));
      continue;
    }
    if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

function collectPatternViolations(source, relPath, patterns) {
  const violations = [];
  const basename = path.basename(relPath);
  for (const { label, regex, allowedBasenames } of patterns) {
    if (allowedBasenames?.has(basename)) {
      continue;
    }
    regex.lastIndex = 0;
    let match = regex.exec(source);
    while (match) {
      const { line, column } = getLineColumn(source, match.index);
      violations.push(`${relPath}:${line}:${column} ${label}`);
      match = regex.exec(source);
    }
  }
  return violations;
}

function collectFileNameViolations(filePath, relPath, chatRoot) {
  if (!filePath.startsWith(chatRoot)) {
    return [];
  }
  const basename = path.basename(filePath);
  const violations = [];
  for (const { label, regex } of BANNED_AGENT_CHAT_FILE_PATTERNS) {
    if (regex.test(basename)) {
      violations.push(`${relPath}:1:1 ${label}`);
    }
  }
  return violations;
}

function collectAgentChatProjectionViolations(filePath, source, relPath, chatRoot) {
  if (!filePath.startsWith(chatRoot)) {
    return [];
  }
  return [
    ...collectFileNameViolations(filePath, relPath, chatRoot),
    ...collectPatternViolations(source, relPath, BANNED_AGENT_CHAT_EXECUTION_PATTERNS),
  ];
}

function isBuiltInChatScopeLivePathFile(filePath, chatRoot) {
  return BUILTIN_CHAT_SCOPE_LIVE_PATH.some(
    (name) => filePath === path.join(chatRoot, name),
  );
}

async function collectViolations() {
  const files = [
    ...await collectSourceFiles(CHAT_ROOT),
    ...await collectSourceFiles(PROVIDERS_ROOT),
  ];
  const violations = [];

  for (const filePath of files) {
    const relPath = toRepoRelative(filePath);
    const source = await fs.readFile(filePath, 'utf8');

    violations.push(...collectPatternViolations(source, relPath, BANNED_IDENTIFIER_PATTERNS));
    violations.push(...collectAgentChatProjectionViolations(filePath, source, relPath, CHAT_ROOT));

    if (isBuiltInChatScopeLivePathFile(filePath, CHAT_ROOT)) {
      violations.push(
        ...collectPatternViolations(source, relPath, BANNED_BUILTIN_CHAT_SCOPE_PATTERNS),
      );
    }

    if (filePath.startsWith(CHAT_ROOT) && filePath !== ALLOWED_CHAT_STORAGE_FILE) {
      const storageRegex = /\b(?:localStorage|getItem\s*\(|setItem\s*\()/gu;
      storageRegex.lastIndex = 0;
      let match = storageRegex.exec(source);
      while (match) {
        const { line, column } = getLineColumn(source, match.index);
        violations.push(`${relPath}:${line}:${column} chat feature must not own storage persistence directly`);
        match = storageRegex.exec(source);
      }
    }

    if (filePath === ALLOWED_CHAT_STORAGE_FILE) {
      violations.push(...collectPatternViolations(source, relPath, BANNED_CHAT_STORAGE_PATTERNS));
    }
  }

  return {
    files,
    violations,
  };
}

async function runSelfTest() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nimi-chat-authority-'));
  const chatRoot = path.join(tempRoot, 'apps/desktop/src/shell/renderer/features/chat');
  const providersRoot = path.join(tempRoot, 'apps/desktop/src/shell/renderer/app-shell/providers');
  await fs.mkdir(chatRoot, { recursive: true });
  await fs.mkdir(providersRoot, { recursive: true });

  const originalChatRoot = CHAT_ROOT;
  const originalProvidersRoot = PROVIDERS_ROOT;
  const originalAllowed = ALLOWED_CHAT_STORAGE_FILE;

  try {
    await fs.writeFile(
      path.join(chatRoot, 'chat-settings-storage.ts'),
      "export const CHAT_THINKING_PREFERENCE_STORAGE_KEY = 'nimi.chat.settings.thinking.v1';\n",
      'utf8',
    );
    await fs.writeFile(
      path.join(chatRoot, 'good.ts'),
      "export const x = 'ok';\n",
      'utf8',
    );
    await fs.writeFile(
      path.join(chatRoot, 'bad.ts'),
      "const y = localStorage.getItem('nimi.chat.route');\n",
      'utf8',
    );
    await fs.writeFile(
      path.join(providersRoot, 'bad-provider.ts'),
      "const globalChatRouteSelection = null;\n",
      'utf8',
    );
    await fs.writeFile(
      path.join(chatRoot, 'chat-agent-orchestration.ts'),
      "export const oldProvider = true;\n",
      'utf8',
    );
    await fs.writeFile(
      path.join(chatRoot, 'bad-runtime-execution.ts'),
      "await runtime.ai.executeScenario({});\nawait client.media.tts.synthesize({});\n",
      'utf8',
    );
    await fs.writeFile(
      path.join(chatRoot, 'chat-agent-behavior-resolver.ts'),
      "export function resolveAgentChatBehavior() {}\n",
      'utf8',
    );
    await fs.writeFile(
      path.join(chatRoot, 'chat-agent-voice-transcribe-runtime.ts'),
      "await client.media.stt.transcribe({});\n",
      'utf8',
    );
    // T3-3: a chat mode-scope live-path file that rebinds to the generic
    // scope must be flagged (both the factory call and the literal).
    await fs.writeFile(
      path.join(chatRoot, 'conversation-capability-projection.ts'),
      "const scope = createDefaultAIScopeRef();\n"
        + "const generic = { kind: 'app', ownerId: 'desktop', surfaceId: 'chat' };\n",
      'utf8',
    );

    globalThis.__NIMI_CHAT_AUTHORITY_TEST_ROOTS__ = {
      CHAT_ROOT: chatRoot,
      PROVIDERS_ROOT: providersRoot,
      ALLOWED_CHAT_STORAGE_FILE: path.join(chatRoot, 'chat-settings-storage.ts'),
      repoRoot: tempRoot,
    };

    const report = await collectViolationsWithOverrides();
    const joined = report.violations.join('\n');
    if (
      !joined.includes('desktop-owned agent chat orchestration file')
      || !joined.includes('desktop agent chat executeScenario path')
      || !joined.includes('desktop agent chat output media execution path')
      || !joined.includes('desktop-owned agent chat behavior resolver file')
    ) {
      throw new Error('self-test failed: expected violations were not detected');
    }
    if (joined.includes('chat-agent-voice-transcribe-runtime.ts')) {
      throw new Error('self-test failed: explicit voice input transcription was incorrectly rejected');
    }
    process.stdout.write('check-desktop-chat-authority-anti-patterns self-test passed\n');
  } finally {
    delete globalThis.__NIMI_CHAT_AUTHORITY_TEST_ROOTS__;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function getRoots() {
  const override = globalThis.__NIMI_CHAT_AUTHORITY_TEST_ROOTS__;
  if (override) {
    return override;
  }
  return {
    CHAT_ROOT,
    PROVIDERS_ROOT,
    ALLOWED_CHAT_STORAGE_FILE,
    repoRoot,
  };
}

async function collectViolationsWithOverrides() {
  const roots = getRoots();
  const files = [
    ...await collectSourceFiles(roots.CHAT_ROOT),
    ...await collectSourceFiles(roots.PROVIDERS_ROOT),
  ];
  const violations = [];

  for (const filePath of files) {
    const relPath = path.relative(roots.repoRoot, filePath).replaceAll(path.sep, '/');
    const source = await fs.readFile(filePath, 'utf8');
    violations.push(...collectPatternViolations(source, relPath, BANNED_IDENTIFIER_PATTERNS));
    violations.push(...collectAgentChatProjectionViolations(filePath, source, relPath, roots.CHAT_ROOT));

    if (isBuiltInChatScopeLivePathFile(filePath, roots.CHAT_ROOT)) {
      violations.push(
        ...collectPatternViolations(source, relPath, BANNED_BUILTIN_CHAT_SCOPE_PATTERNS),
      );
    }

    if (filePath.startsWith(roots.CHAT_ROOT) && filePath !== roots.ALLOWED_CHAT_STORAGE_FILE) {
      const storageRegex = /\b(?:localStorage|getItem\s*\(|setItem\s*\()/gu;
      storageRegex.lastIndex = 0;
      let match = storageRegex.exec(source);
      while (match) {
        const { line, column } = getLineColumn(source, match.index);
        violations.push(`${relPath}:${line}:${column} chat feature must not own storage persistence directly`);
        match = storageRegex.exec(source);
      }
    }

    if (filePath === roots.ALLOWED_CHAT_STORAGE_FILE) {
      violations.push(...collectPatternViolations(source, relPath, BANNED_CHAT_STORAGE_PATTERNS));
    }
  }

  return { files, violations };
}

async function main() {
  if (process.argv.includes('--self-test')) {
    await runSelfTest();
    return;
  }

  const report = await collectViolations();
  if (report.files.length === 0) {
    process.stderr.write('desktop chat authority anti-pattern check failed: no source files found\n');
    process.exitCode = 1;
    return;
  }
  if (report.violations.length > 0) {
    process.stderr.write('desktop chat authority anti-pattern check failed\n');
    process.stderr.write('chat must project runtime authority and must not introduce chat-owned route truth or persistence\n');
    for (const violation of report.violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`desktop chat authority anti-pattern check passed (${report.files.length} files scanned)\n`);
}

main().catch((error) => {
  process.stderr.write(`check-desktop-chat-authority-anti-patterns failed: ${String(error)}\n`);
  process.exitCode = 1;
});
