// Step 1 of TV sign-in: ask Google for a code to show on screen.
import { SCOPE, creds, googlePost, json } from '../_google';

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
