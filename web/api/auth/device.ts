// Step 1 of TV sign-in: ask Google for a code to show on screen.
// Helpers are inlined so each function is fully self-contained.
// Shared helpers for the sign-in endpoints. Files starting with "_" are not routes.
// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set in Vercel → Project → Settings → Environment Variables.

const SCOPE = 'https://www.googleapis.com/auth/youtube';

function creds() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in Vercel');
  return { id, secret };
}

async function googlePost(url: string, params: Record<string, string>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function readBody(req: Request): Promise<Record<string, string>> {
  try {
    return (await req.json()) as Record<string, string>;
  } catch {
    return {};
  }
}


export async function POST() {
  try {
    const { id } = creds();
    const { status, data } = await googlePost('https://oauth2.googleapis.com/device/code', {
      client_id: id,
      scope: SCOPE,
    });
    return json(data, status);
  } catch (e) {
    return json({ error: 'server_config', error_description: String((e as Error).message) }, 500);
  }
}
