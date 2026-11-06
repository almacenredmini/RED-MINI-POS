/**
 * Reduce la foto a un tamaño razonable antes de guardarla en IndexedDB.
 * Una foto de celular (3–5 MB) queda en ~30–60 KB: miles de productos entran sin problema
 * y la subida futura al storage gratuito no agota la cuota.
 */
export async function compressImage(file: Blob, maxSide = 512, quality = 0.8): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas no disponible');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo comprimir la imagen'))), 'image/webp', quality);
  });
}
