import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { DEFAULT_COMMENTS_PATH, serializeComments } from '../../shared/comments'
import { isImagePath } from '../../shared/assets'
import type { FileEntry, PublishRequest, PublishResult, RepoSummary } from '../../shared/types'
import { gitHubPullRequest, githubRepoFromRemote, type PullRequestInput } from './github'
import { checkBranch, checkRelativePath, type GitProvider } from './types'

const execFileAsync = promisify(execFile)

export interface LocalGitProviderOptions {
  dryRun?: boolean
  /** Path to a bundled git binary; defaults to `git` on PATH. */
  git?: string
  /** Extra environment needed by a bundled git (dugite's GIT_EXEC_PATH, etc.). */
  env?: NodeJS.ProcessEnv
  /** GitHub token used to open PRs without the `gh` CLI. */
  getToken?: () => string
  fetchImpl?: typeof fetch
  /** Override the GitHub repo when the origin URL is an alias or a local mirror. */
  prRepo?: string
  /** Injectable for tests. */
  createPullRequest?: (input: PullRequestInput) => Promise<string>
}

async function run(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      cwd,
      env: env ? { ...process.env, ...env } : undefined,
      maxBuffer: 16 * 1024 * 1024,
    })
    return stdout.trim()
  } catch (error) {
    const err = error as { stderr?: string; message?: string }
    throw new Error(`${cmd} ${args.slice(0, 2).join(' ')}: ${err.stderr?.trim() || err.message}`)
  }
}

function inside(root: string, relative: string): string {
  const full = resolve(root, checkRelativePath(relative))
  if (full !== root && !full.startsWith(`${root}${sep}`)) throw new Error('Path escapes repo')
  return full
}

/**
 * Fetching must never wait on a credential prompt or a dead remote: the
 * request would hang. Fall back to the local ref instead.
 */
const FETCH_TIMEOUT_MS = 15_000

async function fetchOrigin(root: string, gitCommand: string, env?: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    await execFileAsync(gitCommand, ['fetch', '--quiet', '--no-tags', 'origin'], {
      cwd: root,
      timeout: FETCH_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
    })
    return true
  } catch {
    return false
  }
}

async function commitAt(
  root: string,
  ref: string,
  gitCommand: string,
  env?: NodeJS.ProcessEnv,
): Promise<string | null> {
  try {
    return await run(gitCommand, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], root, env)
  } catch {
    return null
  }
}

/** Same 409 response as the route conflict check, so the client offers a reload. */
function baseChangedError(): Error {
  return Object.assign(
    new Error('Base branch changed since you opened the file. Reload before publishing.'),
    { status: 409 },
  )
}

/**
 * Publishes from a temporary detached worktree, so the user's checkout and
 * uncommitted work are never touched.
 */
export class LocalGitProvider implements GitProvider {
  readonly id = 'local' as const

  constructor(
    private readonly roots: Map<string, string>,
    private readonly options: LocalGitProviderOptions = {},
  ) {}

  private get gitCommand(): string {
    return this.options.git ?? 'git'
  }

  private run(args: string[], cwd: string): Promise<string> {
    return run(this.gitCommand, args, cwd, this.options.env)
  }

  private repoPath(repo: string): string {
    const path = this.roots.get(repo)
    if (!path) throw new Error(`Unknown local repo alias: ${repo}`)
    return path
  }

  async listRepos(): Promise<RepoSummary[]> {
    const repos: RepoSummary[] = []
    for (const [id, path] of this.roots) {
      if (!existsSync(path)) continue
      try {
        await this.run(['rev-parse', '--show-toplevel'], path)
        const defaultBranch = await this.defaultBranch(path)
        repos.push({ provider: 'local', id, fullName: id, defaultBranch })
      } catch {
        // Not a git repository: ignore it.
      }
    }
    return repos
  }

  private async defaultBranch(path: string): Promise<string | undefined> {
    try {
      return await this.run(['symbolic-ref', '--quiet', '--short', 'HEAD'], path)
    } catch {
      return undefined
    }
  }

  /**
   * Fetching updates remote-tracking refs only: the configured checkout and its
   * working tree are never touched. If there is no origin or the fetch fails,
   * the local ref is used as before.
   */
  private async baseCommit(path: string, ref?: string): Promise<string> {
    if (await fetchOrigin(path, this.gitCommand, this.options.env)) {
      const remote = await commitAt(path, `refs/remotes/origin/${ref ?? 'HEAD'}`, this.gitCommand, this.options.env)
      if (remote) return remote
    }
    return this.run(['rev-parse', '--verify', '--end-of-options', `${ref ?? 'HEAD'}^{commit}`], path)
  }

  /**
   * Reads by branch name follow the last-fetched origin branch, matching
   * `baseCommit`, so listings and images show what a publish builds on.
   * SHAs and other refs are used as given.
   */
  private async readRef(path: string, ref: string): Promise<string> {
    return (await commitAt(path, `refs/remotes/origin/${ref}`, this.gitCommand, this.options.env)) ?? ref
  }

  async listMarkdownFiles(repo: string, ref?: string): Promise<FileEntry[]> {
    const path = this.repoPath(repo)
    const output = await this.run(['ls-tree', '-r', '--name-only', ref ? await this.readRef(path, ref) : 'HEAD'], path)
    return output
      .split('\n')
      .filter((entry) => /\.(md|markdown)$/i.test(entry))
      .map((entry) => ({ path: entry, type: 'blob' as const }))
  }

  async listAssets(repo: string, ref?: string): Promise<FileEntry[]> {
    const path = this.repoPath(repo)
    const output = await this.run(['ls-tree', '-r', '--name-only', ref ? await this.readRef(path, ref) : 'HEAD'], path)
    return output
      .split('\n')
      .filter(isImagePath)
      .map((entry) => ({ path: entry, type: 'blob' as const }))
  }

  async readFile(repo: string, path: string, ref?: string): Promise<string | null> {
    const root = this.repoPath(repo)
    if (ref) {
      try {
        // Not `run`: it trims stdout, which would drop the file's final
        // newline and make every publish rewrite the last line.
        const { stdout } = await execFileAsync(
          this.gitCommand,
          ['show', `${await this.readRef(root, ref)}:${checkRelativePath(path)}`],
          {
            cwd: root,
            encoding: 'utf8',
            maxBuffer: 16 * 1024 * 1024,
            env: { ...process.env, ...this.options.env },
          },
        )
        return stdout
      } catch {
        return null
      }
    }
    const full = inside(root, path)
    if (!existsSync(full)) return null
    return readFile(full, 'utf8')
  }

  async readAsset(repo: string, path: string, ref?: string): Promise<Buffer | null> {
    const root = this.repoPath(repo)
    if (ref) {
      try {
        const output = await execFileAsync(
          this.gitCommand,
          ['show', `${await this.readRef(root, ref)}:${checkRelativePath(path)}`],
          {
            cwd: root,
            encoding: 'buffer',
            maxBuffer: 32 * 1024 * 1024,
            env: { ...process.env, ...this.options.env },
          },
        )
        return output.stdout as Buffer
      } catch {
        return null
      }
    }
    const full = inside(root, path)
    if (!existsSync(full)) return null
    return readFile(full)
  }

  async headSha(repo: string, ref?: string): Promise<string> {
    return this.baseCommit(this.repoPath(repo), ref)
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    const root = this.repoPath(request.repo)
    const branch = checkBranch(request.branch)
    const base = await this.baseCommit(root, request.baseRef)
    if (request.baseSha && request.baseSha !== base) throw baseChangedError()

    const commentsPath = checkRelativePath(request.commentsPath ?? DEFAULT_COMMENTS_PATH)
    const changes = [
      ...request.files.map((file) => ({
        path: checkRelativePath(file.path),
        content: file.content,
        encoding: file.encoding ?? ('utf8' as const),
        delete: file.delete === true,
      })),
      {
        path: commentsPath,
        content: serializeComments(request.comments),
        encoding: 'utf8' as const,
        delete: false,
      },
    ]
    const unique = new Map(changes.map((change) => [change.path, change]))

    const worktree = await mkdtemp(join(tmpdir(), 'marginalia-'))
    const notes: string[] = []
    try {
      await this.run(['worktree', 'add', '--detach', worktree, base], root)
      await this.run(['checkout', '-b', branch], worktree)

      for (const [path, change] of unique) {
        const full = inside(worktree, path)
        if (change.delete) {
          await rm(full, { force: true })
          continue
        }
        await mkdir(dirname(full), { recursive: true })
        await writeFile(
          full,
          change.encoding === 'base64' ? Buffer.from(change.content, 'base64') : change.content,
          change.encoding === 'base64' ? undefined : 'utf8',
        )
      }
      await this.run(['add', '-A', '--', ...unique.keys()], worktree)
      await this.run(
        ['-c', 'user.name=Marginalia', '-c', 'user.email=marginalia@localhost', 'commit', '-m', request.commitMessage],
        worktree,
      )
      const commit = await this.run(['rev-parse', 'HEAD'], worktree)

      if (this.options.dryRun) {
        notes.push('Dry run: commit created in a temporary worktree, nothing pushed')
        return { branch, commit, pushed: false, notes }
      }

      await this.run(['push', '-u', 'origin', branch], worktree)
      const remote = await this.run(['remote', 'get-url', 'origin'], worktree).catch(() => '')
      const githubRepo = this.options.prRepo ?? githubRepoFromRemote(remote)
      const token = this.options.getToken?.() ?? ''

      if (githubRepo && request.pr && token) {
        try {
          const create = this.options.createPullRequest ?? gitHubPullRequest
          const prUrl = await create({
            repo: githubRepo,
            head: branch,
            base: request.baseRef ?? (await this.defaultBranch(root)) ?? 'main',
            title: request.pr.title,
            body: request.pr.body,
            token,
            fetchImpl: this.options.fetchImpl,
          })
          return { branch, commit, pushed: true, prUrl, notes }
        } catch (error) {
          notes.push(`Branch pushed, but GitHub PR creation failed: ${(error as Error).message}`)
        }
      } else if (githubRepo && request.pr) {
        notes.push('Branch pushed; connect GitHub to open the pull request')
      } else {
        notes.push('Branch pushed to origin; no pull request was created')
      }
      return { branch, commit, pushed: true, notes }
    } finally {
      await this.run(['worktree', 'remove', '--force', worktree], root).catch(() => {})
      await rm(worktree, { recursive: true, force: true }).catch(() => {})
    }
  }
}

/** Parse MARGINALIA_LOCAL_REPOS with the platform path delimiter; aliases are directory names. */
export function localRootsFromEnv(value: string | undefined): Map<string, string> {
  const roots = new Map<string, string>()
  for (const entry of (value ?? '').split(delimiter).filter(Boolean)) {
    const path = resolve(entry)
    if (existsSync(path)) roots.set(basename(path), path)
  }
  return roots
}
