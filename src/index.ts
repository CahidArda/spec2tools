#!/usr/bin/env node

import { createCLI } from './cli.js';

const program = createCLI();
program.parse(process.argv);
