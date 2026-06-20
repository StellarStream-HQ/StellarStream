"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { AuditLogDrawer } from "./AuditLogDrawer";

interface DashboardShellProps {
  children: ReactNode;
}

export function DashboardShell({ children }: DashboardShellProps) {
  const [isAuditLogOpen, setIsAuditLogOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handleOpenAuditLog = useCallback(() => {
    setIsAuditLogOpen(true);
  }, []);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Fixed Nebula Glow Background */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background: `
            radial-gradient(
              circle 600px at 10% 15%,
              rgba(0, 245, 255, 0.12) 0%,
              transparent 70%
            ),
            radial-gradient(
              circle 500px at 90% 85%,
              rgba(138, 0, 255, 0.08) 0%,
              transparent 60%
            )
          `,
        }}
      />

      {/* Content Wrapper */}
      <div className="relative z-10 flex min-h-screen">
        <Sidebar
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
          onOpenAuditLog={handleOpenAuditLog}
        />

        <AuditLogDrawer
          isOpen={isAuditLogOpen}
          onClose={() => setIsAuditLogOpen(false)}
        />

        {/* Main Content Area */}
        <main className="min-w-0 flex-1 overflow-x-hidden">
          <div
            className="grid gap-6 p-5 pb-24 pt-20 transition-all duration-300 ease-in-out md:px-8 md:py-8 md:pb-8 md:pt-8"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gridAutoFlow: "dense",
            }}
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}