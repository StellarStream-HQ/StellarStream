import { prisma } from "../lib/db.js";
import { logger } from "../logger.js";
import fetch from "node-fetch";

interface StellarExpertAccount {
  home_domain?: string;
  history_publickey?: string;
  labels?: Array<{
    label: string;
    category: string;
  }>;
}

interface StellarExpertAsset {
  issuer: string;
  code: string;
  toml?: string;
  verified?: boolean;
}

export class StellarExpertEnrichmentWorker {
  private readonly STELLAR_EXPERT_API = "https://api.stellar.expert/explorer/public";
  private readonly HORIZON_API = "https://horizon.stellar.org";
  private readonly CACHE_TTL = 24 * 60 * 60 * 1000;

  async fetchAccountHomeDomain(issuer: string): Promise<string | null> {
    try {
      const response = await fetch(`${this.HORIZON_API}/accounts/${issuer}`);
      if (!response.ok) return null;

      const data = (await response.json()) as any;
      return data.home_domain || null;
    } catch (error) {
      logger.warn("Failed to fetch account from Horizon", { issuer, error });
      return null;
    }
  }

  async fetchStellarExpertAccount(issuer: string): Promise<StellarExpertAccount | null> {
    try {
      const response = await fetch(`${this.STELLAR_EXPERT_API}/account/${issuer}`);
      if (!response.ok) {
        logger.warn("Stellar-Expert API returned non-OK", { issuer, status: response.status });
        return null;
      }

      return (await response.json()) as StellarExpertAccount;
    } catch (error) {
      logger.warn("Failed to fetch from Stellar-Expert", { issuer, error });
      return null;
    }
  }

  async fetchStellarExpertAsset(issuer: string, code: string): Promise<StellarExpertAsset | null> {
    try {
      const assetIdentifier = `${code}-${issuer}`;
      const response = await fetch(`${this.STELLAR_EXPERT_API}/asset/${assetIdentifier}`);
      if (!response.ok) {
        logger.warn("Stellar-Expert asset API returned non-OK", { issuer, code, status: response.status });
        return null;
      }

      return (await response.json()) as StellarExpertAsset;
    } catch (error) {
      logger.warn("Failed to fetch asset from Stellar-Expert", { issuer, code, error });
      return null;
    }
  }

  async isAccountVerified(issuer: string): Promise<boolean> {
    try {
      const expertData = await this.fetchStellarExpertAccount(issuer);
      if (!expertData?.labels) return false;

      return expertData.labels.some(
        (label) => label.category === "verified" || label.category === "known"
      );
    } catch {
      return false;
    }
  }

  async fetchTomlFromHomeDomain(homeDomain: string): Promise<string | null> {
    try {
      const url = `https://${homeDomain}/.well-known/stellar.toml`;
      const response = await fetch(url, { timeout: 5000 } as any);

      if (!response.ok) return null;

      const text = await response.text();
      const tomlMatch = text.match(/ORG_NAME\s*=\s*"([^"]+)"/);
      if (tomlMatch) {
        return url;
      }
      return null;
    } catch {
      return null;
    }
  }

  async enrichAsset(tokenAddress: string): Promise<void> {
    try {
      const existing = await prisma.asset.findUnique({
        where: { tokenAddress },
      });

      if (existing && existing.lastFetchedAt) {
        const age = Date.now() - existing.lastFetchedAt.getTime();
        if (age < this.CACHE_TTL) {
          logger.debug("Asset enrichment cached", { tokenAddress });
          return;
        }
      }

      const [issuer, code] = tokenAddress.split(":");
      if (!issuer || !code) return;

      const homeDomain = await this.fetchAccountHomeDomain(issuer);
      const expertAsset = await this.fetchStellarExpertAsset(issuer, code);
      const isVerified = await this.isAccountVerified(issuer);
      const tomlUrl = homeDomain ? await this.fetchTomlFromHomeDomain(homeDomain) : null;

      await prisma.asset.upsert({
        where: { tokenAddress },
        update: {
          homeDomain,
          stellarExpertVerified: expertAsset?.verified ?? false,
          tomlUrl,
          orgVerified: isVerified,
          orgHomeDomain: homeDomain,
          isVerified: (isVerified || expertAsset?.verified) ?? false,
          lastFetchedAt: new Date(),
        },
        create: {
          tokenAddress,
          homeDomain,
          stellarExpertVerified: expertAsset?.verified ?? false,
          tomlUrl,
          orgVerified: isVerified,
          orgHomeDomain: homeDomain,
          isVerified: (isVerified || expertAsset?.verified) ?? false,
          symbol: code,
          decimals: 7,
          lastFetchedAt: new Date(),
        },
      });

      logger.info("Asset enriched with Stellar-Expert data", {
        tokenAddress,
        verified: isVerified,
        stellarExpertVerified: expertAsset?.verified,
        homeDomain,
      });
    } catch (error) {
      logger.error("Failed to enrich asset", { tokenAddress, error });
    }
  }

  async enrichBatch(): Promise<void> {
    try {
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
        await this.enrichAsset(assetAddress);
      }

      logger.info("Stellar-Expert enrichment batch completed", { count: assetAddresses.length });
    } catch (error) {
      logger.error("Failed to enrich batch", error);
    }
  }
}
