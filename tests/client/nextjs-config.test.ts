import { describe, expect, it } from 'bun:test';
import { mergeFastLinkProviderConfig } from '../../examples/nextjs-react/fastlink-config';

describe('Next.js provider partial configuration', () => {
  it('preserves navigation defaults when only one nested setting is overridden', () => {
    const merged = mergeFastLinkProviderConfig({ navigation: { prefetch: 'none' } });
    expect(merged.mode).toBe('safe');
    expect(merged.navigation?.prefetch).toBe('none');
    expect(merged.navigation?.preserveNativeClicks).toBe(true);
    expect(merged.navigation?.exclude).toContain('/api/*');
  });

  it('keeps consent evaluator when a collector is customized', () => {
    const merged = mergeFastLinkProviderConfig({ signals: { collector: '/custom/events' } });
    expect(merged.signals?.collector).toBe('/custom/events');
    expect(merged.signals?.consent).toBeTypeOf('function');
    expect(merged.signals?.consent?.()).toBe(false);
  });

  it('does not silently register a first-party collector when none was configured', () => {
    expect(mergeFastLinkProviderConfig({}).signals?.collector).toBeUndefined();
  });

  it('honors explicit mode, consent, provider, and route overrides', () => {
    const consent = () => true;
    const merged = mergeFastLinkProviderConfig({
      mode: 'observe',
      signals: { consent, providers: { meta: false } },
      navigation: { exclude: ['/private/*'] },
    });
    expect(merged.mode).toBe('observe');
    expect(merged.signals?.consent).toBe(consent);
    expect(merged.signals?.providers?.meta).toBe(false);
    expect(merged.navigation?.exclude).toEqual(['/private/*']);
    expect(merged.navigation?.preserveNativeClicks).toBe(true);
  });
});
