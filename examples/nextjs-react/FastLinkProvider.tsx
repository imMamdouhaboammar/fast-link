'use client';

import React, { createContext, useContext, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import FastLink, { FastLinkConfig, FastLinkIntent } from '../../client/src/index';
import { mergeFastLinkProviderConfig } from './fastlink-config';

interface FastLinkContextValue {
  recordEvent: (name: string, props?: Record<string, any>, options?: any) => string;
  recordVerifiedLead: (props?: Record<string, any>, eventId?: string) => string;
  recordVerifiedPurchase: (props?: any, eventId?: string) => string;
}

const FastLinkContext = createContext<FastLinkContextValue | null>(null);

export interface FastLinkProviderProps {
  config?: FastLinkConfig;
  children: React.ReactNode;
}

export function FastLinkProvider({ config, children }: FastLinkProviderProps) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    // Mount custom router hook for Next.js App Router transitions
    if (typeof window !== 'undefined') {
      (window as any).__FAST_LINK_NAVIGATE__ = (intent: FastLinkIntent) => {
        const target = intent.url.pathname + intent.url.search + intent.url.hash;
        routerRef.current.push(target);
      };
    }

    // Initialize FastLink in 'safe' mode by default
    FastLink.init(mergeFastLinkProviderConfig(config));

    return () => {
      FastLink.destroy();
      if (typeof window !== 'undefined') {
        delete (window as any).__FAST_LINK_NAVIGATE__;
      }
    };
  }, [config]);

  const value: FastLinkContextValue = {
    recordEvent: (name, props, options) => FastLink.recordEvent(name, props, options),
    recordVerifiedLead: (props, eventId) => FastLink.recordVerifiedLead(props, eventId),
    recordVerifiedPurchase: (props, eventId) => FastLink.recordVerifiedPurchase(props, eventId),
  };

  return <FastLinkContext.Provider value={value}>{children}</FastLinkContext.Provider>;
}

export function useFastLink() {
  const ctx = useContext(FastLinkContext);
  if (!ctx) {
    throw new Error('useFastLink must be used within a FastLinkProvider');
  }
  return ctx;
}
