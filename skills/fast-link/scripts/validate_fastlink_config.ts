/**
 * FastLink Configuration Validator
 * Validates fastlink.config.json files against schema invariants.
 */

import fs from 'node:fs';
import path from 'node:path';

interface RoutePolicy {
  pattern: string;
  isPrefix?: boolean;
  priority?: number;
  decision: {
    kind: 'router' | 'document' | 'disabled';
    method?: 'assign' | 'replace';
    scroll?: boolean;
  };
}

interface FastLinkConfig {
  version?: string;
  mode: 'reverse_proxy' | 'script_injection' | 'spa_router_hook';
  proxy?: {
    upstreamOrigin?: string;
    autoInjectClient?: boolean;
    scriptSrc?: string;
    listenPort?: number;
  };
  prefetch: {
    enabled: boolean;
    endpoint: string;
    concurrencyLimit?: number;
    ignoredPatterns?: string[];
  };
  gestureSafety: {
    rejectTouch: boolean;
    preserveModifiers: boolean;
    preserveKeyboard: boolean;
    suppressDuplicateClick: boolean;
  };
  routePolicies?: RoutePolicy[];
  telemetry?: {
    enabled: boolean;
    endpoint: string;
    sampleRate?: number;
    recordHoldDuration?: boolean;
    recordAborts?: boolean;
  };
}

export function validateConfig(configPath: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!fs.existsSync(configPath)) {
    return { valid: false, errors: [`Config file not found: ${configPath}`] };
  }

  let raw: any;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err: any) {
    return { valid: false, errors: [`Invalid JSON in config file: ${err.message}`] };
  }

  const validModes = ['reverse_proxy', 'script_injection', 'spa_router_hook'];
  if (!validModes.includes(raw.mode)) {
    errors.push(`Invalid 'mode': must be one of ${validModes.join(', ')}. Got: ${raw.mode}`);
  }

  // Reverse proxy requires upstreamOrigin
  if (raw.mode === 'reverse_proxy') {
    if (!raw.proxy?.upstreamOrigin) {
      errors.push(`'proxy.upstreamOrigin' is required when mode is 'reverse_proxy'`);
    } else {
      try {
        new URL(raw.proxy.upstreamOrigin);
      } catch {
        errors.push(`'proxy.upstreamOrigin' must be a valid URL. Got: ${raw.proxy.upstreamOrigin}`);
      }
    }
  }

  // Gesture safety invariants MUST all be true
  const gs = raw.gestureSafety;
  if (!gs) {
    errors.push(`'gestureSafety' section is missing`);
  } else {
    if (gs.rejectTouch !== true) {
      errors.push(`'gestureSafety.rejectTouch' must be true (touch scrolling preservation invariant)`);
    }
    if (gs.preserveModifiers !== true) {
      errors.push(`'gestureSafety.preserveModifiers' must be true (new tab / modifier key invariant)`);
    }
    if (gs.preserveKeyboard !== true) {
      errors.push(`'gestureSafety.preserveKeyboard' must be true (accessibility / Enter key invariant)`);
    }
    if (gs.suppressDuplicateClick !== true) {
      errors.push(`'gestureSafety.suppressDuplicateClick' must be true (double navigation prevention invariant)`);
    }
  }

  // Prefetch validation
  if (!raw.prefetch || typeof raw.prefetch.enabled !== 'boolean') {
    errors.push(`'prefetch.enabled' boolean is required`);
  }
  if (raw.prefetch?.enabled && !raw.prefetch.endpoint) {
    errors.push(`'prefetch.endpoint' is required when prefetch is enabled`);
  }

  // Route policy validation
  if (Array.isArray(raw.routePolicies)) {
    for (let i = 0; i < raw.routePolicies.length; i++) {
      const p = raw.routePolicies[i];
      if (!p.pattern) {
        errors.push(`routePolicies[${i}] is missing 'pattern'`);
      }
      if (!p.decision || !['router', 'document', 'disabled'].includes(p.decision.kind)) {
        errors.push(`routePolicies[${i}].decision.kind must be 'router', 'document', or 'disabled'`);
      }
      if (p.decision?.kind === 'document' && p.decision.method && !['assign', 'replace'].includes(p.decision.method)) {
        errors.push(`routePolicies[${i}].decision.method must be 'assign' or 'replace'`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

if (import.meta.main) {
  const target = process.argv[2] || path.join(import.meta.dir, '../assets/fastlink.config.json');
  console.log(`[FastLink Validator] Validating: ${target}`);
  const result = validateConfig(target);
  if (result.valid) {
    console.log('✓ Configuration is VALID and strictly adheres to FastLink invariants.');
    process.exit(0);
  } else {
    console.error('✗ Configuration FAILED validation:');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
}
