import type { ReactNode } from "react";
import { Nav } from "@/components/nav";

/**
 * Auth Layout
 *
 * Provides a clean, minimal layout for authentication pages (login, signup, verify).
 * Features centered content without sidebar or dashboard chrome.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Nav />
      <main className="min-h-screen w-full bg-black flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          {children}
        </div>
      </main>
    </>
  );
}
