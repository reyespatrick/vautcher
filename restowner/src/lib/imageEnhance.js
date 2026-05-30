// imageEnhance.js — client-side polish for owner-uploaded photos.
//
// Restaurateurs shoot dishes on phones in sub-optimal light; the raw
// upload often looks dull next to the professionally lit hero shots
// scraped from the source site. This helper runs every upload through
// a Canvas pass that:
//   1. Auto-orients from EXIF (so iPhone portraits don't land sideways).
//   2. Caps max dimension at 2000 px — overkill resolution wastes
//      Supabase Storage bandwidth and the diner UI never paints larger.
//   3. Applies a small "vivid" filter (+12% saturation, +6% contrast,
//      +2% brightness) when ctx.filter is supported. Subtle on purpose:
//      we want polish, not Instagram.
//   4. Re-encodes as JPEG q=0.9 for predictable file sizes and to drop
//      EXIF metadata along the way.
//
// SVGs, GIFs, animated images and files that can't be bitmap-decoded
// fall through unchanged so we never silently break a transparent or
// animated asset.
const MAX_DIM = 2000
const QUALITY = 0.9

export async function enhanceImage(file) {
  if (!file || !/^image\//.test(file.type)) return file
  // Leave vector + animated images alone — Canvas would flatten them.
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return file

  try {
    // imageOrientation:'from-image' applies the EXIF orientation up-front
    // so we don't have to decode it ourselves.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const ratio = Math.min(MAX_DIM / bitmap.width, MAX_DIM / bitmap.height, 1)
    const w = Math.max(1, Math.round(bitmap.width * ratio))
    const h = Math.max(1, Math.round(bitmap.height * ratio))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file

    // Canvas filter — supported in iOS Safari 17+, all modern desktop
    // browsers. When absent (old WebViews) the image still benefits
    // from EXIF auto-orient + size cap + JPEG re-encode below.
    if ('filter' in ctx) {
      ctx.filter = 'saturate(1.12) contrast(1.06) brightness(1.02)'
    }
    ctx.drawImage(bitmap, 0, 0, w, h)

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
    if (!blob) return file

    // Force a .jpg extension so the storage upload's content-type
    // matches the actual bytes; otherwise a HEIC source uploaded as
    // .HEIC would have its content-type mis-set by the storage SDK.
    const baseName = (file.name || 'photo').replace(/\.[^./\\]+$/, '')
    return new File([blob], `${baseName}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now()
    })
  } catch {
    return file
  }
}
