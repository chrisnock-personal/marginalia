import { checkRelativePath } from '../shared/paths'

export interface NewMarkdownFile {
  path: string
  content: string
  title: string
}

/** Normalize the New file dialog's name/folder into an unpublished document. */
export function newMarkdownFile(name: string, folder: string): NewMarkdownFile {
  const trimmedName = name.trim()
  if (!trimmedName) throw new Error('Enter a file name')
  if (trimmedName.includes('/') || trimmedName.includes('\\')) {
    throw new Error('Use the folder field for subfolders')
  }

  // Only a trailing dot-word counts as an extension, so "release-1.2" becomes
  // release-1.2.md rather than being rejected.
  const extension = trimmedName.match(/\.([a-z][a-z0-9]*)$/i)?.[1]
  let fileName = trimmedName
  if (extension) {
    if (!/^(md|markdown)$/i.test(extension)) {
      throw new Error('Only .md and .markdown files can be created')
    }
  } else {
    fileName += '.md'
  }

  const cleanFolder = folder.trim().replace(/^\.\//, '').replace(/\/+$/, '')
  const path = cleanFolder ? `${cleanFolder}/${fileName}` : fileName
  checkRelativePath(path)

  const stem = fileName.replace(/\.(md|markdown)$/i, '')
  const words = stem.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled'
  const title = words.charAt(0).toUpperCase() + words.slice(1)
  return { path, content: `# ${title}\n\n`, title }
}
