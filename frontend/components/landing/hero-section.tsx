"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { H1, Paragraph } from "@/components/ui/Typography";

export function HeroSection() {
  const router = useRouter();

  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-[#030303] px-5 py-12 md:px-10 md:py-16">
      <div className="pointer-events-none absolute inset-0">
        <div className="nebula-blob nebula-cyan" />
        <div className="nebula-blob nebula-violet" />
        <div className="absolute top-1/2 left-1/2 h-[62rem] w-[62rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/6" />
      </div>

      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="relative mx-auto flex w-full max-w-6xl flex-col items-center"
      >
        <motion.div
          whileHover={{ y: -4 }}
          transition={{ type: "spring", stiffness: 170, damping: 22 }}
          className="relative min-h-[640px] w-full overflow-hidden rounded-[2.25rem] border border-white/15 bg-black/50 p-4 shadow-[0_30px_90px_rgba(0,0,0,0.65)] backdrop-blur-xl md:min-h-[760px] md:p-7"
        >
          <div className="pointer-events-none absolute inset-2 rounded-[1.9rem] border border-white/8" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/10 to-transparent" />
          <div className="pointer-events-none absolute top-1/2 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20 bg-[radial-gradient(circle_at_30%_30%,rgba(0,245,255,0.18),transparent_56%),radial-gradient(circle_at_70%_70%,rgba(138,0,255,0.16),transparent_60%),radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.05),transparent_72%)]" />
          <div className="pointer-events-none absolute top-1/2 left-1/2 h-[46rem] w-[46rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" />

          <div className="relative z-10 mx-auto mt-24 flex max-w-3xl flex-col items-center px-4 text-center md:mt-36">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.22, duration: 0.5 }}
              className="font-body rounded-full border border-white/14 bg-black/35 px-4 py-1.5 text-xs tracking-[0.12em] text-white/68 uppercase"
            >
              Soroban Protocol • Non-Custodial
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28, duration: 0.65 }}
              className="font-heading liquid-chrome mt-6 text-4xl leading-[1.08] font-semibold md:text-7xl"
            >
              Your keys to
              <br />
              real-time asset flow
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.55 }}
              className="font-body mt-5 max-w-2xl text-sm leading-7 text-white/72 md:text-base"
            >
              Replace payroll cliffs with second-by-second liquidity. Funds
              unlock by ledger timestamp and can be withdrawn anytime.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.55 }}
              className="mt-8 flex flex-wrap items-center justify-center gap-3"
            >
              <motion.div
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
              >
                <Button variant="outline" size="md">
                  Explore Streams
                </Button>
              </motion.div>
              <motion.div
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.98 }}
              >
                <Button 
                  variant="primary" 
                  size="md"
                  onClick={() => router.push("/dashboard")}
                >
                  Start Streaming
                </Button>
              </motion.div>
            </motion.div>
          </div>

          <div className="pointer-events-none absolute top-[42%] left-[16%] hidden h-14 w-14 rounded-2xl border border-[#00F5FF]/25 bg-[#00F5FF]/5 md:block" />
          <div className="pointer-events-none absolute right-[14%] bottom-[26%] hidden h-16 w-16 rounded-2xl border border-[#8A00FF]/25 bg-[#8A00FF]/6 md:block" />
        </motion.div>
      </motion.section>
    </main>
  );
}
