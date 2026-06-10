"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { ShieldCheck, Zap, Sprout } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Caption, Paragraph } from "@/components/ui/Typography";
import { Badge } from "@/components/ui/Badge";

type Feature = {
  label: string;
  title: string;
  description: string;
  value: string;
  icon: LucideIcon;
  accent: string;
  rowSpan: string;
};

const features: Feature[] = [
  {
    label: "Security",
    title: "Real-time Settlement",
    description:
      "Every stream settles by ledger timestamp with transparent, auditable execution.",
    value: "Second-by-second finality",
    icon: ShieldCheck,
    accent: "#00F5FF",
    rowSpan: "md:row-span-14",
  },
  {
    label: "Speed",
    title: "Low Fees",
    description:
      "Minimal transaction overhead keeps streams efficient even at high frequency.",
    value: "Optimized for micro-flows",
    icon: Zap,
    accent: "#8A00FF",
    rowSpan: "md:row-span-12",
  },
  {
    label: "Yield",
    title: "Auto-Yield",
    description:
      "Idle balances can be routed into yield strategies while streams continue to run.",
    value: "Passive return while streaming",
    icon: Sprout,
    accent: "#00F5FF",
    rowSpan: "md:row-span-16",
  },
];

function NeonIcon({ icon: Icon, accent }: { icon: LucideIcon; accent: string }) {
  return (
    <span className="relative inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-black/45">
      <Icon
        className="absolute h-6 w-6 translate-x-[1.5px] translate-y-[-1.5px] opacity-80"
        color="#8A00FF"
      />
      <Icon className="relative h-6 w-6" color={accent} />
    </span>
  );
}

export function FeatureBentoSection() {
  return (
    <section className="relative bg-[#030303] px-5 pb-24 md:px-10 md:pb-32">
      <div className="mx-auto w-full max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="mb-8"
        >
          <p className="font-body text-xs tracking-[0.14em] text-white/65 uppercase">
            Feature Bento
          </p>
          <h2 className="font-heading mt-2 text-3xl text-white md:text-5xl">
            Security, Speed, Yield
          </h2>
        </motion.div>

        <div className="grid gap-4 md:grid-cols-3 md:[grid-auto-rows:20px]">
          {features.map((feature, idx) => (
            <motion.article
              key={feature.title}
              tabIndex={0}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.55, delay: idx * 0.08 }}
              whileHover={{ y: -6, scale: 1.01 }}
              whileFocus={{ y: -6, scale: 1.01 }}
              className={`group relative overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.035] p-5 shadow-[0_16px_50px_rgba(0,0,0,0.45)] backdrop-blur-lg outline-none transition-shadow ${feature.rowSpan}`}
            >
              <div
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100"
                style={{
                  background: `radial-gradient(circle at 16% 14%, ${feature.accent}2a, transparent 48%), radial-gradient(circle at 90% 92%, #8A00FF22, transparent 50%)`,
                }}
              />
              <div
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100"
                style={{
                  boxShadow:
                    "inset 0 0 0 1px rgba(255,255,255,0.12), 0 0 40px rgba(0,245,255,0.14), 0 0 56px rgba(138,0,255,0.12)",
                }}
              />

              <div className="relative z-10 flex h-full flex-col">
                <div className="flex items-center justify-between">
                  <NeonIcon icon={feature.icon} accent={feature.accent} />
                  <Badge variant="neutral" size="sm" outline>
                    {feature.label}
                  </Badge>
                </div>

                <h3 className="font-heading mt-5 text-2xl leading-tight text-white md:text-3xl">
                  {feature.title}
                </h3>
                <p className="font-body mt-3 max-w-sm text-sm leading-7 text-white/72">
                  {feature.description}
                </p>
                <p className="font-body mt-auto pt-6 text-sm font-medium text-[#CFFBFF]">
                  {feature.value}
                </p>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
