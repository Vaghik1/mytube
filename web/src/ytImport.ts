// Import what you watched in YouTube itself, from a Google Takeout download.
// YouTube doesn't let apps read your watch history, but Google lets you download it:
// takeout.google.com → only "YouTube and YouTube Music" → only "history" → format JSON.
// The .zip (or the watch-history.json inside it) is read here, on the device; nothing is uploaded.
import { importWatches } from './history';

export type ImportedWatch = { id: string; ch: string; cht: string; title: string; t: number };

/** "Watched …" in a few languages (Takeout writes the title that way). */
const WATCHED_PREFIX = /^(watched|вы посмотрели|просмотрено|посмотрели)\s*:?\s+/i;

/** Turns Takeout's watch-history.json into watches. Skips ads, YouTube Music and removed videos. */
export function parseTakeout(json: unknown): ImportedWatch[] {
  if (!Array.isArray(json)) throw new Error("This isn't a YouTube watch history file.");
  const out: ImportedWatch[] = [];
  for (const e of json as any[]) {
    if (!e || e.header !== 'YouTube') continue; // "YouTube Music" and others
    if ((e.details || []).some((d: any) => /ads/i.test(String(d?.name)))) continue; // ads you were shown
    const id = String(e.titleUrl || '').match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1];
    const sub = (e.subtitles || [])[0];
    const ch = String(sub?.url || '').match(/channel\/(UC[A-Za-z0-9_-]{22})/)?.[1];
    const t = Date.parse(e.time);
    if (!id || !ch || !Number.isFinite(t)) continue; // removed or private videos have no link/channel
    out.push({ id, ch, cht: String(sub.name || ''), title: String(e.title || '').replace(WATCHED_PREFIX, ''), t });
  }
  return out;
}

// ── a small .zip reader (no library): finds one file and inflates it with the browser's own decoder ──

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(data.slice() as Uint8Array<ArrayBuffer>).body!.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Extracts the first file whose name ends with `suffix` from a .zip, or null. */
export async function unzipFile(zip: Uint8Array, suffix: string): Promise<Uint8Array | null> {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--)
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("Couldn't read this .zip file.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count && dv.getUint32(p, true) === 0x02014b50; n++) {
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(zip.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!name.toLowerCase().endsWith(suffix)) continue;
    if (size === 0xffffffff || local === 0xffffffff) throw new Error('This .zip is too large; unzip it and choose watch-history.json.');
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = zip.subarray(start, start + size);
    if (method === 0) return data;
    if (method === 8) return inflate(data);
    throw new Error('Unsupported .zip compression; unzip it and choose watch-history.json.');
  }
  return null;
}

/** Reads a Takeout .zip or watch-history.json and adds the watches. Returns how many were added. */
export async function importTakeoutFile(file: Blob & { name?: string }): Promise<{ found: number; added: number }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
  let text: string;
  if (isZip) {
    const json = await unzipFile(bytes, 'watch-history.json');
    if (!json) {
      const html = await unzipFile(bytes, 'watch-history.html');
      throw new Error(
        html
          ? 'This download is in HTML format. In Google Takeout, choose "Multiple formats" → History: JSON, and download again.'
          : 'No YouTube watch history in this .zip (watch-history.json).',
      );
    }
    text = new TextDecoder().decode(json);
  } else {
    text = new TextDecoder().decode(bytes);
    if (/^\s*</.test(text)) throw new Error('This file is HTML. In Google Takeout, choose "Multiple formats" → History: JSON.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("This isn't a YouTube watch history file.");
  }
  const watches = parseTakeout(parsed);
  return { found: watches.length, added: importWatches(watches) };
}
