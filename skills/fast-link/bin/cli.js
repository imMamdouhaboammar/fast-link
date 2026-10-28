#!/usr/bin/env node
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const cmd = process.argv[2] || 'help';

switch (cmd) {
  case 'validate': {
    const configPath = process.argv[3] || path.join(rootDir, 'assets/fastlink.config.json');
    execSync(`bun ${path.join(rootDir, 'scripts/validate_fastlink_config.ts')} ${configPath}`, { stdio: 'inherit' });
    break;
  }
  case 'verify': {
    execSync(`bun ${path.join(rootDir, 'scripts/verify_gesture_invariants.ts')}`, { stdio: 'inherit' });
    break;
  }
  case 'eval': {
    execSync(`bun ${path.join(rootDir, 'scripts/run_evals.ts')}`, { stdio: 'inherit' });
    break;
  }
  case 'demo': {
    execSync(`bun ${path.join(rootDir, 'scripts/prove_baseline_failure.ts')}`, { stdio: 'inherit' });
    break;
  }
  default:
    console.log(`fast-link - Early Pointerdown Navigation & Prefetching Agent Skill

Commands:
  validate [path]   Validate fastlink.config.json against schema
  verify            Run 18-point gesture and accessibility invariant suite
  eval              Run eval-harness capability and regression suite
  demo              Run baseline failure demonstration
`);
}
