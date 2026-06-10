'use client';

import { Card } from '@/components/ui/Card';

/**
 * History Chart Component
 *
 * Displays transaction history and patterns.
 * Shows frequency, volume, and temporal distribution.
 */
export default function HistoryChart() {
  return (
    <Card className="glass-card p-6">
      <div className="space-y-4">
        <h3 className="font-heading text-lg font-bold">Transaction History</h3>
        <div className="h-48 flex items-center justify-center border border-white/10 rounded-lg">
          <p className="text-white/60 text-center">
            History visualization
            <br />
            <span className="text-sm">No data available</span>
          </p>
        </div>
      </div>
    </Card>
  );
}
