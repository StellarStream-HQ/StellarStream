import { prisma } from "../lib/db.js";
import { logger } from "../logger.js";
import fetch from "node-fetch";

interface StellarToml {
  CURRENCIES?: Array<{
    code: string;
    issuer: string;
    name?: string;
    image?: string;
    desc?: string;
    display_decimals?: number;
  }>;
}

export class AssetMetadataService {
  private readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Fetch stellar.toml from home domain
   */
  async fetchStellarToml(homeDomain: string): Promise<StellarToml | null> {
    try {
      const url = `https://${homeDomain}/.well-known/stellar.toml`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.warn("Failed to fetch stellar.toml", { homeDomain, status: response.status });
        return null;
      }

      const text = await response.text();
      return this.parseStellarToml(text);
    } catch (error) {
      logger.warn("Error fetching stellar.toml", { homeDomain, error });
      return null;
    }
  }

  /**
   * Parse TOML format (simplified parser for CURRENCIES section)
   */
  private parseStellarToml(tomlText: string): StellarToml {
    const currencies: StellarToml["CURRENCIES"] = [];
    const lines = tomlText.split("\n");
    let inCurrencies = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line === "[[CURRENCIES]]") {
        inCurrencies = true;
        const currency: any = {};

        // Parse currency block
        for (let j = i + 1; j < lines.length; j++) {
          const currencyLine = lines[j].trim();
          if (currencyLine.startsWith("[[")) break; // Next section

          const [key, ...valueParts] = currencyLine.split("=");
          if (!key) continue;

          const value = valueParts.join("=").trim().replace(/^["']|["']$/g, "");
          const cleanKey = key.trim();

          if (cleanKey === "code") currency.code = value;
          if (cleanKey === "issuer") currency.issuer = value;
          if (cleanKey === "name") currency.name = value;
          if (cleanKey === "image") currency.image = value;
          if (cleanKey === "desc") currency.desc = value;
          if (cleanKey === "display_decimals") currency.display_decimals = parseInt(value);
        }

        if (currency.code && currency.issuer) {
          currencies.push(currency);
        }
      }
    }

    return { CURRENCIES: currencies };
  }

  /**
   * Get home domain from Stellar account
   */
  async getHomeDomain(issuer: string): Promise<string | null> {
    try {
      const response = await fetch(`https://horizon.stellar.org/accounts/${issuer}`);

      if (!response.ok) return null;

      const data = (await response.json()) as any;
      return data.home_domain || null;
    } catch (error) {
      logger.warn("Failed to get home domain", { issuer, error });
      return null;
    }
  }

  /**
   * Discover and store asset metadata
   */
  async discoverAsset(tokenAddress: string): Promise<void> {
    try {
      // Check if already cached recently
      const existing = await prisma.asset.findUnique({
        where: { tokenAddress },
      });

      if (existing && existing.lastFetchedAt) {
        const age = Date.now() - existing.lastFetchedAt.getTime();
        if (age < this.CACHE_TTL) {
          logger.debug("Asset metadata cached", { tokenAddress });
          return;
        }
      }

      const [issuer, code] = tokenAddress.split(":");
      if (!issuer || !code) return;

      // Get home domain
      const homeDomain = await this.getHomeDomain(issuer);
      if (!homeDomain) {
        logger.warn("No home domain found", { issuer });
        return;
      }

      // Fetch stellar.toml
      const toml = await this.fetchStellarToml(homeDomain);
      if (!toml?.CURRENCIES) {
        logger.warn("No CURRENCIES in stellar.toml", { homeDomain });
        return;
      }

      // Find matching currency
      const currency = toml.CURRENCIES.find((c) => c.code === code && c.issuer === issuer);
      if (!currency) {
        logger.warn("Currency not found in stellar.toml", { code, issuer });
        return;
      }

      // Store metadata
      await prisma.asset.upsert({
        where: { tokenAddress },
        update: {
          name: currency.name,
          symbol: currency.code,
          imageUrl: currency.image,
          decimals: currency.display_decimals || 7,
          homeDomain,
          isVerified: true,
          lastFetchedAt: new Date(),
        },
        create: {
          tokenAddress,
          homeDomain,
          name: currency.name,
          symbol: currency.code,
          imageUrl: currency.image,
          decimals: currency.display_decimals || 7,
          isVerified: true,
          lastFetchedAt: new Date(),
        },
      });

      logger.info("Asset metadata discovered", { tokenAddress, name: currency.name });
    } catch (error) {
      logger.error("Failed to discover asset", { tokenAddress, error });
    }
  }

  /**
   * Batch discover assets from new streams
   */
  async discoverNewAssets(): Promise<void> {
    try {
      // Get assets from streams that don't have metadata yet
      const streams = await prisma.stream.findMany({
        where: {
          tokenAddress: { not: null },
          status: "ACTIVE",
        },
        select: { tokenAddress: true },
        distinct: ["tokenAddress"],
      });

      const assetAddresses = streams
        .map((s) => s.tokenAddress)
        .filter((a) => a !== null) as string[];

      for (const assetAddress of assetAddresses) {
        await this.discoverAsset(assetAddress);
      }

      logger.info("Asset discovery batch completed", { count: assetAddresses.length });
    } catch (error) {
      logger.error("Failed to discover new assets", error);
    }
  }

  /**
   * Get asset metadata
   */
  async getAssetMetadata(tokenAddress: string) {
    try {
      return await prisma.asset.findUnique({
        where: { tokenAddress },
      });
    } catch (error) {
      logger.error("Failed to get asset metadata", { tokenAddress, error });
      return null;
    }
  }
}
