import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertProjectOutputPath, changedFiles, plannedFile } from './app-project-files.mjs';

export const LIFECYCLE_SKILL_PATH = fileURLToPath(new URL('../skills/nimi-app-lifecycle/SKILL.md', import.meta.url));
export const PROJECT_SKILL_DIR = '.agents/skills/nimi-app-lifecycle';
const SKILL_FILES = ['SKILL.md', ...['audit', 'create', 'adapt', 'platform-gaps', 'upgrade-platform', 'sync-upstream', 'release', 'acceptance'].map((name) => `references/${name}.md`)];
const START = '<!-- nimi-app:managed:start -->';
const END = '<!-- nimi-app:managed:end -->';
const AGENTS_BLOCK = `${START}
## Nimi App development

- For auditing adaptation feasibility or cost, creating, adapting, upgrading or releasing this App, read [the lifecycle skill](.agents/skills/nimi-app-lifecycle/SKILL.md) and only the relevant scenario. Audit-only requests do not begin implementation; prior reports remain evidence-dependent.
- For first integration or foundation wiring changes, use the selected app-tools package's generated reference and reuse its Host, preload, renderer, session, App Access, AIConfig and AI call wiring. Follow the adaptation guide's baseline checks and reuse passing results for ordinary business edits.
- Keep App-owned product behavior, Host code, business accounts and non-AI services with this repository. Use the SDK/Kit Local App carrier for Nimi AI, configuration, storage and session access.
- Development may consume complete local npm tarballs through the supported explicit overrides and version matrix; public-release preflight uses registry resolutions. Do not substitute source-workspace or directory links.
- App Tools owns its lifecycle skill, this block, managed workflow and declared engineering fields; preserve other instructions, product source and licenses. Existing adoption does not create fresh scaffold intent or lock.
- Product-operation guides apply to their specific business tasks; they do not replace the Nimi development boundary.
- Reuse the user's confirmed scope and authorization. Report command checks separately from actual App journeys; unrun relevant paths remain NOT-VERIFIED.
${END}`;

function readAgentsBlock(source) {
  const starts = source.split(START).length - 1;
  const ends = source.split(END).length - 1;
  if (!starts && !ends) return null;
  if (starts !== 1 || ends !== 1 || source.indexOf(END) < source.indexOf(START)) {
    throw new Error('AGENTS.md contains duplicate or unbalanced nimi-app managed markers');
  }
  return { start: source.indexOf(START), end: source.indexOf(END) + END.length };
}

export function hasLifecycleGuidanceOwner(targetDir) {
  const agentsPath = path.join(targetDir, 'AGENTS.md');
  assertProjectOutputPath(targetDir, agentsPath);
  return existsSync(agentsPath) && readAgentsBlock(readFileSync(agentsPath, 'utf8')) !== null;
}

export function lifecycleSkillFiles() {
  const sourceRoot = path.dirname(LIFECYCLE_SKILL_PATH);
  return SKILL_FILES.map((name) => ({
    path: `${PROJECT_SKILL_DIR}/${name}`,
    content: readFileSync(path.join(sourceRoot, name), 'utf8'),
    mutationClass: 'scaffold-managed glue',
    ownerKind: 'lifecycle-guidance',
    ownerId: 'nimi-app-lifecycle',
  }));
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-018d
export function planLifecycleGuidance(targetDir) {
  const agentsPath = path.join(targetDir, 'AGENTS.md');
  assertProjectOutputPath(targetDir, agentsPath);
  assertProjectOutputPath(targetDir, path.join(targetDir, PROJECT_SKILL_DIR, 'SKILL.md'));
  if (existsSync(agentsPath) && !lstatSync(agentsPath).isFile()) throw new Error('AGENTS.md must be a regular file');
  const previous = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : '';
  const block = readAgentsBlock(previous);
  const content = block
    ? previous.slice(0, block.start) + AGENTS_BLOCK + previous.slice(block.end)
    : `${previous}${previous && !previous.endsWith('\n') ? '\n' : ''}${previous ? '\n' : ''}${AGENTS_BLOCK}\n`;
  const planned = [plannedFile(targetDir, 'AGENTS.md', content)];
  const expected = new Map(lifecycleSkillFiles().map((file) => [file.path, file]));
  const root = path.join(targetDir, PROJECT_SKILL_DIR);
  const visit = (directory) => {
    if (!lstatSync(directory).isDirectory()) throw new Error(`Lifecycle skill directory collision: ${directory}`);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else if (!entry.isFile()) throw new Error(`Lifecycle skill file collision: ${filePath}`);
      else {
        const relativePath = path.relative(targetDir, filePath).split(path.sep).join('/');
        const file = expected.get(relativePath);
        if (!block && (!file || readFileSync(filePath, 'utf8') !== file.content)) {
          throw new Error(`Unknown lifecycle skill content: ${relativePath}. Preserve or relocate it before adoption.`);
        }
        if (!file) planned.push(plannedFile(targetDir, relativePath, null));
      }
    }
  };
  if (existsSync(root)) visit(root);
  for (const file of expected.values()) planned.push(plannedFile(targetDir, file.path, file.content));
  return planned;
}

export function assertLifecycleGuidanceCurrent(targetDir) {
  const drift = changedFiles(planLifecycleGuidance(targetDir));
  if (drift.length) throw new Error(`Lifecycle guidance drift: ${drift.map((file) => path.relative(targetDir, file.path)).join(', ')}. Run nimi-app sync.`);
}

export function lifecycleOwnerSteps(versions) {
  return [{ owner: '@nimiplatform/nimi-coding', version: versions.nimicodingVersion, command: 'nimicoding sync --apply --json', executor: 'project-local package bin.nimicoding via the current Node.js executable', previewed: false }];
}
