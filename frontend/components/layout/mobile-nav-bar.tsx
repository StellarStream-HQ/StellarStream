"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Waves, CirclePlus, ClipboardCheck, User } from "lucide-react";
import { usePendingStreams } from "@/lib/use-pending-streams";

export function MobileNavBar() {
  const pathname = usePathname();
  const { streams } = usePendingStreams();

  // Filter streams that require the current user's signature to count as pending action
  const pendingCount = streams.filter((s) => !s.hasCurrentUserSigned).length;

  const tabs = [
    {
      label: "Home",
      href: "/dashboard",
      icon: Home,
    },
    {
      label: "Streams",
      href: "/dashboard/streams",
      icon: Waves,
    },
    {
      label: "Create",
      href: "/dashboard/create-stream",
      icon: CirclePlus,
      isSpecial: true,
    },
    {
      label: "Approval",
      href: "/dashboard/pending",
      icon: ClipboardCheck,
      badge: pendingCount,
    },
    {
      label: "Profile",
      href: "/dashboard/settings",
      icon: User,
    },
  ];

  const checkActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === href;
    }
    return pathname?.startsWith(href);
  };

  return (
    <div
      className="mobile-bottom-tab-bar fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around px-2"
      style={{
        height: "60px",
        paddingBottom: "16px",
        borderTop: "1px solid #7c3aed",
        backgroundColor: "#1a1f27",
      }}
      role="navigation"
      aria-label="Mobile Navigation Bar"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = checkActive(tab.href);

        if (tab.isSpecial) {
          // Special styling for Create tab: larger, raised (scale 1.1), always highlighted
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex flex-1 flex-col items-center justify-center transition-all duration-200 ease-in-out hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7c3aed]"
              style={{
                height: "60px",
                paddingBottom: "16px", // matching tab padding bottom
                transform: "scale(1.1) translateY(-4px)",
              }}
              aria-label="Create Stream"
            >
              <Icon
                size={24}
                className="text-[#00d4ff]"
                style={{
                  filter: "drop-shadow(0 0 6px rgba(0, 212, 255, 0.4))",
                }}
              />
              <span className="mt-0.5 text-[9px] font-semibold text-[#00d4ff]">
                {tab.label}
              </span>
            </Link>
          );
        }

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="group relative flex flex-1 flex-col items-center justify-center transition-all duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7c3aed]"
            style={{
              height: "60px",
              paddingBottom: "16px",
            }}
            aria-label={tab.label}
            aria-current={active ? "page" : undefined}
          >
            <Icon
              size={20}
              className={`transition-colors duration-200 ${
                active
                  ? "text-[#00d4ff]"
                  : "text-slate-400 group-hover:text-slate-200"
              }`}
            />
            <span
              className={`mt-0.5 text-[9px] transition-colors duration-200 ${
                active
                  ? "font-semibold text-[#00d4ff]"
                  : "text-slate-400 group-hover:text-slate-200"
              }`}
            >
              {tab.label}
            </span>

            {/* Notification Badge on Approval tab */}
            {tab.badge && tab.badge > 0 ? (
              <span
                className="absolute top-1.5 right-[calc(50%-18px)] flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[8px] font-bold text-white"
                style={{
                  boxShadow: "0 0 8px rgba(239, 68, 68, 0.6)",
                }}
              >
                {tab.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
