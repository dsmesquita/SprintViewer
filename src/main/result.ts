import type { FailureDetail } from '@shared/failure'
import { fail, ok, type Result } from '@shared/ipc'
import { TfsError } from './tfs/client'
import { TfsUrlError } from './tfs/url'

/**
 * Runs an action for the renderer and reports its outcome as a `Result`, so a failure arrives
 * as a message to show rather than as an exception that IPC would flatten into noise.
 */
export async function guard<T>(action: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await action())
  } catch (error) {
    return fail(messageFor(error), error instanceof DetailedError ? error.detail : undefined)
  }
}

/** A failure that brings its details with it — what was asked, and what came back. */
export class DetailedError extends Error {
  constructor(
    message: string,
    readonly detail: FailureDetail
  ) {
    super(message)
  }
}

/** What to tell the user about a failure: TFS and URL errors are already written for them. */
export function messageFor(error: unknown): string {
  if (error instanceof TfsError || error instanceof TfsUrlError) return error.message
  return error instanceof Error ? error.message : String(error)
}
