/**
 * Seeded synthetic INPUT generator for experiment planning, not a performance
 * benchmark. No browser, navigation, paint, collector, or ad platform is measured.
 * Run: bun run docs/experiment/run_experiment.ts --seed=42 --trials=1000
 */

export type Scenario =
  | 'desktop_click' | 'mobile_touch' | 'drag_away'
  | 'form_fail' | 'form_success' | 'middle_click' | 'modifier_click';

export interface TrialInput {
  scenario: Scenario;
  holdMs: number;
}

const DISTRIBUTION: ReadonlyArray<readonly [Scenario, number]> = [
  ['desktop_click', 0.60],
  ['mobile_touch', 0.16],
  ['drag_away', 0.09],
  ['form_fail', 0.05],
  ['form_success', 0.05],
  ['middle_click', 0.025],
  ['modifier_click', 0.025],
];

export function generateTrials(numTrials = 1000, seed = 42): TrialInput[] {
  if (!Number.isSafeInteger(numTrials) || numTrials < 1 || numTrials > 1_000_000 ||
      !Number.isSafeInteger(seed)) {
    throw new Error('trials must be 1..1000000 and seed must be an integer');
  }
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const trials: TrialInput[] = [];
  for (let i = 0; i < numTrials; i++) {
    const draw = random();
    let cumulative = 0;
    let scenario: Scenario = 'modifier_click';
    for (const [name, weight] of DISTRIBUTION) {
      cumulative += weight;
      if (draw < cumulative) { scenario = name; break; }
    }
    // Synthetic hold duration only; NOT measured or latency recovered.
    const holdMs = 85 + Math.floor(random() * 45);
    trials.push({ scenario, holdMs });
  }
  return trials;
}

export function summarizeTrials(trials: readonly TrialInput[]) {
  const counts = Object.fromEntries(DISTRIBUTION.map(([name]) => [name, 0])) as Record<Scenario, number>;
  let desktopHoldTotalMs = 0;
  for (const trial of trials) {
    counts[trial.scenario]++;
    if (trial.scenario === 'desktop_click') desktopHoldTotalMs += trial.holdMs;
  }
  const eligibleDesktopClicks = counts.desktop_click;
  return {
    counts,
    total: trials.length,
    eligibleDesktopClicks,
    modeledMeanDesktopHoldMs: eligibleDesktopClicks ? desktopHoldTotalMs / eligibleDesktopClicks : null,
  };
}

function printSample(numTrials: number, seed: number) {
  const sample = summarizeTrials(generateTrials(numTrials, seed));
  console.log(`FastLink — Modeled input scenarios (not a performance benchmark)`);
  console.log(`Seed: ${seed} | Trials: ${sample.total}`);
  for (const [scenario, count] of Object.entries(sample.counts)) {
    console.log(`${scenario}: ${count}/${sample.total} total synthetic journeys (${(100 * count / sample.total).toFixed(1)}%)`);
  }
  console.log(`Modeled mouse hold interval: ${sample.modeledMeanDesktopHoldMs?.toFixed(1) ?? 'N/A'} ms across ${sample.eligibleDesktopClicks} eligible desktop clicks`);
  console.log('No real navigation, rendering, or ad-platform outcomes were measured.');
  console.log('Use Playwright/browser telemetry and verified collectors for empirical claims.');
}

if (import.meta.main) {
  const readFlag = (name: string, fallback: number) => {
    const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
    return raw ? Number(raw.slice(name.length + 3)) : fallback;
  };
  printSample(readFlag('trials', 1000), readFlag('seed', 42));
}
