import { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
}

/**
 * Stats Card Component
 *
 * Displays a key metric or statistic in a compact card format.
 * Used for dashboard overview and quick metrics display.
 */
export default function StatsCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  trendValue,
}: StatsCardProps) {
  return (
    <Card className="glass-card p-6">
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="text-white/60 text-sm font-medium">{title}</p>
          {icon && <div className="text-2xl">{icon}</div>}
        </div>

        {/* Value */}
        <p className="text-3xl font-bold">{value}</p>

        {/* Trend or Subtitle */}
        {trend && trendValue ? (
          <p
            className={`text-xs font-medium ${
              trend === 'up'
                ? 'text-green-400'
                : trend === 'down'
                  ? 'text-red-400'
                  : 'text-white/60'
            }`}
          >
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'} {trendValue}
          </p>
        ) : (
          subtitle && <p className="text-xs text-white/50">{subtitle}</p>
        )}
      </div>
    </Card>
  );
}
