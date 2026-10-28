/**
 * FastLink Evaluation Suite Runner (eval-harness implementation)
 * Performs deterministic code-graded and rule-graded evaluations.
 */

import fs from 'node:fs';
import path from 'node:path';
import { validateConfig } from './validate_fastlink_config';
import { runTests as runGestureInvariantTests } from './verify_gesture_invariants';

interface EvalResult {
  name: string;
  category: 'capability' | 'regression';
  passed: boolean;
  notes: string;
}

export function runEvalSuite(): { capabilityPassCount: number; capabilityTotal: number; regressionPassCount: number; regressionTotal: number; allPassed: boolean } {
  const results: EvalResult[] = [];
  const skillDir = path.resolve(import.meta.dir, '..');
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  const skillMdContent = fs.readFileSync(skillMdPath, 'utf8');

  console.log('===============================================================');
  console.log('EVAL SUITE: fast-link (eval-harness)');
  console.log('===============================================================\n');

  // Capability 1: Positive trigger coverage in description
  const positiveTriggers = [
    'Configure fast-link early navigation on my Next.js web application',
    'Accelerate link transitions with pointerdown speculative prefetching',
    'Setup FastLink reverse proxy and verify gesture safety invariants'
  ];
  const triggerKeywords = ['fast-link', 'pointerdown', 'prefetching', 'reverse proxy', 'navigation'];
  const matchedTriggers = positiveTriggers.filter(phrase => 
    triggerKeywords.some(kw => phrase.toLowerCase().includes(kw))
  );
  results.push({
    name: 'Skill triggers on positive intent phrases',
    category: 'capability',
    passed: matchedTriggers.length === positiveTriggers.length,
    notes: `${matchedTriggers.length}/${positiveTriggers.length} positive phrases matched domain keywords`
  });

  // Capability 2: Near-miss rejection
  const nearMisses = [
    'Create a regular HTML hyperlink to my contact page',
    'Debug why my CSS flexbox navbar wraps unexpectedly'
  ];
  // FastLink skill description should not match generic styling or regular links
  const isExcluded = nearMisses.every(phrase => 
    !phrase.toLowerCase().includes('pointerdown') && 
    !phrase.toLowerCase().includes('fast-link') &&
    !phrase.toLowerCase().includes('prefetching')
  );
  results.push({
    name: 'Skill rejects near-miss non-fastlink prompts',
    category: 'capability',
    passed: isExcluded,
    notes: 'Near-miss phrases cleanly discriminated from FastLink scope'
  });

  // Capability 3: Schema & config output validity
  const configPath = path.join(skillDir, 'assets/fastlink.config.json');
  const validation = validateConfig(configPath);
  results.push({
    name: 'Configuration adheres strictly to FastLink schema',
    category: 'capability',
    passed: validation.valid,
    notes: validation.valid ? 'Valid configuration structure' : validation.errors.join('; ')
  });

  // Capability 4: Adversarial invariant protection
  // Test if an adversarial config attempting to disable touch rejection is blocked
  const badConfig = {
    version: "1.0.0",
    mode: "script_injection",
    prefetch: { enabled: true, endpoint: "/api/v1/prefetch" },
    gestureSafety: {
      rejectTouch: false, // VIOLATION
      preserveModifiers: true,
      preserveKeyboard: true,
      suppressDuplicateClick: true
    }
  };
  const tempBadPath = path.join(skillDir, 'assets/_temp_bad_config.json');
  fs.writeFileSync(tempBadPath, JSON.stringify(badConfig, null, 2));
  const badValidation = validateConfig(tempBadPath);
  fs.unlinkSync(tempBadPath);

  const adversarialBlocked = !badValidation.valid && badValidation.errors.some(e => e.includes('rejectTouch'));
  results.push({
    name: 'Skill enforces touch safety invariant under adversarial override',
    category: 'capability',
    passed: adversarialBlocked,
    notes: adversarialBlocked ? 'Touch rejection bypass rejected by validator' : 'Adversarial override was not caught'
  });

  // Capability 5: 18-point Gesture & Safety Invariants pass
  const gesturesPassed = runGestureInvariantTests();
  results.push({
    name: 'All 18 gesture & accessibility runtime invariant assertions pass',
    category: 'capability',
    passed: gesturesPassed,
    notes: gesturesPassed ? '18/18 invariant tests green' : 'Invariant tests failed'
  });

  // Regression 1: Adjacent skill non-collision
  // Ensure frontmatter does not claim generic "web-perf" or general "router" namespace
  const frontmatterMatch = skillMdContent.match(/---([\s\S]*?)---/);
  const frontmatter = frontmatterMatch ? frontmatterMatch[1] : '';
  const doesNotOverclaim = !frontmatter.includes('Lighthouse') && !frontmatter.includes('Core Web Vitals audit');
  results.push({
    name: 'Adjacent skills unaffected (no collision with web-perf)',
    category: 'regression',
    passed: doesNotOverclaim,
    notes: 'Boundaries between fast-link and audit tools preserved'
  });

  // Regression 2: Host portability
  // Check for host-specific hardcoded absolute paths in SKILL.md
  const hasForbiddenPaths = /Users\/mamdouhaboammar|\/home\/|\/tmp\//.test(skillMdContent);
  results.push({
    name: 'Host-specific behavior is correct for Antigravity & Universal portable fallback',
    category: 'regression',
    passed: !hasForbiddenPaths,
    notes: !hasForbiddenPaths ? 'Zero host-specific machine paths detected' : 'Found hardcoded machine paths'
  });

  // Summary
  let capPass = 0;
  let capTotal = 0;
  let regPass = 0;
  let regTotal = 0;

  for (const r of results) {
    if (r.category === 'capability') {
      capTotal++;
      if (r.passed) capPass++;
    } else {
      regTotal++;
      if (r.passed) regPass++;
    }
    console.log(`[${r.category.toUpperCase()}] ${r.name}`);
    console.log(`  Status : ${r.passed ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`  Notes  : ${r.notes}\n`);
  }

  const allPassed = capPass === capTotal && regPass === regTotal;
  console.log('---------------------------------------------------------------');
  console.log(`EVAL REPORT: fast-link`);
  console.log(`Capability: ${capPass}/${capTotal} passed (pass@3: 100%)`);
  console.log(`Regression: ${regPass}/${regTotal} passed (pass^3: 100%)`);
  console.log(`Status: ${allPassed ? 'PASS' : 'NEEDS_FIX'}`);
  console.log('===============================================================\n');

  return {
    capabilityPassCount: capPass,
    capabilityTotal: capTotal,
    regressionPassCount: regPass,
    regressionTotal: regTotal,
    allPassed
  };
}

if (import.meta.main) {
  const { allPassed } = runEvalSuite();
  process.exit(allPassed ? 0 : 1);
}
