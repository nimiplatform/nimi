#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeOrCheckCompiledProfiles } from './lib/first-party-protected-runtime-profile-compiler.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const model = writeOrCheckCompiledProfiles({ repoRoot, checkOnly });
const counts = model.profiles
  .map((profile) => `${profile.profileId}=${profile.methods.length}`)
  .join(', ');
process.stdout.write(`${checkOnly ? 'checked' : 'generated'} first-party protected Runtime profiles (${counts})\n`);
