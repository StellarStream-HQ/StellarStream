import { Card } from '@/components/ui/Card';

interface Transaction {
  id: string;
  type: 'sent' | 'received';
  amount: string;
  asset: string;
  recipient: string;
  timestamp: Date;
  status: 'completed' | 'pending' | 'failed';
}

interface TransactionTableProps {
  transactions: Transaction[];
  isLoading?: boolean;
}

/**
 * Transaction Table Component
 *
 * Displays a formatted table of transactions.
 * Shows sent/received status, amounts, and timestamps.
 */
export default function TransactionTable({
  transactions,
  isLoading = false,
}: TransactionTableProps) {
  const statusColors = {
    completed: 'text-green-400',
    pending: 'text-yellow-400',
    failed: 'text-red-400',
  };

  const typeIcons = {
    sent: '↑',
    received: '↓',
  };

  return (
    <Card className="glass-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-white/10 bg-white/5">
            <tr>
              <th className="px-6 py-4 text-left text-sm font-semibold">
                Type
              </th>
              <th className="px-6 py-4 text-left text-sm font-semibold">
                Amount
              </th>
              <th className="px-6 py-4 text-left text-sm font-semibold">
                Recipient
              </th>
              <th className="px-6 py-4 text-left text-sm font-semibold">
                Status
              </th>
              <th className="px-6 py-4 text-left text-sm font-semibold">
                Date
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center">
                  <p className="text-white/60">Loading transactions...</p>
                </td>
              </tr>
            ) : transactions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center">
                  <p className="text-white/60">No transactions found</p>
                </td>
              </tr>
            ) : (
              transactions.map(tx => (
                <tr
                  key={tx.id}
                  className="border-b border-white/5 hover:bg-white/5 transition"
                >
                  <td className="px-6 py-4">
                    <span
                      className={`font-semibold ${
                        tx.type === 'sent' ? 'text-red-400' : 'text-green-400'
                      }`}
                    >
                      {typeIcons[tx.type]} {tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <p className="font-semibold">
                      {tx.amount} {tx.asset}
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="font-ticker text-sm text-white/70 truncate">
                      {tx.recipient}
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`font-medium capitalize ${
                        statusColors[tx.status]
                      }`}
                    >
                      {tx.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-white/70">
                      {tx.timestamp.toLocaleDateString()}
                    </p>
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
