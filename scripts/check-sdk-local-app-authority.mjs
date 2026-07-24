#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import {
  extractSdkRationaleSection,
  sdkLocalAppAuthorityInputs,
  sdkLocalAppRationaleSections,
  validateSdkLocalAppAuthority,
} from './lib/sdk-local-app-authority-check.mjs';

const cwd = process.cwd();
const readText = (rel) => fs.readFileSync(path.join(cwd, rel), 'utf8');
const readYaml = (rel) => YAML.parse(readText(rel));

const errors = validateSdkLocalAppAuthority({
  appClient: extractSdkRationaleSection(readText(sdkLocalAppAuthorityInputs.appClient), sdkLocalAppRationaleSections.appClient),
  runtime: extractSdkRationaleSection(readText(sdkLocalAppAuthorityInputs.runtime), sdkLocalAppRationaleSections.runtime),
  transport: extractSdkRationaleSection(readText(sdkLocalAppAuthorityInputs.transport), sdkLocalAppRationaleSections.transport),
  index: readText(sdkLocalAppAuthorityInputs.index),
  methodGroups: readYaml(sdkLocalAppAuthorityInputs.methodGroups),
});

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`ERROR: ${error}\n`);
  process.exit(1);
}

process.stdout.write('sdk-local-app-authority: OK\n');

