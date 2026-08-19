import { NextResponse } from "next/server";
import { generateMockAnalytics } from "@/lib/analytics/mock-data";
export type { AnalyticsDashboardResponse } from "@/lib/analytics/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") ?? "30d"; // 7d | 30d | 90d | 1y
  const asset = searchParams.get("asset") ?? "ALL"; // ALL | XLM | USDC | PYUSD

  const backendUrl = process.env.BACKEND_URL;

  if (backendUrl && !backendUrl.includes("localhost:3000")) {
    try {
      const backendRes = await fetch(
        `${backendUrl}/api/v1/analytics/dashboard?range=${encodeURIComponent(range)}&asset=${encodeURIComponent(asset)}`,
        { cache: "no-store", signal: AbortSignal.timeout(1500) }
      );
      if (backendRes.ok) {
        const data = await backendRes.json();
        return NextResponse.json(data);
      }
    } catch (error) {
      console.warn(
        "[analytics/dashboard] Backend unreachable or request timed out, serving fallback analytics data:",
        error instanceof Error ? error.message : error
      );
    }
  }

  const mockData = generateMockAnalytics(range, asset);
  return NextResponse.json({ success: true, data: mockData });
}
