import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  clearPat,
  deleteSnapshot,
  ensureBaseline,
  getSettings,
  listSnapshots,
  listSprints,
  loadSnapshot,
  loadSprint,
  primeSettings,
  readPat,
  saveSprint,
  setPat,
  takeSnapshot,
  trustedHostsSync,
  updateSettings
} from '../storage'
import { layoutSprint } from '@shared/scheduling'
import { block, item, MON, sprint, WED } from '../../../test/fixtures'
import { setEncryptionAvailable, userData } from '../../../test/electron'

/** Everything on disk, against a throwaway folder standing in for %APPDATA%\SprintViewer. */

describe('settings', () => {
  it('missing file → defaults', async () => {
    const settings = await getSettings()
    expect(settings).toMatchObject({
      authMode: 'pat',
      hasPat: false,
      members: [],
      hoursPerDay: 8,
      trustedHosts: []
    })
  })

  it('updates are persisted as JSON and read back', async () => {
    await updateSettings({ hoursPerDay: 6, trustedHosts: ['tfs.example'] })
    const onDisk = JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8'))
    expect(onDisk).toMatchObject({ hoursPerDay: 6, trustedHosts: ['tfs.example'] })
    expect((await getSettings()).hoursPerDay).toBe(6)
  })

  it('trusted hosts are available synchronously once primed', async () => {
    await primeSettings()
    expect(trustedHostsSync()).toEqual(['tfs.example'])
  })
})

describe('the personal access token', () => {
  it('is refused rather than stored in plain text when encryption is unavailable', async () => {
    setEncryptionAvailable(false)
    await expect(setPat('secret-token-1234')).rejects.toThrow(/plain text/)
  })

  it('is sealed on disk, shown only as a hint, and readable only in main', async () => {
    setEncryptionAvailable(true)
    const settings = await setPat('  secret-token-1234  ')
    expect(settings.hasPat).toBe(true)
    expect(settings.patHint).toBe('••••••••1234')
    expect(JSON.stringify(settings)).not.toContain('secret-token')
    const file = await readFile(join(userData, 'settings.json'), 'utf8')
    expect(file).not.toContain('secret-token-1234')
    expect(await readPat()).toBe('secret-token-1234')
  })

  it('a blank token clears it; clearPat clears it', async () => {
    await setPat('abcd-efgh')
    expect((await setPat('   ')).hasPat).toBe(false)
    await setPat('abcd-efgh')
    expect((await clearPat()).hasPat).toBe(false)
    expect(await readPat()).toBeUndefined()
  })

  it('a token sealed for someone else cannot be read, and says why', async () => {
    await updateSettings({ patCipher: Buffer.from('from another machine').toString('base64') })
    await expect(readPat()).rejects.toThrow(/different Windows/)
    await clearPat()
  })
})

describe('sprints', () => {
  it('save → load round trip, and a list newest first', async () => {
    const older = { ...sprint(), id: 'older', name: 'Older' }
    const newer = {
      ...sprint(),
      id: 'newer',
      name: 'Newer',
      days: [{ date: '2026-10-05', capacity: 8 }]
    }
    await saveSprint(older)
    await saveSprint(newer)
    expect(await loadSprint('older')).toEqual(older)
    expect((await listSprints()).map((s) => s.id)).toEqual(['newer', 'older'])
    expect(await loadSprint('missing')).toBeNull()
  })

  it('a corrupt file is reported, not silently treated as missing', async () => {
    await mkdir(join(userData, 'sprints'), { recursive: true })
    await writeFile(join(userData, 'sprints', 'broken.json'), '{ not json', 'utf8')
    await expect(loadSprint('broken')).rejects.toThrow(/could not be read/)
  })
})

describe('snapshots', () => {
  const s = { ...sprint(), id: 'snap-sprint' }

  beforeAll(async () => {
    await saveSprint(s)
  })

  it('take, list (newest first), load and delete', async () => {
    const first = await takeSnapshot(s, 'Agreed plan', MON)
    await new Promise((r) => setTimeout(r, 5))
    const second = await takeSnapshot(s, '   ', MON)
    expect(second.name.length).toBeGreaterThan(0) // a blank name becomes the date
    expect((await listSnapshots(s.id)).map((m) => m.id)).toEqual([second.id, first.id])
    expect((await loadSnapshot(s.id, first.id))?.sprint).toEqual(s)
    await deleteSnapshot(s.id, first.id)
    expect((await listSnapshots(s.id)).map((m) => m.id)).toEqual([second.id])
  })

  it('keeps the calendar exactly as drawn on the day it was taken', async () => {
    const board = {
      ...sprint({
        items: [item(1, { remainingWork: 6, completedWork: 2 })],
        queues: { diogo: [block('a', 1, 6)] }
      }),
      id: 'view-sprint'
    }
    const meta = await takeSnapshot(board, 'Wednesday', WED)
    const kept = await loadSnapshot(board.id, meta.id)
    expect(kept?.view).toEqual({
      today: WED,
      anchor: WED,
      layouts: layoutSprint(board, WED)
    })
  })

  it('a sprint with no snapshots lists none', async () => {
    expect(await listSnapshots('never-snapshotted')).toEqual([])
  })

  it('the Sprint start baseline is taken on planning day, replaced that day, then frozen', async () => {
    // An empty board is not a plan yet, so the sprint needs something on it.
    const b = { ...sprint({ queues: { diogo: [block('a', 1, 4)] } }), id: 'baseline-sprint' }
    const planning = b.days[0].date
    const taken = await ensureBaseline(b, planning)
    expect(taken.action).toBe('take')
    expect((await loadSnapshot(b.id, taken.meta!.id))?.view?.today).toBe(planning)
    const replaced = await ensureBaseline(b, planning)
    expect(replaced).toMatchObject({ action: 'replace', meta: { id: taken.meta?.id } })
    expect((await ensureBaseline(b, b.days[3].date)).action).toBe('none')
    expect((await listSnapshots(b.id)).filter((m) => m.kind === 'baseline')).toHaveLength(1)
  })
})
