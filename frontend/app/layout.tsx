import type { Metadata } from "next";
import "./globals.css";
import "../styles/responsive.css";
import { ToastProvider } from "@/components/toast-provider";
import { WalletProvider } from "@/lib/wallet-context";
import { StellarProvider } from "@/lib/providers/StellarProvider";
import { ProtocolStatusProvider } from "@/lib/use-protocol-status";
import { EmergencyBanner } from "@/components/emergency-banner";
import ErrorTracker from "@/components/error-tracker";
import OnboardingTour from "@/components/OnboardingTour";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { ResponsiveLayout } from "@/components/layout/responsive-layout";

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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          id="google-fonts-async"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@100;300;400;500;600;700;800;900&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
          media="print"
          suppressHydrationWarning
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var link = document.getElementById('google-fonts-async');
                if (link) {
                  var cb = function() { link.media = 'all'; };
                  link.addEventListener('load', cb);
                  if (link.sheet) cb();
                }
              })();
            `,
          }}
        />
      </head>
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

              <ResponsiveLayout>
                <main className="flex-1 w-full">{children}</main>
              </ResponsiveLayout>

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