import type { FastLinkConfig } from '../../client/src/types';

export function mergeFastLinkProviderConfig(config: FastLinkConfig = {}): FastLinkConfig {
  return {
    mode: config.mode ?? 'safe',
    navigation: {
      prefetch: 'same-origin',
      preserveNativeClicks: true,
      exclude: ['/api/*', '/auth/*', '/logout', '/admin/*'],
      ...config.navigation,
    },
    signals: {
      consent: () => {
        try {
          return typeof window !== 'undefined' && localStorage.getItem('marketing_consent') === 'true';
        } catch {
          return false;
        }
      },
      ...config.signals,
    },
    debug: config.debug,
  };
}
