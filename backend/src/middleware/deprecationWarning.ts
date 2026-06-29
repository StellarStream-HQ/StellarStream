import type { NextFunction, Request, Response } from "express";

export const V1_SUNSET_DATE = "Thu, 01 Oct 2026 00:00:00 GMT";
export const V1_DEPRECATION_DATE = "@1782691200";
export const V1_MIGRATION_GUIDE_URL =
  "https://github.com/StellarStream-HQ/StellarStream/blob/main/docs/V1_MIGRATION_GUIDE.md";
export const V1_DEPRECATION_TIMELINE_URL =
  "https://github.com/StellarStream-HQ/StellarStream/blob/main/DEPRECATION_TIMELINE.md";

const V1_DEPRECATION_MESSAGE =
  "StellarStream API v1 is deprecated and will sunset on 2026-10-01. " +
  "Migrate to v3 endpoints where available; use documented bridge paths where V3 parity is not yet available. " +
  "See docs/V1_MIGRATION_GUIDE.md.";

export function v1DeprecationWarning(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("Deprecation", V1_DEPRECATION_DATE);
  res.setHeader("Sunset", V1_SUNSET_DATE);
  res.setHeader(
    "Link",
    [
      `<${V1_DEPRECATION_TIMELINE_URL}>; rel="deprecation"; type="text/markdown"`,
      `<${V1_MIGRATION_GUIDE_URL}>; rel="successor-version"; type="text/markdown"`,
    ].join(", "),
  );
  res.setHeader("Warning", `299 - "${V1_DEPRECATION_MESSAGE}"`);
  res.setHeader("X-StellarStream-API-Deprecation", V1_DEPRECATION_MESSAGE);
  next();
}
