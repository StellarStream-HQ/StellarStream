'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

/**
 * Onboarding Page
 *
 * Welcome and orientation flow for new users.
 * Introduces key concepts and features of StellarStream.
 */
export default function OnboardingPage() {
  const [step, setStep] = useState(1);

  const steps = [
    {
      title: 'Welcome to StellarStream',
      description:
        'Real-time, second-by-second payments on Stellar. Money as a Stream.',
      icon: '🌊',
    },
    {
      title: 'How Streams Work',
      description:
        'Create continuous payment flows that execute with block-by-block precision. Recipients get paid second-by-second.',
      icon: '⚡',
    },
    {
      title: 'Your First Stream',
      description:
        'Set up a stream by specifying a recipient, amount, asset, and duration. Everything is non-custodial and transparent.',
      icon: '🚀',
    },
    {
      title: 'Ready to Stream',
      description:
        'You are all set. Head to your dashboard to create your first stream and experience the power of continuous payments.',
      icon: '✨',
    },
  ];

  const current = steps[step - 1];

  return (
    <div className="min-h-screen w-full bg-black">
      {/* Navigation */}
      <nav className="px-4 py-6 flex items-center justify-between border-b border-white/10">
        <h1 className="font-heading text-2xl font-bold">StellarStream</h1>
        <Link
          href="/dashboard"
          className="text-sm text-white/60 hover:text-white transition"
        >
          Skip
        </Link>
      </nav>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-12 md:py-20 flex flex-col items-center justify-center min-h-[calc(100vh-80px)]">
        <div className="text-center space-y-12">
          {/* Step Icon */}
          <div className="text-8xl">{current.icon}</div>

          {/* Step Title */}
          <div className="space-y-4">
            <h2 className="font-heading text-4xl font-bold">{current.title}</h2>
            <p className="text-xl text-white/60 max-w-xl mx-auto">
              {current.description}
            </p>
          </div>

          {/* Step Content - Custom per step */}
          {step === 2 && (
            <Card className="glass-card p-8 text-left max-w-lg">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">Key Features:</h3>
                  <ul className="space-y-2 text-white/70 text-sm">
                    <li>✓ Non-custodial payments</li>
                    <li>✓ Second-by-second execution</li>
                    <li>✓ Transparent on-chain settlement</li>
                    <li>✓ Flexible duration options</li>
                  </ul>
                </div>
              </div>
            </Card>
          )}

          {step === 3 && (
            <Card className="glass-card p-8 text-left max-w-lg">
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-4">Stream Setup:</h3>
                  <ol className="space-y-3 text-white/70 text-sm">
                    <li>1. Connect your Stellar wallet</li>
                    <li>2. Choose an asset (USDC, XLM, etc.)</li>
                    <li>3. Enter recipient address</li>
                    <li>4. Set amount and duration</li>
                    <li>5. Confirm and execute</li>
                  </ol>
                </div>
              </div>
            </Card>
          )}

          {/* Progress */}
          <div className="flex justify-center gap-2">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`h-2 rounded-full transition ${
                  i < step ? 'bg-cyan-500 w-8' : 'bg-white/20 w-2'
                }`}
              />
            ))}
          </div>

          {/* Navigation Buttons */}
          <div className="flex gap-4 justify-center pt-4">
            <Button
              onClick={() => setStep(Math.max(1, step - 1))}
              disabled={step === 1}
              variant="outline"
              className="border-white/20 disabled:opacity-50"
            >
              Back
            </Button>
            {step < steps.length ? (
              <Button
                onClick={() => setStep(step + 1)}
                className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
              >
                Next
              </Button>
            ) : (
              <Link href="/dashboard">
                <Button className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold">
                  Go to Dashboard
                </Button>
              </Link>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
