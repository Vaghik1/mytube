// Shared helpers for the sign-in endpoints. Files starting with "_" are not routes.
// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set in Vercel → Project → Settings → Environment Variables.

export const SCOPE = 'https://www.googleapis.com/auth/youtube';

export function creds() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in Vercel');
  return { id, secret };
}

export async function googlePost(url: string, params: Record<string, string>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function readBody(req: Request): Promise<Record<string, string>> {
  try {
    return (await req.json()) as Record<string, string>;
  } catch {
    return {};
  }
}
