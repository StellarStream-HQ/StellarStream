"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";

type Asset = {
  symbol: "XLM" | "USDC" | "yXLM";
  price: number;
  delta: number;
};

const seed: Asset[] = [
  { symbol: "XLM", price: 0.1324, delta: 0 },
  { symbol: "USDC", price: 1, delta: 0 },
  { symbol: "yXLM", price: 0.1418, delta: 0 },
];

function formatPrice(symbol: Asset["symbol"], value: number) {
  const decimals = symbol === "USDC" ? 4 : 5;
  return value.toFixed(decimals);
}

export function NeonTickerSection() {
  const [assets, setAssets] = useState<Asset[]>(seed);

  useEffect(() => {
    const id = window.setInterval(() => {
      setAssets((prev) =>
        prev.map((asset) => {
          const randomMove = (Math.random() - 0.5) * (asset.symbol === "USDC" ? 0.0012 : 0.009);
          const nextPrice = Math.max(0.0001, asset.price + randomMove);
          return {
            ...asset,
            price: nextPrice,
            delta: nextPrice - asset.price,
          };
        }),
      );
    }, 1500);

    return () => window.clearInterval(id);
  }, []);

  const items = useMemo(() => [...assets, ...assets, ...assets], [assets]);

  return (
    <section className="relative bg-[#030303] px-5 pb-24 md:px-10 md:pb-28">
      <div className="mx-auto w-full max-w-6xl">
        <div className="relative overflow-hidden rounded-2xl border border-[#00F5FF]/50 bg-white/[0.03] shadow-[0_0_24px_rgba(0,245,255,0.16)] backdrop-blur-lg">
          <motion.div
            animate={{ x: ["0%", "-33.333%"] }}
            transition={{ duration: 18, ease: "linear", repeat: Infinity }}
            className="flex min-w-max items-center gap-10 px-6 py-4 md:gap-14 md:py-5"
          >
            {items.map((asset, idx) => {
              const isUp = asset.delta >= 0;
              return (
                <div
                  key={`${asset.symbol}-${idx}`}
                  className="flex items-center gap-2 whitespace-nowrap"
                >
                  <Badge variant="neutral" size="sm" outline>
                    {asset.symbol}
                  </Badge>
                  <span className="font-ticker text-base text-white tabular-nums md:text-lg">
                    ${formatPrice(asset.symbol, asset.price)}
                  </span>
                  <Badge 
                    variant={isUp ? "success" : "error"} 
                    size="sm"
                  >
                    {isUp ? "+" : ""}
                    {(asset.delta * 100).toFixed(2)}%
                  </Badge>
                </div>
              );
            })}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
