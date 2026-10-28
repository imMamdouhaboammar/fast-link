import { describe, expect, it } from 'bun:test';
import { summarizeTrials } from '../../docs/experiment/run_experiment';

const experiment = new URL('../../docs/experiment/run_experiment.ts', import.meta.url).pathname;

function run(seed: number, trials = 100): string {
  const result = Bun.spawnSync({ cmd: [process.execPath, 'run', experiment, `--seed=${seed}`, `--trials=${trials}`] });
  expect(result.exitCode).toBe(0);
  return result.stdout.toString();
}

describe('experiment integrity', () => {
  it('records a seed and reproduces the exact modeled sample', () => {
    const first = run(42);
    expect(first).toContain('Seed: 42');
    expect(run(42)).toBe(first);
    expect(run(43)).not.toBe(first);
  });

  it('reports modeled inputs with scenario-specific denominators, not observed outcomes', () => {
    const output = run(7, 1000);
    expect(output).toContain('Modeled input scenarios');
    expect(output).toContain('eligible desktop clicks');
    expect(output).not.toContain('Hold Window Recovered');
    expect(output).not.toContain('KEY SCIENTIFIC CONCLUSIONS');
    expect(output).toContain('No real navigation, rendering, or ad-platform outcomes were measured');
  });

  it('uses only eligible desktop clicks as the mean hold-time denominator', () => {
    const summary = summarizeTrials([
      { scenario: 'desktop_click', holdMs: 100 },
      { scenario: 'mobile_touch', holdMs: 200 },
      { scenario: 'desktop_click', holdMs: 120 },
      { scenario: 'drag_away', holdMs: 300 },
    ]);
    expect(summary.total).toBe(4);
    expect(summary.eligibleDesktopClicks).toBe(2);
    expect(summary.modeledMeanDesktopHoldMs).toBe(110);
    expect(summary.counts.mobile_touch).toBe(1);
    expect(summarizeTrials([{ scenario: 'mobile_touch', holdMs: 90 }]).modeledMeanDesktopHoldMs).toBeNull();
  });
});
