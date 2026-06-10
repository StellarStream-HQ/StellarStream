'use client';

import { Card } from '@/components/ui/Card';

/**
 * Balance Chart Component
 *
 * Displays account balance over time.
 * Shows historical balance changes and trends.
 */
export default function BalanceChart() {
  return (
    <Card className="glass-card p-6">
      <div className="space-y-4">
        <h3 className="font-heading text-lg font-bold">Balance History</h3>
        <div className="h-48 flex items-center justify-center border border-white/10 rounded-lg">
          <p className="text-white/60 text-center">
            Balance chart
            <br />
            <span className="text-sm">No data available</span>
          </p>
        </div>
      </div>
    </Card>
  );
}
