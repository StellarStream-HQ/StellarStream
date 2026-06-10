'use client';

import { Card } from '@/components/ui/Card';

/**
 * Stream Chart Component
 *
 * Visualizes stream flow and disbursement patterns.
 * Shows real-time and historical data.
 */
export default function StreamChart() {
  return (
    <Card className="glass-card p-6">
      <div className="space-y-4">
        <h3 className="font-heading text-lg font-bold">Stream Flow</h3>
        <div className="h-48 flex items-center justify-center border border-white/10 rounded-lg">
          <p className="text-white/60 text-center">
            Chart visualization
            <br />
            <span className="text-sm">No data available</span>
          </p>
        </div>
      </div>
    </Card>
  );
}
