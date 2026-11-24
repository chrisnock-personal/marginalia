import type { FileEntry, PublishRequest, PublishResult, RepoSummary } from '../../shared/types'
import { DEFAULT_COMMENTS_PATH, serializeComments } from '../../shared/comments'
import { checkBranch, checkRelativePath, type GitProvider } from './types'

interface GitHubRepo {
  name: string
  full_name: string
  description: string | null
  default_branch: string
}

interface GitHubTreeEntry {
  path: string
  type: 'blob' | 'tree' | 'commit'
  sha: string
}

interface RefResponse {
  object: { sha: string }
}

interface CommitResponse {
  sha: string
  tree: { sha: string }
}

interface BlobResponse {
  sha: string
}

interface PullResponse {
  html_url: string
}

/** GitHub REST provider. The PAT is supplied by a getter so it can be updated at runtime. */
export class GitHubProvider implements GitProvider {
  readonly id = 'github' as const

  constructor(
    private readonly getToken: () => string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async api<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken()
    if (!token) throw new Error('GitHub PAT is not configured')
    const response = await this.fetchImpl(`https://api.github.com${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...options.headers,
      },
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`GitHub ${path}: ${response.status} ${detail.slice(0, 300)}`)
    }
    return (await response.json()) as T
  }

  private async raw(path: string): Promise<string | null> {
    const response = await this.fetchImpl(`https://api.github.com${path}`, {
      headers: {
        Accept: 'application/vnd.github.raw+json',
        Authorization: `Bearer ${this.getToken()}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`GitHub ${path}: ${response.status}`)
    return response.text()
  }

  private static encoded(repo: string): string {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`Invalid repo id: ${repo}`)
    return repo.split('/').map(encodeURIComponent).join('/')
  }

  private static encodedPath(path: string): string {
    return checkRelativePath(path)
      .split('/')
      .map(encodeURIComponent)
      .join('/')
  }

  async whoAmI(): Promise<{ login: string }> {
    return this.api<{ login: string }>('/user')
  }

  async listRepos(): Promise<RepoSummary[]> {
    const repos = await this.api<GitHubRepo[]>(
      '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member',
    )
    return repos.map((repo) => ({
      provider: 'github',
      id: repo.full_name,
      fullName: repo.full_name,
      description: repo.description ?? undefined,
      defaultBranch: repo.default_branch,
    }))
  }

  private async defaultBranch(repo: string): Promise<string> {
    const metadata = await this.api<GitHubRepo>(`/repos/${GitHubProvider.encoded(repo)}`)
    return metadata.default_branch
  }

  async listMarkdownFiles(repo: string, ref?: string): Promise<FileEntry[]> {
    const base = `/repos/${GitHubProvider.encoded(repo)}`
    const branch = ref ?? (await this.defaultBranch(repo))
    const tree = await this.api<{ tree: GitHubTreeEntry[] }>(
      `${base}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    )
    return tree.tree
      .filter((entry) => entry.type === 'blob' && /\.(md|markdown)$/i.test(entry.path))
      .map((entry) => ({ path: entry.path, type: 'blob' as const }))
  }

  async readFile(repo: string, path: string, ref?: string): Promise<string | null> {
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : ''
    return this.raw(
      `/repos/${GitHubProvider.encoded(repo)}/contents/${GitHubProvider.encodedPath(path)}${query}`,
    )
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    const base = `/repos/${GitHubProvider.encoded(request.repo)}`
    const branch = checkBranch(request.branch)

    const baseRef = request.baseRef ?? (await this.defaultBranch(request.repo))
    const commentsPath = checkRelativePath(request.commentsPath ?? DEFAULT_COMMENTS_PATH)
    const changes = new Map(
      [
        ...request.files.map((file) => [checkRelativePath(file.path), file.content] as const),
        [commentsPath, serializeComments(request.comments)] as const,
      ],
    )

    const baseCommit = await this.api<RefResponse>(`${base}/git/ref/heads/${encodeURIComponent(baseRef)}`)
    const baseSha = baseCommit.object.sha
    const commit = await this.api<CommitResponse>(`${base}/git/commits/${baseSha}`)

    const entries: Array<{ path: string; mode: string; type: string; sha: string }> = []
    for (const [path, content] of changes) {
      const blob = await this.api<BlobResponse>(`${base}/git/blobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: Buffer.from(content, 'utf8').toString('base64'), encoding: 'base64' }),
      })
      entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha })
    }

    const tree = await this.api<{ sha: string }>(`${base}/git/trees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_tree: commit.tree.sha, tree: entries }),
    })
    const created = await this.api<{ sha: string }>(`${base}/git/commits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: request.commitMessage, tree: tree.sha, parents: [baseSha] }),
    })
    await this.api(`${base}/git/refs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: created.sha }),
    })

    const notes = [`Published ${changes.size} file(s) to branch ${branch}`]
    let prUrl: string | undefined
    if (request.pr) {
      const pr = await this.api<PullResponse>(`${base}/pulls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: request.pr.title,
          body: request.pr.body,
          head: branch,
          base: baseRef,
        }),
      })
      prUrl = pr.html_url
    } else {
      notes.push('No PR title was supplied; only the branch was created')
    }
    return { branch, commit: created.sha, pushed: true, prUrl, notes }
  }
}
