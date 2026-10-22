// Didit returns presigned media URLs that expire (about an hour). Download once and store privately;
// Document.file_url then holds the private file_uri (opened through a signed URL in the app).
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** Returns the private file_uri, or null when the image could not be fetched or stored (caller retries later). */
export async function rehostDiditImage(base44, url, fileName) {
  const src = String(url || '');
  if (!/^https:\/\//i.test(src)) return null;
  try {
    const res = await fetch(src, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) { console.warn('rehostDiditImage: download failed', res.status); return null; }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) { console.warn('rehostDiditImage: bad size', buf.byteLength); return null; }
    const type = res.headers.get('content-type') || 'image/jpeg';
    const up = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: new File([buf], fileName, { type }) });
    return up?.file_uri || null;
  } catch (e) {
    console.warn('rehostDiditImage: failed', e?.message || e);
    return null;
  }
}
