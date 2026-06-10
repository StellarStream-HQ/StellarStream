'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

/**
 * Streams Page
 *
 * List view of all user streams with filtering, sorting, and search.
 * Allows quick access to individual stream details and management.
 */
function StreamsContent() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed'>('all');

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <h1 className="font-heading text-4xl font-bold">Streams</h1>
          <p className="text-white/60">
            Manage and monitor your active and past streams
          </p>
        </div>
        <Link href="/create-stream">
          <Button className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold">
            New Stream
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <Card className="glass-card p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Search */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Search</label>
            <input
              type="text"
              placeholder="Search streams..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-cyan-500 transition"
            />
          </div>

          {/* Status Filter */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500 transition"
            >
              <option value="all">All Streams</option>
              <option value="active">Active Only</option>
              <option value="completed">Completed Only</option>
            </select>
          </div>

          {/* Sort */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Sort By</label>
            <select className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:border-cyan-500 transition">
              <option>Recently Updated</option>
              <option>Amount (High to Low)</option>
              <option>Amount (Low to High)</option>
              <option>Created Date</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Streams Table */}
      <Card className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-white/10 bg-white/5">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold">Stream</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Amount</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Status</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Progress</th>
                <th className="px-6 py-4 text-left text-sm font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-white/5 hover:bg-white/5 transition">
                <td colSpan={5} className="px-6 py-12 text-center text-white/60">
                  No streams found. Create your first stream to get started.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Empty State CTA */}
      <Card className="glass-card p-6 border-cyan-500/30 bg-cyan-500/5 text-center">
        <div className="space-y-4">
          <p className="text-white/70">
            Ready to create your first stream?
          </p>
          <Link href="/create-stream">
            <Button className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold">
              Create Stream Now
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}

export default function StreamsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen">
          <Spinner />
        </div>
      }
    >
      <StreamsContent />
    </Suspense>
  );
}
