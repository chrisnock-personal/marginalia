/** Repo-relative path checks shared by the client and the git providers. */
export function checkRelativePath(path: string): string {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\0') ||
    path.includes('\\') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Invalid relative path: ${path}`)
  }
  return path
}
