'use client';

import type { ReactNode } from 'react';
import React from 'react';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import ChangelogModal, { useChangelogModal } from '@/components/changelog-modal';
import { SplitSyncBridge } from '@/components/dashboard/SplitSyncBridge';

function ChangelogProvider({ children }: { children: ReactNode }) {
  const { isOpen, open, close } = useChangelogModal();

  React.useEffect(() => {
    if (isOpen) open();
  }, []);

  return (
    <>
      {children}
      <ChangelogModal isOpen={isOpen} onClose={close} />
    </>
  );
}

/**
 * Dashboard Layout
 *
 * Provides the main dashboard shell with sidebar, header, and navigation.
 * Used by all dashboard pages and sub-routes.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <ChangelogProvider>
      <SplitSyncBridge>
        <DashboardShell>{children}</DashboardShell>
      </SplitSyncBridge>
    </ChangelogProvider>
  );
}
