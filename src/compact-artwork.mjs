import sharp from 'sharp';

const formats = new Map([['image/jpeg', 'jpeg'], ['image/png', 'png'], ['image/webp', 'webp']]);
const MAX_DIMENSION = 8192;
const MAX_PIXELS = 16 * 1024 * 1024;

// Keep decoded images out of libvips' global cache; only compact results are retained.
sharp.cache(false);
sharp.concurrency(1);

export async function compactArtwork(bytes, contentType) {
  const format = formats.get(contentType);
  if (!format) throw new Error('Unsupported artwork format');
  const image = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'warning', sequentialRead: true }).timeout({ seconds: 2 });
  const metadata = await image.metadata();
  if (metadata.format !== format || !metadata.width || !metadata.height || metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION ||
    metadata.width * metadata.height > MAX_PIXELS || (metadata.pages ?? 1) > 1) throw new Error('Invalid artwork dimensions or format');
  // Match the key's existing xMidYMid slice crop, without stretching the source.
  image.rotate().resize(144, 144, { fit: 'cover', position: 'centre' });
  if (format === 'jpeg') image.jpeg({ quality: 85, chromaSubsampling: '4:4:4' });
  else if (format === 'png') image.png({ compressionLevel: 6 });
  else image.webp({ quality: 85, alphaQuality: 100, effort: 3 });
  return { bytes: await image.toBuffer(), contentType };
}
