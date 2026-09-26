/**
 * Envelope for IPC calls that can fail for reasons the user needs to read — a bad URL, an
 * expired token, an unreachable server. Electron would otherwise wrap a thrown error in
 * "Error invoking remote method…", which is not something to put in front of a person.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; message: string }

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function fail(message: string): Result<never> {
  return { ok: false, message }
}
