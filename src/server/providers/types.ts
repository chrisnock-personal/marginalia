import type {
  CommentsFile,
  FileEntry,
  ProviderId,
  PublishRequest,
  PublishResult,
  RepoSummary,
} from '../../shared/types'

export interface GitProvider {
  readonly id: ProviderId
  listRepos(): Promise<RepoSummary[]>
  listMarkdownFiles(repo: string, ref?: string): Promise<FileEntry[]>
  listAssets(repo: string, ref?: string): Promise<FileEntry[]>
  /** null when the file does not exist on that ref. */
  readFile(repo: string, path: string, ref?: string): Promise<string | null>
  /** Binary asset (images) for rendering; null when absent. */
  readAsset(repo: string, path: string, ref?: string): Promise<Buffer | null>
  /** Commit SHA at the tip of a ref, used for conflict detection. */
  headSha(repo: string, ref?: string): Promise<string>
  publish(request: PublishRequest): Promise<PublishResult>
}

export function checkBranch(branch: string): string {
  if (
    !branch ||
    branch.length > 150 ||
    !/^[A-Za-z0-9._/-]+$/.test(branch) ||
    branch.startsWith('-') ||
    branch.includes('..') ||
    branch.startsWith('/') ||
    branch.endsWith('/') ||
    branch.includes('//')
  ) {
    throw new Error('Invalid branch name')
  }
  return branch
}

export function checkRelativePath(path: string): string {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\0') ||
    path.split('/').includes('..') ||
    path.split('/').includes('.') ||
    path.includes('\\')
  ) {
    throw new Error(`Invalid relative path: ${path}`)
  }
  return path
}
