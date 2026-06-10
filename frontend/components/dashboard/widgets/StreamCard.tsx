import Link from 'next/link';
import { Card } from '@/components/ui/Card';

interface StreamCardProps {
  id: string;
  title: string;
  recipient: string;
  amount: string;
  asset: string;
  status: 'active' | 'paused' | 'completed';
  progress?: number;
}

/**
 * Stream Card Component
 *
 * Displays a stream summary with key information and quick actions.
 * Used in stream list and dashboard views.
 */
export default function StreamCard({
  id,
  title,
  recipient,
  amount,
  asset,
  status,
  progress = 0,
}: StreamCardProps) {
  const statusColors = {
    active: 'text-green-400 bg-green-400/10',
    paused: 'text-yellow-400 bg-yellow-400/10',
    completed: 'text-white/60 bg-white/5',
  };

  return (
    <Link href={`/streams/${id}`}>
      <Card className="glass-card p-6 hover:border-cyan-500/50 transition cursor-pointer h-full">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="space-y-1 flex-1">
              <h3 className="font-semibold truncate">{title}</h3>
              <p className="text-xs text-white/60 font-ticker truncate">
                {recipient}
              </p>
            </div>
            <span
              className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${
                statusColors[status]
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </span>
          </div>

          {/* Amount */}
          <div>
            <p className="text-2xl font-bold">
              {amount} {asset}
            </p>
          </div>

          {/* Progress Bar */}
          {status !== 'completed' && (
            <div className="space-y-2">
              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-white/50">{progress}% complete</p>
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}
