'use client';

import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export interface FilterFormData {
  search: string;
  status: 'all' | 'active' | 'paused' | 'completed';
  asset?: string;
  sortBy: 'recent' | 'amount-high' | 'amount-low' | 'oldest';
}

interface FilterFormProps {
  onFilter?: (data: FilterFormData) => void;
  initialData?: FilterFormData;
}

/**
 * Filter Form Component
 *
 * Provides filtering and sorting options for lists.
 * Used in streams and transactions views.
 */
export default function FilterForm({
  onFilter,
  initialData = {
    search: '',
    status: 'all',
    sortBy: 'recent',
  },
}: FilterFormProps) {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!onFilter) return;

    const formData = new FormData(e.currentTarget);
    onFilter({
      search: (formData.get('search') as string) || '',
      status: (formData.get('status') as any) || 'all',
      sortBy: (formData.get('sortBy') as any) || 'recent',
    });
  };

  return (
    <Card className="glass-card p-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search */}
          <div>
            <label className="block text-sm font-medium mb-2">Search</label>
            <input
              type="text"
              name="search"
              placeholder="Search..."
              defaultValue={initialData.search}
              className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-cyan-500 transition"
            />
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium mb-2">Status</label>
            <select
              name="status"
              defaultValue={initialData.status}
              className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500 transition"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          {/* Sort */}
          <div>
            <label className="block text-sm font-medium mb-2">Sort By</label>
            <select
              name="sortBy"
              defaultValue={initialData.sortBy}
              className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500 transition"
            >
              <option value="recent">Recently Updated</option>
              <option value="amount-high">Amount (High to Low)</option>
              <option value="amount-low">Amount (Low to High)</option>
              <option value="oldest">Oldest First</option>
            </select>
          </div>

          {/* Apply Button */}
          <div className="flex items-end">
            <Button
              type="submit"
              className="w-full bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
            >
              Apply Filters
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}
