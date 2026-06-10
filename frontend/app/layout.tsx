import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/toast-provider";
import { WalletProvider } from "@/lib/wallet-context";
import { StellarProvider } from "@/lib/providers/StellarProvider";
import { ProtocolStatusProvider } from "@/lib/use-protocol-status";
import { EmergencyBanner } from "@/components/emergency-banner";
import ErrorTracker from "@/components/error-tracker";
import OnboardingTour from "@/components/OnboardingTour";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";

export const metadata: Metadata = {
  title: "StellarStream – Money as a Stream",
  description:
    "Non-custodial, second-by-second asset streaming protocol built on Soroban. Real-time payments, transparent splits, and financial autonomy.",
  keywords: ["streaming", "payments", "cryptocurrency", "Stellar", "Soroban"],
  authors: [{ name: "StellarStream" }],
  openGraph: {
    type: "website",
    locale: "en_US",
    title: "StellarStream",
    description: "Money as a Stream – On-chain streaming payments.",
    siteName: "StellarStream",
  },
};

/**
 * Root Layout Component
 *
 * Provides global context providers and shared application layout.
 * All page routes inherit from this layout.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className="antialiased flex flex-col min-h-screen bg-black text-white"
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <WalletProvider>
          <StellarProvider>
            <ProtocolStatusProvider>
              <EmergencyBanner />

              <main className="flex-1 w-full">{children}</main>

              <ToastProvider />
              <OnboardingTour />
              <ServiceWorkerRegistrar />
              <ErrorTracker />
            </ProtocolStatusProvider>
          </StellarProvider>
        </WalletProvider>
      </body>
    </html>
  );
}