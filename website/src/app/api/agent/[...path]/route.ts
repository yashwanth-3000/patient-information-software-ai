/**
 * Server-side proxy to the patient-information-software-ai agent backend on Vultr.
 *
 * The website is served over HTTPS (Vercel) while the Vultr agent backend
 * speaks plain HTTP (the legacy clinic PIS requires it). Browsers block
 * mixed-content requests, so every call goes through this route handler,
 * which runs server-side where plain HTTP is allowed. SSE streams are
 * piped through untouched.
 */

import { NextRequest } from "next/server";

const BACKEND = (process.env.AGENT_BACKEND_URL || "http://65.20.78.208:8000").replace(/\/$/, "");

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function forward(request: NextRequest, path: string[]): Promise<Response> {
  const target = `${BACKEND}/api/${path.join("/")}${request.nextUrl.search}`;
  const upstream = await fetch(target, {
    method: request.method,
    headers: {
      "content-type": request.headers.get("content-type") ?? "",
      accept: request.headers.get("accept") ?? "*/*",
    },
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    // @ts-expect-error duplex is required by Node fetch when streaming a body
    duplex: "half",
    cache: "no-store",
  });

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("cache-control", "no-cache, no-transform");

  return new Response(upstream.body, { status: upstream.status, headers });
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forward(request, path);
}
