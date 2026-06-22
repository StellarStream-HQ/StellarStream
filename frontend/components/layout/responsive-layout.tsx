"use client";

import { useEffect, useState, useRef, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { MobileNavBar } from "./mobile-nav-bar";

interface ResponsiveLayoutProps {
  children: ReactNode;
}

const DASHBOARD_TABS = [
  "/dashboard",
  "/dashboard/streams",
  "/dashboard/create-stream",
  "/dashboard/pending",
  "/dashboard/settings",
];

export function ResponsiveLayout({ children }: ResponsiveLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Touch gesture state
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchEndRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setMounted(true);
    const mediaQuery = window.matchMedia("(max-width: 640px)");
    setIsMobile(mediaQuery.matches);

    const handleMediaChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
    };

    mediaQuery.addEventListener("change", handleMediaChange);
    return () => {
      mediaQuery.removeEventListener("change", handleMediaChange);
    };
  }, []);

  const isDashboard = pathname?.startsWith("/dashboard");

  // Determine if swipe target is inside ignored interactive elements (inputs, scroll containers, draggable items)
  const isElementIgnored = (el: HTMLElement | null): boolean => {
    if (!el) return false;

    const tagName = el.tagName.toLowerCase();
    if (["input", "textarea", "select", "button", "a"].includes(tagName)) {
      return true;
    }

    let current: HTMLElement | null = el;
    while (current) {
      if (current.getAttribute) {
        if (
          current.getAttribute("data-no-swipe") === "true" ||
          current.classList.contains("cursor-grab") ||
          current.classList.contains("active:cursor-grabbing") ||
          current.classList.contains("no-swipe")
        ) {
          return true;
        }
      }
      current = current.parentElement;
    }

    return false;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isMobile || !isDashboard) return;

    // Check if target is an ignored interactive/draggable element
    const target = e.target as HTMLElement;
    if (isElementIgnored(target)) return;

    touchStartRef.current = {
      x: e.targetTouches[0].clientX,
      y: e.targetTouches[0].clientY,
    };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isMobile || !isDashboard || !touchStartRef.current) return;

    touchEndRef.current = {
      x: e.targetTouches[0].clientX,
      y: e.targetTouches[0].clientY,
    };
  };

  const handleTouchEnd = () => {
    if (
      !isMobile ||
      !isDashboard ||
      !touchStartRef.current ||
      !touchEndRef.current
    ) {
      return;
    }

    const deltaX = touchStartRef.current.x - touchEndRef.current.x;
    const deltaY = touchStartRef.current.y - touchEndRef.current.y;

    // Thresholds: minimum horizontal movement of 75px and maximum vertical deviation of 45px
    const minHorizontalSwipe = 75;
    const maxVerticalDeviation = 45;

    if (
      Math.abs(deltaX) > minHorizontalSwipe &&
      Math.abs(deltaY) < maxVerticalDeviation
    ) {
      const currentIndex = DASHBOARD_TABS.indexOf(pathname);
      if (currentIndex !== -1) {
        if (deltaX > 0 && currentIndex < DASHBOARD_TABS.length - 1) {
          // Swipe Left -> Navigate Next
          router.push(DASHBOARD_TABS[currentIndex + 1]);
        } else if (deltaX < 0 && currentIndex > 0) {
          // Swipe Right -> Navigate Prev
          router.push(DASHBOARD_TABS[currentIndex - 1]);
        }
      }
    }

    // Reset touch coordinates
    touchStartRef.current = null;
    touchEndRef.current = null;
  };

  return (
    <div
      className="flex min-h-screen flex-col"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="w-full flex-grow">{children}</div>
      {mounted && isMobile && isDashboard && <MobileNavBar />}
    </div>
  );
}
