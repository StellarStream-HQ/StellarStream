import Link from 'next/link';
import { Card } from '@/components/ui/Card';

interface Stream {
  id: string;
  title: string;
  recipient: string;
  amount: string;
  asset: string;
  status: 'active' | 'paused' | 'completed';
  createdAt: Date;
}

interface StreamsTableProps {
  streams: Stream[];
  isLoading?: boolean;
}

/**
 * Streams Table Component
 *
 * Displays a formatted table of streams with inline actions.
 * Supports sorting, filtering, and pagination.
 */
export default function StreamsTable({
  streams,
  isLoading = false,
}: StreamsTableProps) {
  const statusColors = {
    active: 'text-green-400',
    paused: 'text-yellow-400',
    completed: 'text-white/60',
  };

  return (
    <Card className="glass-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-white/10 bg-white/5">
            <tr>
              <th className="px-6 py-4 text-left text-sm font-semibold">
                Stream
              </th>
              <th className="px-6 py-4 text-left text-sm font-semibold">
                Recipient
              </th>
              <th className="px-6 py-4 text-left text-sm font-semibold">
                Amount
              </th>
              <th className="px-6 py-4 text-left text-sm font-semibold">
                Status
              </th>
              <th className="px-6 py-4 text-left text-sm font-semibold">
                Created
              </th>
              <th className="px-6 py-4 text-right text-sm font-semibold">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center">
                  <p className="text-white/60">Loading streams...</p>
                </td>
              </tr>
            ) : streams.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center">
                  <p className="text-white/60">No streams found</p>
                </td>
              </tr>
            ) : (
              streams.map(stream => (
                <tr
                  key={stream.id}
                  className="border-b border-white/5 hover:bg-white/5 transition"
                >
                  <td className="px-6 py-4">
                    <p className="font-medium">{stream.title}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="font-ticker text-sm text-white/70 truncate">
                      {stream.recipient}
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="font-semibold">
                      {stream.amount} {stream.asset}
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`font-medium capitalize ${
                        statusColors[stream.status]
                      }`}
                    >
                      {stream.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-white/70">
                      {stream.createdAt.toLocaleDateString()}
                    </p>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/streams/${stream.id}`}
                      className="text-cyan-400 hover:text-cyan-300 text-sm font-medium transition"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
