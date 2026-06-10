'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';

/**
 * Email Confirmation Page
 *
 * Handles email verification during signup flow.
 * User enters 6-digit code sent to their email.
 */
export default function ConfirmEmailPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isResending, setIsResending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      // TODO: Implement verification logic
      await new Promise(resolve => setTimeout(resolve, 500));
      router.push('/onboarding');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    setIsResending(true);
    try {
      // TODO: Implement resend logic
      await new Promise(resolve => setTimeout(resolve, 500));
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <h1 className="font-heading text-3xl font-bold">Verify Email</h1>
        <p className="text-white/60">
          We sent a verification code to your email
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="glass-card p-4 border-red-500/30 bg-red-500/10">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Verification Form */}
      <Card className="glass-card">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="code" className="block text-sm font-medium">
              Verification Code
            </label>
            <Input
              id="code"
              type="text"
              placeholder="000000"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="text-center font-mono text-2xl tracking-widest"
              required
            />
            <p className="text-xs text-white/50">
              Enter the 6-digit code from your email
            </p>
          </div>

          <Button
            type="submit"
            disabled={isLoading || code.length !== 6}
            className="w-full bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
          >
            {isLoading ? 'Verifying...' : 'Verify'}
          </Button>
        </form>
      </Card>

      {/* Resend Link */}
      <div className="text-center">
        <button
          onClick={handleResend}
          disabled={isResending}
          className="text-sm text-cyan-400 hover:text-cyan-300 transition disabled:opacity-50"
        >
          {isResending ? 'Sending...' : 'Resend code'}
        </button>
      </div>
    </div>
  );
}
