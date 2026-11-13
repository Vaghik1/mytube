// Step 2 of TV sign-in: poll until the user has entered the code on their phone.
import { creds, googlePost, json, readBody } from '../_google';

export async function POST(req: Request) {
  try {
    const { id, secret } = creds();
    const { device_code } = await readBody(req);
    if (!device_code) return json({ error: 'missing_device_code' }, 400);
    const { status, data } = await googlePost('https://oauth2.googleapis.com/token', {
      client_id: id,
      client_secret: secret,
      device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    return json(data, status);
  } catch (e) {
    return json({ error: 'server_config', error_description: String((e as Error).message) }, 500);
  }
}
