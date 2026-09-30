import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import type { Attachment } from '../types';

const BUCKET = 'media';
export const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 90;
const MAX_GIF_BYTES = 8 * 1024 * 1024;
const IMAGE_MAX_SIDE = 1600;

// ---------- Signed URLs (private bucket), batched and cached ----------
const cache = new Map<string, { url: string; until: number }>();
const waiting = new Map<string, ((url: string | null) => void)[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  flushTimer = null;
  const paths = [...waiting.keys()];
  const callbacks = new Map(waiting);
  waiting.clear();
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
  const byPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  for (const p of paths) {
    const url = byPath.get(p) ?? null;
    if (url) cache.set(p, { url, until: Date.now() + 50 * 60 * 1000 });
    for (const cb of callbacks.get(p) ?? []) cb(url);
  }
}

export function signedUrl(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit && hit.until > Date.now()) return Promise.resolve(hit.url);
  return new Promise((resolve) => {
    waiting.set(path, [...(waiting.get(path) ?? []), resolve]);
    if (!flushTimer) flushTimer = setTimeout(flush, 30);
  });
}

/** Signed URL for a stored file; null while loading or when missing. */
export function useSignedUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => {
    const hit = path ? cache.get(path) : undefined;
    return hit && hit.until > Date.now() ? hit.url : null;
  });
  useEffect(() => {
    let alive = true;
    if (!path) {
      setUrl(null);
      return;
    }
    signedUrl(path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path]);
  return url;
}

// ---------- Uploads ----------
function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('לא הצלחנו לקרוא את התמונה'));
    img.src = URL.createObjectURL(file);
  });
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('שגיאה בעיבוד התמונה'))), 'image/jpeg', quality),
  );
}

/** Resizes a photo to at most 1600px and re-encodes it, which also drops location metadata. */
async function shrinkImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await loadImage(file);
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
  URL.revokeObjectURL(img.src);
  return { blob: await toJpeg(canvas, 0.82), width, height };
}

function videoInfo(file: File): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      resolve({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
      URL.revokeObjectURL(v.src);
    };
    v.onerror = () => reject(new Error('לא הצלחנו לקרוא את הסרטון'));
    v.src = URL.createObjectURL(file);
  });
}

async function put(path: string, body: Blob, contentType: string) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType, upsert: false });
  if (error) throw new Error(error.message.includes('exceeded') ? 'הקובץ גדול מדי' : 'ההעלאה נכשלה. נסה שוב.');
}

/** Validates, shrinks (photos) and uploads a chat attachment. Throws a Hebrew message on failure. */
export async function uploadAttachment(file: File): Promise<Attachment> {
  const id = crypto.randomUUID();
  if (file.type === 'image/gif') {
    if (file.size > MAX_GIF_BYTES) throw new Error('קובץ ה-GIF גדול מדי (עד 8MB)');
    const img = await loadImage(file);
    const path = `m/${id}.gif`;
    await put(path, file, 'image/gif');
    return { type: 'image', path, width: img.naturalWidth, height: img.naturalHeight, size: file.size };
  }
  if (file.type.startsWith('image/')) {
    const { blob, width, height } = await shrinkImage(file);
    const path = `m/${id}.jpg`;
    await put(path, blob, 'image/jpeg');
    return { type: 'image', path, width, height, size: blob.size };
  }
  if (file.type.startsWith('video/')) {
    if (file.size > MAX_VIDEO_BYTES) throw new Error('הסרטון גדול מדי. אפשר להעלות סרטונים עד 20MB.');
    const info = await videoInfo(file);
    if (info.duration > MAX_VIDEO_SECONDS) throw new Error('הסרטון ארוך מדי. אפשר להעלות סרטונים עד דקה וחצי.');
    const ext = file.type === 'video/webm' ? 'webm' : file.type === 'video/quicktime' ? 'mov' : 'mp4';
    const path = `m/${id}.${ext}`;
    await put(path, file, file.type || 'video/mp4');
    return { type: 'video', path, ...info, size: file.size };
  }
  throw new Error('אפשר לצרף רק תמונות וסרטונים');
}

/** Square-crops and uploads a profile photo; returns the stored path. */
export async function uploadAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('יש לבחור קובץ תמונה');
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.min(512, side);
  canvas
    .getContext('2d')!
    .drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  const path = `a/${crypto.randomUUID()}.jpg`;
  await put(path, await toJpeg(canvas, 0.86), 'image/jpeg');
  return path;
}
