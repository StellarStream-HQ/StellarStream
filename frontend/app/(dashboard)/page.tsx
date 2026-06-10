'use client';

import { Suspense } from 'react';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';

/**
 * Dashboard Home Page
 *
 * Main dashboard landing page showing overview, recent streams,
 * and key metrics. Primary entry point for logged-in users.
 */
function DashboardContent() {
  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="space-y-2">
        <h1 className="font-heading text-4xl font-bold">Dashboard</h1>
        <p className="text-white/60">
          Welcome back. Here's your streaming summary.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total Streams */}
        <Card className="glass-card p-6">
          <div className="space-y-2">
            <p className="text-white/60 text-sm">Total Streams</p>
            <p className="text-3xl font-bold">0</p>
            <p className="text-xs text-cyan-400">0 active</p>
          </div>
        </Card>

        {/* Monthly Volume */}
        <Card className="glass-card p-6">
          <div className="space-y-2">
            <p className="text-white/60 text-sm">Monthly Volume</p>
            <p className="text-3xl font-bold">$0.00</p>
            <p className="text-xs text-green-400">0% vs last month</p>
          </div>
        </Card>

        {/* Next Disbursement */}
        <Card className="glass-card p-6">
          <div className="space-y-2">
            <p className="text-white/60 text-sm">Next Disbursement</p>
            <p className="text-3xl font-bold">--</p>
            <p className="text-xs text-white/40">No upcoming disbursements</p>
          </div>
        </Card>

        {/* Account Balance */}
        <Card className="glass-card p-6">
          <div className="space-y-2">
            <p className="text-white/60 text-sm">Account Balance</p>
            <p className="text-3xl font-bold">$0.00</p>
            <p className="text-xs text-white/40">Across all assets</p>
          </div>
        </Card>
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Streams */}
        <Card className="glass-card p-6 lg:col-span-2">
          <div className="space-y-4">
            <h2 className="font-heading text-xl font-bold">Recent Streams</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-3 border-b border-white/10">
                <div>
                  <p className="font-medium">No streams yet</p>
                  <p className="text-sm text-white/60">
                    Create your first stream to get started
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Quick Actions */}
        <Card className="glass-card p-6">
          <div className="space-y-4">
            <h2 className="font-heading text-xl font-bold">Quick Actions</h2>
            <div className="space-y-2">
              <a
                href="/create-stream"
                className="block px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-black font-medium text-center transition"
              >
                Create Stream
              </a>
              <a
                href="/streams"
                className="block px-4 py-2 rounded-lg border border-white/20 hover:bg-white/5 text-white font-medium text-center transition"
              >
                View Streams
              </a>
              <a
                href="/settings"
                className="block px-4 py-2 rounded-lg border border-white/20 hover:bg-white/5 text-white font-medium text-center transition"
              >
                Settings
              </a>
            </div>
          </div>
        </Card>
      </div>

      {/* Onboarding Prompt */}
      <Card className="glass-card p-6 border-cyan-500/30 bg-cyan-500/5">
        <div className="space-y-4">
          <h2 className="font-heading text-xl font-bold">Get Started</h2>
          <p className="text-white/70 text-sm">
            StellarStream enables real-time, second-by-second payments on Stellar.
            Create your first stream to experience the power of continuous asset flow.
          </p>
          <a
            href="/onboarding"
            className="inline-block px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-black font-medium transition"
          >
            Start Onboarding
          </a>
        </div>
      </Card>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen">
          <Spinner />
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
