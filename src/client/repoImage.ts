import Image, { type ImageOptions } from '@tiptap/extension-image'

export interface RepoImageOptions extends ImageOptions {
  /** Turn a repo-relative Markdown src into a URL the browser can load. */
  resolveSrc: (src: string) => string
}

// Images staged in this session are not in the repo yet, so preview them from
// object URLs until the PR is published.
const previews = new Map<string, string>()

export function setImagePreview(src: string, url: string): void {
  previews.set(src, url)
}

export function clearImagePreviews(): void {
  for (const url of previews.values()) URL.revokeObjectURL(url)
  previews.clear()
}

/**
 * Markdown keeps repo-relative paths (`assets/photo.png`), but the editor runs
 * on a different origin from the repo. This node leaves `src` untouched for
 * Markdown serialization and only changes the rendered <img src>.
 */
const RepoImage = Image.extend<RepoImageOptions>({
  addOptions(): RepoImageOptions {
    return {
      inline: false,
      allowBase64: false,
      HTMLAttributes: {},
      resize: false,
      resolveSrc: (src) => src,
    }
  },

  renderHTML({ HTMLAttributes }) {
    const src = typeof HTMLAttributes.src === 'string' ? HTMLAttributes.src : ''
    return [
      'img',
      { ...HTMLAttributes, src: previews.get(src) ?? this.options.resolveSrc(src) },
    ]
  },
})

export default RepoImage
