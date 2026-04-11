#!/usr/bin/env node

import { runCli } from "../cli/nimicoding.mjs";

const exitCode = await runCli(process.argv.slice(2));
process.exit(exitCode);
