import type { Page } from '@playwright/test'
import { expect, test } from './app'
import { settingsFor, sprintFor } from './data'

/**
 * Hiding tasks from the backlog in the real app: the mark is saved with the sprint, so a hidden
 * task is still hidden after a restart, and "Show hidden" brings it back to unhide.
 */

const valCard = (page: Page) => page.locator('.task-card', { hasText: 'VAL:: Export service' })

test.beforeEach(async ({ seed, tfs }) => {
  const sprint = sprintFor(tfs)
  await seed({ settings: { ...settingsFor(tfs), activeSprintId: sprint.id }, sprints: [sprint] })
})

test('a hidden task stays hidden after a restart, and can be unhidden', async ({ launch }) => {
  let { page, close } = await launch()
  await expect(valCard(page)).toHaveCount(1)

  await valCard(page).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Hide from backlog' }).click()
  await expect(valCard(page)).toHaveCount(0)
  await expect(page.getByText('Everything is scheduled.')).toBeVisible()
  await expect(page.getByText('1 hidden task waits here.')).toBeVisible()
  await close()

  ;({ page, close } = await launch())
  await expect(page.locator('.row-name').first()).toBeVisible()
  await expect(valCard(page)).toHaveCount(0)

  await page.getByRole('checkbox', { name: 'Show hidden (1)' }).check()
  await expect(valCard(page)).toHaveClass(/is-hidden-card/)
  await valCard(page).getByRole('button', { name: 'Unhide' }).click()
  await expect(valCard(page)).not.toHaveClass(/is-hidden-card/)
  await expect(page.getByRole('checkbox', { name: /Show hidden/ })).toHaveCount(0)
  await close()

  ;({ page, close } = await launch())
  await expect(valCard(page)).toHaveCount(1)
  await close()
})
