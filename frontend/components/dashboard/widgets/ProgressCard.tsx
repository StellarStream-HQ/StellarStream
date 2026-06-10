import { Card } from '@/components/ui/Card';

interface ProgressCardProps {
  title: string;
  description?: string;
  progress: number;
  color?: 'cyan' | 'emerald' | 'violet';
  showLabel?: boolean;
}

/**
 * Progress Card Component
 *
 * Displays progress towards a goal or milestone.
 * Used for onboarding, task completion, and process tracking.
 */
export default function ProgressCard({
  title,
  description,
  progress,
  color = 'cyan',
  showLabel = true,
}: ProgressCardProps) {
  const colorClasses = {
    cyan: {
      bar: 'bg-cyan-500',
      text: 'text-cyan-400',
    },
    emerald: {
      bar: 'bg-emerald-500',
      text: 'text-emerald-400',
    },
    violet: {
      bar: 'bg-violet-500',
      text: 'text-violet-400',
    },
  };

  const colorConfig = colorClasses[color];
  const clampedProgress = Math.min(Math.max(progress, 0), 100);

  return (
    <Card className="glass-card p-6">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{title}</h3>
          {showLabel && (
            <span className={`text-sm font-medium ${colorConfig.text}`}>
              {clampedProgress}%
            </span>
          )}
        </div>

        {/* Description */}
        {description && (
          <p className="text-sm text-white/60">{description}</p>
        )}

        {/* Progress Bar */}
        <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
          <div
            className={`h-full ${colorConfig.bar} transition-all duration-500 ease-out`}
            style={{ width: `${clampedProgress}%` }}
          />
        </div>
      </div>
    </Card>
  );
}
