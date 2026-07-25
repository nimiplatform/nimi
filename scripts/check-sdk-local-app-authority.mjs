#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import {
  sdkLocalAppAuthorityInputs,
  validateSdkLocalAppAuthority,
} from './lib/sdk-local-app-authority-check.mjs';

const cwd = process.cwd();
const readText = (rel) => fs.readFileSync(path.join(cwd, rel), 'utf8');
const readYaml = (rel) => YAML.parse(readText(rel));

const errors = validateSdkLocalAppAuthority({
  appClient: readText(sdkLocalAppAuthorityInputs.appClient),
  runtime: readText(sdkLocalAppAuthorityInputs.runtime),
  transport: readText(sdkLocalAppAuthorityInputs.transport),
  methodGroups: readYaml(sdkLocalAppAuthorityInputs.methodGroups),
});

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`ERROR: ${error}\n`);
  process.exit(1);
}

process.stdout.write('sdk-local-app-authority: OK\n');

