"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useWallet } from "@/lib/wallet-context";
import { isSplitterV3EnabledForNetwork } from "@/lib/feature-flags";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  ArrowRightLeft,
  CirclePlus,
  ClipboardCheck,
  Coins,
  FileText,
  Gauge,
  History as HistoryIcon,
  Inbox,
  LayoutTemplate,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Rocket,
  ScrollText,
  Settings,
  Share2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Split,
  TrendingDown,
  Waves,
  X,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
type NavItem = {
  label: string;
  href?: string;
  onClick?: () => void;
  icon: ComponentType<{ className?: string }>;
  badge?: number;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

interface SidebarProps {
  onOpenAuditLog: () => void;

  /**
   * Optional controlled collapse state.
   * This keeps the sidebar working with the current DashboardShell,
   * and later allows the shell to control the main content margin.
   */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === href;
  return pathname.startsWith(href);
}

function SidebarProfileCard({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-[#232a34]/80 shadow-[0_0_22px_rgba(124,58,237,0.18)] transition-all duration-300 ease-in-out ${
        collapsed ? "mx-auto w-12 p-1.5" : "p-3"
      }`}
    >
      <div
        className={`flex items-center ${
          collapsed ? "justify-center" : "gap-3"
        }`}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#7c3aed] text-xs font-bold text-white shadow-[0_0_16px_rgba(124,58,237,0.5)]">
          G
        </div>

        <div
          className={`min-w-0 overflow-hidden transition-all duration-300 ease-in-out ${
            collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
          }`}
        >
          <p className="truncate font-body text-xs text-[#f5f3ff]/60">
            Connected Wallet
          </p>
          <p className="truncate font-body text-sm font-semibold text-[#f5f3ff]">
            GAB3...X7QP
          </p>
        </div>
      </div>
    </div>
  );
}

export function Sidebar({
  onOpenAuditLog,
  collapsed: controlledCollapsed,
  onCollapsedChange,
}: SidebarProps) {
  const pathname = usePathname();
  const { network } = useWallet();

const [internalCollapsed, setInternalCollapsed] = useState(false);
const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
const [mounted, setMounted] = useState(false);

useEffect(() => {
  setMounted(true);
}, []);

  const collapsed = controlledCollapsed ?? internalCollapsed;

  const setCollapsed = (nextCollapsed: boolean) => {
    if (controlledCollapsed === undefined) {
      setInternalCollapsed(nextCollapsed);
    }

    onCollapsedChange?.(nextCollapsed);
  };

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  const navGroups = useMemo<NavGroup[]>(() => {
    const groups: NavGroup[] = [
      {
        label: "Overview",
        items: [
          { label: "Dashboard", href: "/dashboard", icon: Gauge },
          { label: "Health", href: "/dashboard/health", icon: Activity },
          {
            label: "Transparency",
            href: "/dashboard/transparency",
            icon: ShieldCheck,
          },
          {
            label: "History",
            onClick: onOpenAuditLog,
            icon: HistoryIcon,
          },
        ],
      },
      {
        label: "Streams",
        items: [
          { label: "My Streams", href: "/dashboard/streams", icon: Waves },
          {
            label: "Create Stream",
            href: "/dashboard/create-stream",
            icon: CirclePlus,
          },
          {
            label: "Templates",
            href: "/dashboard/templates",
            icon: LayoutTemplate,
          },
        ],
      },
      {
        label: "Payments",
        items: [
          {
            label: "Disbursements",
            href: "/dashboard/disbursements",
            icon: TrendingDown,
          },
          {
            label: "Reports",
            href: "/dashboard/disbursement-report",
            icon: FileText,
          },
          {
            label: "Invoice Links",
            href: "/dashboard/invoice-links",
            icon: ClipboardCheck,
          },
        ],
      },
      {
        label: "Approvals",
        items: [
          {
            label: "Pending Approvals",
            href: "/dashboard/pending",
            icon: ClipboardCheck,
            badge: 2,
          },
          {
            label: "Approval Inbox",
            href: "/dashboard/approval-inbox",
            icon: Inbox,
            badge: 3,
          },
          {
            label: "Approval Policies",
            href: "/dashboard/policies",
            icon: ScrollText,
          },
        ],
      },
      {
        label: "Tools",
        items: [
          {
            label: "Splitter",
            href: "/dashboard/splitter",
            icon: Share2,
          },
          {
            label: "Compare Splits",
            href: "/dashboard/split-comparison",
            icon: ArrowRightLeft,
          },
          {
            label: "Deploy Splitter",
            href: "/dashboard/deploy-splitter",
            icon: Rocket,
          },
          {
            label: "Dust Recovery",
            href: "/dashboard/dust-recovery",
            icon: Coins,
          },
        ],
      },
      {
        label: "Security",
        items: [
          { label: "Vaults", href: "/dashboard/vaults", icon: Shield },
          {
            label: "Security Vault",
            href: "/dashboard/security-vault",
            icon: ShieldAlert,
          },
          {
            label: "Emergency Stop",
            href: "/dashboard/emergency-stop",
            icon: ShieldAlert,
          },
          { label: "Settings", href: "/dashboard/settings", icon: Settings },
        ],
      },
    ];

if (!mounted || !isSplitterV3EnabledForNetwork(network)) {
  return groups;
}

    return groups.map((group) => {
      if (group.label !== "Tools") return group;

      return {
        ...group,
        items: [
          ...group.items,
          {
            label: "Splitter V3",
            href: "/dashboard/v3/splitter",
            icon: Split,
            badge: 0,
          },
        ],
      };
    });
  },[mounted, network, onOpenAuditLog]);

  const allNavItems = navGroups.flatMap((group) => group.items);
  const mobileBottomItems = allNavItems.filter((item) => item.href).slice(0, 5);

const renderNavItem = (
  item: NavItem,
  mode: "desktop" | "mobile",
  itemKey: string
) => {
    const Icon = item.icon;
    const active = item.href ? isActive(pathname, item.href) : false;
    const isDesktop = mode === "desktop";

    const content = (
      <>
        <span
          className={`absolute left-0 top-2 h-[calc(100%-16px)] w-[3px] rounded-r-full transition-all duration-200 ease-in-out ${
            active
              ? "bg-[#7c3aed] shadow-[0_0_14px_rgba(124,58,237,0.8)]"
              : "bg-transparent"
          }`}
        />

        <span
          className={`absolute inset-y-1 left-2 rounded-xl blur-md transition-all duration-200 ease-in-out ${
            active
              ? "w-8 bg-[#7c3aed]/35 opacity-100"
              : "w-0 bg-transparent opacity-0 group-hover:w-8 group-hover:bg-[#7c3aed]/20 group-hover:opacity-100"
          }`}
        />

        <Icon
className={`relative z-10 h-4.5 w-4.5 shrink-0 transition-colors duration-200 ${
            active
              ? "text-[#38bdf8]"
              : "text-[#f5f3ff]/70 group-hover:text-[#f5f3ff]"
          }`}
        />

        <span
          className={`relative z-10 min-w-0 flex-1 truncate font-body transition-all duration-300 ease-in-out ${
            active
              ? "font-semibold text-[#38bdf8]"
              : "font-medium text-[#f5f3ff]/80 group-hover:text-[#f5f3ff]"
          } ${
            isDesktop && collapsed
              ? "w-0 opacity-0"
              : "w-auto opacity-100"
          }`}
        >
          {item.label}
        </span>

        {!collapsed && item.badge && item.badge > 0 ? (
          <span className="relative z-10 ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[#38bdf8] px-1.5 text-[10px] font-bold leading-none text-[#07111d] shadow-[0_0_10px_rgba(56,189,248,0.55)]">
            {item.badge}
          </span>
        ) : null}

        {collapsed && isDesktop && item.badge && item.badge > 0 ? (
          <span className="absolute right-3 top-1 z-20 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#38bdf8] px-1 text-[9px] font-bold leading-none text-[#07111d]">
            {item.badge}
          </span>
        ) : null}
      </>
    );

    const baseClassName =
      "group relative flex items-center overflow-hidden rounded-xl border border-transparent transition-all duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7c3aed]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1f27]";

    const stateClassName = active
      ? "bg-[#232a34] shadow-[0_0_18px_rgba(124,58,237,0.35)]"
      : "hover:bg-[#232a34] hover:shadow-[0_0_14px_rgba(124,58,237,0.18)]";

const sizeClassName =
  isDesktop && collapsed
    ? "mx-auto h-11 w-11 justify-center px-0"
    : "w-full gap-3 px-4 py-2.5 text-left";

    const className = `${baseClassName} ${stateClassName} ${sizeClassName}`;

    if (item.href) {
      return (
 <Link
  key={itemKey}
  href={item.href}
          title={collapsed && isDesktop ? item.label : undefined}
          aria-label={`Navigate to ${item.label}`}
          aria-current={active ? "page" : undefined}
          className={className}
        >
          {content}
        </Link>
      );
    }

    return (
      <button
        key={itemKey}
        type="button"
        onClick={item.onClick}
        title={collapsed && isDesktop ? item.label : undefined}
        aria-label={item.label}
        className={className}
      >
        {content}
      </button>
    );
  };

  return (
    <>
      <div className="fixed left-0 right-0 top-0 z-50 border-b border-white/10 bg-[#1a1f27]/95 px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)] backdrop-blur-2xl md:hidden">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-label={mobileMenuOpen ? "Close sidebar menu" : "Open sidebar menu"}
            aria-expanded={mobileMenuOpen}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-[#232a34] text-[#f5f3ff] shadow-[0_0_14px_rgba(124,58,237,0.18)] transition duration-200 ease-in-out hover:bg-[#2d3542] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7c3aed]/70"
          >
            {mobileMenuOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>

          <Link href="/" className="font-heading text-base text-[#f5f3ff]">
            StellarStream
          </Link>

          <div className="h-10 w-10" />
        </div>
      </div>

      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm md:hidden"
              onClick={() => setMobileMenuOpen(false)}
            />

            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed bottom-0 left-0 top-0 z-50 flex w-[280px] max-w-[86vw] flex-col border-r border-white/10 bg-[#1a1f27] shadow-[20px_0_60px_rgba(0,0,0,0.35)] md:hidden"
              aria-label="Mobile sidebar navigation"
            >
              <div
  className={`flex min-h-0 flex-1 flex-col transition-all duration-300 ease-in-out ${
    collapsed ? "p-3" : "p-4"
  }`}
>
                <div className="mb-6 flex items-start justify-between pt-2">
                  <Link href="/" onClick={() => setMobileMenuOpen(false)}>
                    <p className="font-heading text-xl text-[#f5f3ff]">
                      StellarStream
                    </p>
                    <p className="font-body text-xs uppercase tracking-[0.24em] text-[#38bdf8]">
                      Navigation
                    </p>
                  </Link>

                  <button
                    type="button"
                    onClick={() => setMobileMenuOpen(false)}
                    aria-label="Close sidebar menu"
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-[#232a34] text-[#f5f3ff] transition duration-200 hover:bg-[#2d3542] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7c3aed]/70"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

<nav
  className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
    collapsed ? "space-y-3 px-0" : "space-y-5 pr-1"
  }`}
  aria-label="Dashboard navigation"
>
                  {navGroups.map((group) => (
                    <div key={group.label}>
                      <p className="mb-2 px-4 font-body text-[10px] font-semibold uppercase tracking-[0.22em] text-[#f5f3ff]/35">
                        {group.label}
                      </p>

                      <div className={collapsed ? "space-y-2" : "space-y-1.5"}>
                        {group.items.map((item, index) =>
  renderNavItem(
    item,
    "mobile",
    `mobile-${group.label}-${item.href ?? item.label}-${index}`
  )
)}
                      </div>
                    </div>
                  ))}
                </nav>

                <div className="mt-5 shrink-0 space-y-4">
                 {mounted && <ThemeToggle className="w-full justify-between" />}
                  <SidebarProfileCard collapsed={false} />
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <aside
        className={`fixed left-0 top-0 z-40 hidden h-screen flex-col border-r border-white/10 bg-[#1a1f27] shadow-[12px_0_40px_rgba(0,0,0,0.28)] transition-[width] duration-300 ease-in-out md:flex ${
         collapsed ? "w-[88px]" : "w-[280px]"
        }`}
        aria-label="Dashboard sidebar navigation"
      >
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <div
            className={`mb-6 flex items-center ${
              collapsed ? "justify-center" : "justify-between"
            }`}
          >
            <Link
              href="/"
              className={`min-w-0 overflow-hidden transition-all duration-300 ease-in-out hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7c3aed]/70 ${
                collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
              }`}
            >
              <p className="truncate font-heading text-lg text-[#f5f3ff]">
                StellarStream
              </p>
              <p className="truncate font-body text-[10px] uppercase tracking-[0.22em] text-[#38bdf8]">
                Navigation Blade
              </p>
            </Link>

            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[#232a34] text-[#f5f3ff]/80 shadow-[0_0_14px_rgba(124,58,237,0.16)] transition duration-200 ease-in-out hover:bg-[#2d3542] hover:text-[#f5f3ff] hover:shadow-[0_0_16px_rgba(124,58,237,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7c3aed]/70"
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          </div>

          <nav
            className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1"
            aria-label="Dashboard navigation"
          >
            {navGroups.map((group) => (
              <div key={group.label}>
{!collapsed && (
  <p className="mb-2 px-4 font-body text-[10px] font-semibold uppercase tracking-[0.22em] text-[#f5f3ff]/35">
    {group.label}
  </p>
)}

                <div className="space-y-1.5">
                  {group.items.map((item, index) =>
  renderNavItem(
    item,
    "desktop",
    `desktop-${group.label}-${item.href ?? item.label}-${index}`
  )
)}
                </div>
              </div>
            ))}
          </nav>

          <div className="mt-5 shrink-0 space-y-4">
 {mounted && !collapsed && <ThemeToggle className="w-full justify-between" />}


            <SidebarProfileCard collapsed={collapsed} />

            
          
          </div>
        </div>
      </aside>

      <div
        aria-hidden="true"
        className={`hidden shrink-0 transition-[width] duration-300 ease-in-out md:block ${
          collapsed ? "w-[88px]" : "w-[280px]"
        }`}
      />

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#1a1f27]/95 px-3 py-2 shadow-[0_-12px_30px_rgba(0,0,0,0.28)] backdrop-blur-2xl md:hidden">
        <nav
          className="mx-auto flex max-w-xl items-center justify-around gap-1"
          aria-label="Mobile quick navigation"
        >
          {mobileBottomItems.map((item, index) => {
            const Icon = item.icon;
            const active = item.href ? isActive(pathname, item.href) : false;

            return (
              <Link
               key={`bottom-${item.href ?? item.label}-${index}`}
                href={item.href ?? "/dashboard"}
                aria-label={`Navigate to ${item.label}`}
                aria-current={active ? "page" : undefined}
                className="group relative flex min-w-0 flex-1 flex-col items-center rounded-xl px-2 py-2 transition duration-200 ease-in-out hover:bg-[#232a34] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7c3aed]/70"
              >
                <span
                  className={`absolute inset-x-4 top-1 h-6 rounded-lg blur-md transition duration-200 ${
                    active
                      ? "bg-[#7c3aed]/40 opacity-100"
                      : "bg-transparent opacity-0"
                  }`}
                />

                <Icon
                  className={`relative z-10 h-4 w-4 ${
                    active
                      ? "text-[#38bdf8]"
                      : "text-[#f5f3ff]/70 group-hover:text-[#f5f3ff]"
                  }`}
                />

                <span
                  className={`relative z-10 mt-1 max-w-full truncate font-body text-[9px] ${
                    active
                      ? "font-semibold text-[#38bdf8]"
                      : "text-[#f5f3ff]/70"
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

      </div>
    </>
  );
}