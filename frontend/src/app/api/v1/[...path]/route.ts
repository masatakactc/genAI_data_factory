const BACKEND_URL =
  "https://genai-data-factory-api-622188047085.asia-northeast1.run.app";

async function handler(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const url = new URL(request.url);
  const target = `${BACKEND_URL}/api/v1/${path.join("/")}${url.search}`;

  const headers = new Headers(request.headers);
  headers.delete("host");

  const apiKey = process.env.WANDB_API_KEY;
  if (apiKey) {
    headers.set("X-Wandb-Api-Key", apiKey);
  }

  const res = await fetch(target, {
    method: request.method,
    headers,
    body: request.method !== "GET" && request.method !== "HEAD"
      ? await request.arrayBuffer()
      : undefined,
  });

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
