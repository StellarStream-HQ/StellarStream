import { Card } from '@/components/ui/Card';

interface Activity {
  id: string;
  title: string;
  description: string;
  timestamp: Date;
  type: 'stream' | 'transaction' | 'verification';
}

interface ActivityCardProps {
  activities: Activity[];
  maxItems?: number;
}

/**
 * Activity Card Component
 *
 * Displays a list of recent account activities.
 * Shows stream updates, transactions, and other events.
 */
export default function ActivityCard({
  activities,
  maxItems = 5,
}: ActivityCardProps) {
  const displayedActivities = activities.slice(0, maxItems);

  const typeIcons = {
    stream: '🌊',
    transaction: '💰',
    verification: '✓',
  };

  return (
    <Card className="glass-card p-6">
      <div className="space-y-4">
        <h3 className="font-heading text-lg font-bold">Recent Activity</h3>

        {displayedActivities.length > 0 ? (
          <div className="space-y-3">
            {displayedActivities.map(activity => (
              <div
                key={activity.id}
                className="flex items-start gap-3 py-3 border-b border-white/5 last:border-0"
              >
                <span className="text-lg">
                  {typeIcons[activity.type]}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{activity.title}</p>
                  <p className="text-xs text-white/60">{activity.description}</p>
                  <p className="text-xs text-white/40 mt-1">
                    {activity.timestamp.toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-white/60 text-center py-6">
            No recent activity
          </p>
        )}
      </div>
    </Card>
  );
}
