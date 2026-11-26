import { existsSync } from 'node:fs'

export interface GitCommand {
  command: string
  env?: NodeJS.ProcessEnv
}

/**
 * Prefer the git shipped by dugite in packaged builds. During development and
 * when the optional dependency is unavailable, fall back to the user's PATH.
 */
export async function findGit(): Promise<GitCommand> {
  try {
    const dugite = await import('dugite')
    const command = dugite.resolveGitBinary()
    if (command && existsSync(command)) {
      return { command, env: dugite.setupEnvironment(process.env).env }
    }
  } catch {
    // No bundled git available; the system git is a valid fallback.
  }
  return { command: process.env.MARGINALIA_GIT ?? 'git' }
}
