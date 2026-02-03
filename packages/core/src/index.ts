#!/usr/bin/env node

import 'dotenv/config';
import { createCLI } from './cli.js';

const program = createCLI();
program.parse(process.argv);
