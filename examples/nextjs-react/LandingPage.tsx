'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useFastLink } from './FastLinkProvider';

export function PaidTrafficLandingPage() {
  const { recordVerifiedLead } = useFastLink();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'confirmed' | 'error'>('idle');
  const [confirmedEventId, setConfirmedEventId] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('submitting');

    try {
      // Send form data to real backend submission endpoint
      const res = await fetch('/api/submit-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      });

      if (!res.ok) {
        throw new Error('Submission rejected by server');
      }

      const data = await res.json();

      // INVARIANT: Verified Lead event is ONLY dispatched after server confirms 200 OK!
      const eventId = recordVerifiedLead({
        lead_id: data.lead_id,
        source: 'react_landing_page',
        tier: 'enterprise',
      });

      setConfirmedEventId(eventId);
      setStatus('confirmed');
    } catch (err) {
      // INVARIANT: Failed submissions do NOT trigger a verified Lead event!
      setStatus('error');
    }
  };

  return (
    <main style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Enterprise Cloud Consultation</h1>
      <p style={{ color: '#666', marginBottom: '2rem' }}>
        Next.js App Router funnel with FastLink safe prefetch and verified conversion measurement.
      </p>

      {/* Scenario A: External WhatsApp CTA */}
      <section style={{ marginBottom: '2rem', padding: '1.5rem', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
        <h2>Quick Inquiry</h2>
        <p>Direct chat with an expert advisor. Native external link with Contact event dispatch.</p>
        <a
          href="https://wa.me/15551234567"
          target="_blank"
          rel="noopener noreferrer"
          data-fl-event="Contact"
          data-fl-cta="whatsapp_advisor"
          style={{
            display: 'inline-block',
            padding: '10px 20px',
            background: '#25D366',
            color: '#fff',
            textDecoration: 'none',
            borderRadius: '6px',
            fontWeight: 600,
          }}
        >
          Chat on WhatsApp
        </a>
      </section>

      {/* Scenario B: Verified Lead Form */}
      <section style={{ marginBottom: '2rem', padding: '1.5rem', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
        <h2>Request a Proposal</h2>
        <p>Form submission attempt is recorded separately; Lead event fires only upon server verification.</p>
        <form data-fl-form="enterprise_proposal" onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.25rem' }}>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.25rem' }}>Work Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
          </div>
          <button
            type="submit"
            disabled={status === 'submitting'}
            style={{
              padding: '10px 20px',
              background: '#0284c7',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {status === 'submitting' ? 'Submitting...' : 'Submit Request'}
          </button>
        </form>

        {status === 'confirmed' && (
          <div style={{ marginTop: '1rem', color: '#16a34a', fontWeight: 'bold' }}>
            Proposal request received! Verified Lead Event ID: {confirmedEventId}
          </div>
        )}
        {status === 'error' && (
          <div style={{ marginTop: '1rem', color: '#dc2626' }}>
            Submission failed. Please check details and try again. (No lead event dispatched)
          </div>
        )}
      </section>

      {/* Scenario C: Checkout Funnel */}
      <section style={{ padding: '1.5rem', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
        <h2>Instant Activation</h2>
        <p>Prefetched on pointerdown; navigates via Next.js router on confirmed click.</p>
        <Link
          href="/checkout"
          data-fl-event="InitiateCheckout"
          data-fl-cta="instant_checkout_btn"
          style={{
            display: 'inline-block',
            padding: '10px 20px',
            background: '#0f172a',
            color: '#fff',
            textDecoration: 'none',
            borderRadius: '6px',
            fontWeight: 600,
          }}
        >
          Proceed to Checkout
        </Link>
      </section>
    </main>
  );
}
