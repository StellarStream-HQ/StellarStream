"use client";

import { motion } from "framer-motion";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { Caption, Paragraph, H2 } from "@/components/ui/Typography";

const FLOW_PATH = "M 140 120 C 320 26, 640 216, 880 120";

const particles = [
  { size: 5, duration: 2.8, delay: 0 },
  { size: 6, duration: 3.4, delay: 0.4 },
  { size: 4, duration: 2.6, delay: 0.9 },
  { size: 7, duration: 3.8, delay: 1.2 },
  { size: 5, duration: 3.1, delay: 1.7 },
  { size: 4, duration: 2.9, delay: 2.1 },
];

export function MoneyInMotionSection() {
  const [counter, setCounter] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setCounter((prev) => prev + 0.0017);
    }, 1);

    return () => window.clearInterval(interval);
  }, []);

  const liveValue = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
      }).format(counter),
    [counter],
  );

  return (
    <section className="relative bg-[#030303] px-5 pb-20 md:px-10 md:pb-28">
      <div className="mx-auto w-full max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.65, ease: "easeOut" }}
          className="glass-card relative overflow-hidden rounded-[2rem] border border-white/12 bg-white/[0.04] p-5 md:p-8"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_25%_50%,rgba(0,245,255,0.12),transparent_42%),radial-gradient(circle_at_75%_50%,rgba(138,0,255,0.12),transparent_45%)]" />

          <div className="relative mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <Caption uppercase>Kinetic Flow</Caption>
              <H2 className="mt-2">Money in Motion</H2>
              <Paragraph className="mt-3 max-w-xl">
                Funds stream continuously from sender to receiver. As each
                millisecond passes, value unlocks and settles in real time.
              </Paragraph>
            </div>

            <div className="rounded-2xl border border-white/12 bg-black/35 px-4 py-3 text-right backdrop-blur">
              <p className="font-body text-[11px] tracking-[0.12em] text-white/60 uppercase">
                Live Streamed
              </p>
              <p className="font-heading mt-1 text-2xl text-[#CFFBFF] md:text-3xl">
                {liveValue} USDC
              </p>
            </div>
          </div>

          <div className="relative h-[210px] rounded-2xl border border-white/10 bg-black/35 md:h-[250px]">
            <svg
              viewBox="0 0 1000 240"
              className="absolute inset-0 h-full w-full"
              aria-hidden="true"
            >
              <defs>
                <linearGradient
                  id="flowStroke"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="0%"
                >
                  <stop offset="0%" stopColor="#00F5FF" stopOpacity="0.35" />
                  <stop offset="50%" stopColor="#8A00FF" stopOpacity="0.7" />
                  <stop offset="100%" stopColor="#00F5FF" stopOpacity="0.35" />
                </linearGradient>
              </defs>
              <path
                d={FLOW_PATH}
                fill="none"
                stroke="url(#flowStroke)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray="6 10"
              />
            </svg>

            {particles.map((particle, idx) => (
              <motion.div
                key={`${particle.duration}-${idx}`}
                className="absolute top-0 left-0 rounded-full"
                style={
                  {
                    width: particle.size,
                    height: particle.size,
                    offsetPath: `path("${FLOW_PATH}")`,
                    background:
                      "radial-gradient(circle, #00F5FF 10%, #8A00FF 90%)",
                    boxShadow:
                      "0 0 12px rgba(0,245,255,0.7), 0 0 24px rgba(138,0,255,0.5)",
                  } as CSSProperties
                }
                animate={{
                  offsetDistance: ["0%", "100%"],
                  opacity: [0, 1, 1, 0],
                  scale: [0.8, 1, 1.15, 0.85],
                }}
                transition={{
                  duration: particle.duration,
                  delay: particle.delay,
                  repeat: Infinity,
                  ease: "linear",
                }}
              />
            ))}

            <div className="absolute top-1/2 left-6 -translate-y-1/2 md:left-10">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[#00F5FF]/45 bg-[#00F5FF]/12 shadow-[0_0_22px_rgba(0,245,255,0.28)] md:h-20 md:w-20">
                <span className="font-body text-xs font-medium text-[#BDFBFF] md:text-sm">
                  Sender
                </span>
              </div>
            </div>

            <div className="absolute top-1/2 right-6 -translate-y-1/2 md:right-10">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[#8A00FF]/45 bg-[#8A00FF]/12 shadow-[0_0_22px_rgba(138,0,255,0.3)] md:h-20 md:w-20">
                <span className="font-body text-xs font-medium text-[#E6C6FF] md:text-sm">
                  Receiver
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
