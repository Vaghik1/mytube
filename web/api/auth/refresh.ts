// Get a fresh access token using the stored refresh token.
import { creds, googlePost, json, readBody } from '../_google';

export async function POST(req: Request) {
  try {
    const { id, secret } = creds();
    const { refresh_token } = await readBody(req);
    if (!refresh_token) return json({ error: 'missing_refresh_token' }, 400);
    const { status, data } = await googlePost('https://oauth2.googleapis.com/token', {
      client_id: id,
      client_secret: secret,
      refresh_token,
      grant_type: 'refresh_token',
    });
    return json(data, status);
  } catch (e) {
    return json({ error: 'server_config', error_description: String((e as Error).message) }, 500);
  }
}
