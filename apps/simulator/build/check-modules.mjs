#!/usr/bin/env node

import { runFreshQualification } from './qualification.mjs';

const registry = runFreshQualification();
process.stdout.write(`simulator-modules: OK (${registry.moduleCount} generated modules, registry ${registry.digest})\n`);
