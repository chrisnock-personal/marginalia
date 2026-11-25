/** Extensions treated as images by the asset browser and asset endpoints. */
export const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSION.test(path)
}
