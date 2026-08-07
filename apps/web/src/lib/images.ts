import { MAX_IMAGE_BYTES } from "@workspace/shared"

/** Longest edge after downscaling. Enough detail for a screenshot, small enough to store inline. */
const MAX_EDGE = 1400
const QUALITY = 0.82

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"]

/**
 * Downscale and re-encode an image to a data URL.
 *
 * Done on the client so a 12 MP phone photo never crosses the wire or lands in a database row.
 * GIFs are passed through untouched — re-encoding one through a canvas would silently drop
 * the animation and keep only the first frame.
 */
export async function toDataUrl(file: File): Promise<string> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(`${file.name || "That file"} is not a PNG, JPEG, WebP or GIF.`)
  }

  if (file.type === "image/gif") {
    const raw = await readAsDataUrl(file)
    if (raw.length > MAX_IMAGE_BYTES) throw new Error("That GIF is too large — keep it under 1 MB.")
    return raw
  }

  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext("2d")
  if (!context) throw new Error("Could not process that image.")
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  // PNGs with transparency would get a black background as JPEG, so keep them as PNG.
  const type = file.type === "image/png" ? "image/png" : "image/jpeg"
  const dataUrl = canvas.toDataURL(type, QUALITY)

  if (dataUrl.length > MAX_IMAGE_BYTES) {
    throw new Error("That image is too detailed to attach — try cropping it first.")
  }
  return dataUrl
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error("Could not read that file."))
    reader.readAsDataURL(file)
  })
}
