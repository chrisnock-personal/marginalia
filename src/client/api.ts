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

  head: (provider: ProviderId, repo: string, ref?: string) =>
    request<{ sha: string }>(
      `${repoPath(provider, repo)}/head${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`,
    ),

  /** Browser URL for a repo-relative asset (images), used as an <img src>. */
  assetSrc: (provider: ProviderId, repo: string, assetPath: string, ref?: string) =>
    `/api${repoPath(provider, repo)}/asset?path=${encodeURIComponent(assetPath)}${
      ref ? `&ref=${encodeURIComponent(ref)}` : ''
    }`,

  files: (provider: ProviderId, repo: string, ref?: string) =>
    request<FileEntry[]>(
      `${repoPath(provider, repo)}/files${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`,
    ),

  assets: (provider: ProviderId, repo: string, ref?: string) =>
    request<FileEntry[]>(
      `${repoPath(provider, repo)}/assets${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`,
    ),

  /** Read raw asset bytes as base64, for moving/renaming an existing image. */
  async assetBase64(provider: ProviderId, repo: string, assetPath: string, ref?: string): Promise<string> {
    const response = await fetch(api.assetSrc(provider, repo, assetPath, ref))
    if (!response.ok) throw new Error(`Could not read asset ${assetPath} (HTTP ${response.status})`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return btoa(binary)
  },

  file: (provider: ProviderId, repo: string, path: string, ref?: string) =>
    request<{ path: string; content: string }>(
      `${repoPath(provider, repo)}/file?path=${encodeURIComponent(path)}${
        ref ? `&ref=${encodeURIComponent(ref)}` : ''
      }`,
    ),

  async comments(provider: ProviderId, repo: string, ref?: string, path = 'comments.json'): Promise<CommentsFile> {
    try {
      const file = await this.file(provider, repo, path, ref)
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

  oauthUrl: () => request<{ url: string }>('/auth/github/url'),
}
