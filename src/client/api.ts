import { emptyComments, parseComments } from '../shared/comments'
import type {
  CommentsFile,
  FileEntry,
  ProviderId,
  ProviderInfo,
  PublishRequest,
  PublishResult,
  RepoSummary,
} from '../shared/types'

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(response.status, body.error ?? `HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

const repoPath = (provider: ProviderId, repo: string) =>
  `/repos/${provider}/${encodeURIComponent(repo)}`

export const api = {
  config: () => request<{ providers: ProviderInfo[] }>('/config'),

  repos: (provider: ProviderId) => request<RepoSummary[]>(`/repos?provider=${provider}`),

  files: (provider: ProviderId, repo: string) =>
    request<FileEntry[]>(`${repoPath(provider, repo)}/files`),

  file: (provider: ProviderId, repo: string, path: string) =>
    request<{ path: string; content: string }>(
      `${repoPath(provider, repo)}/file?path=${encodeURIComponent(path)}`,
    ),

  async comments(provider: ProviderId, repo: string, path = 'comments.json'): Promise<CommentsFile> {
    try {
      const file = await this.file(provider, repo, path)
      return parseComments(file.content)
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return emptyComments()
      throw error
    }
  },

  publish: (body: PublishRequest) =>
    request<PublishResult>('/publish', { method: 'POST', body: JSON.stringify(body) }),

  setToken: (token: string) =>
    request<{ configured: boolean; login: string }>('/token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  clearToken: () => request<{ configured: boolean }>('/token', { method: 'DELETE' }),
}
