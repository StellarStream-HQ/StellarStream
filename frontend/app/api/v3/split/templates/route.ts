import { NextRequest, NextResponse } from "next/server";

// app/api/v3/split/templates/route.ts
// Issue #783 / #1185 — Split-Template Library API
//
// Proxies template CRUD to the backend template service.

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3001";

export interface SplitTemplateRecipient {
  address: string;
  percentage: number;
}

export interface SplitTemplate {
  id: string;
  name: string;
  recipients: SplitTemplateRecipient[];
  createdAt: string;
}

export interface SaveTemplatePayload {
  name: string;
  recipients: SplitTemplateRecipient[];
}

export interface StreamTemplateResponse {
  id: string;
  name: string;
  asset: string;
  recipientAddress: string;
  splitEnabled: boolean;
  splitAddress: string | null;
  splitPercent: number;
  totalAmount: string;
  rateType: string;
  durationPreset: string;
  usageCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * GET /api/v3/split/templates?createdBy=G...
 * Proxy to backend: lists templates, optionally filtered by user.
 */
export async function GET(req: NextRequest) {
  const createdBy = req.nextUrl.searchParams.get("createdBy");

  const url = createdBy
    ? `${BACKEND}/api/v3/templates?createdBy=${encodeURIComponent(createdBy)}`
    : `${BACKEND}/api/v3/templates`;

  const upstream = await fetch(url).catch(() => null);

  if (!upstream) {
    return NextResponse.json({ error: "Backend unavailable." }, { status: 502 });
  }

  const body = await upstream.json();
  return NextResponse.json(body, { status: upstream.status });
}

/**
 * POST /api/v3/split/templates
 * Proxy to backend: creates a new stream template.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();

  // Forward the create template payload to backend
  const upstream = await fetch(`${BACKEND}/api/v3/templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);

  if (!upstream) {
    return NextResponse.json({ error: "Backend unavailable." }, { status: 502 });
  }

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}

/**
 * PUT /api/v3/split/templates?id=...
 * Proxy to backend: updates an existing template.
 */
export async function PUT(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Query param 'id' is required." }, { status: 400 });
  }

  const body = await req.json();

  const upstream = await fetch(`${BACKEND}/api/v3/templates/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);

  if (!upstream) {
    return NextResponse.json({ error: "Backend unavailable." }, { status: 502 });
  }

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}

/**
 * DELETE /api/v3/split/templates?id=...
 * Proxy to backend: deletes a template.
 */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Query param 'id' is required." }, { status: 400 });
  }

  const upstream = await fetch(`${BACKEND}/api/v3/templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }).catch(() => null);

  if (!upstream) {
    return NextResponse.json({ error: "Backend unavailable." }, { status: 502 });
  }

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
