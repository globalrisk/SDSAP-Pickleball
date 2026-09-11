import { describe, expect, it, vi } from 'vitest'
import { createRefreshCoordinator } from './refreshCoordinator'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('refresh coordinator', () => {
  it('coalesces overlapping requests into one trailing refresh', async () => {
    const firstRefresh = deferred()
    const refresh = vi.fn(async () => {
      if (refresh.mock.calls.length === 1) await firstRefresh.promise
    })
    const requestRefresh = createRefreshCoordinator(refresh)

    const firstRequest = requestRefresh()
    const secondRequest = requestRefresh()
    const thirdRequest = requestRefresh()

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(secondRequest).toBe(firstRequest)
    expect(thirdRequest).toBe(firstRequest)

    firstRefresh.resolve()
    await firstRequest

    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('starts a new refresh after the previous coordinated run completes', async () => {
    const refresh = vi.fn(async () => undefined)
    const requestRefresh = createRefreshCoordinator(refresh)

    await requestRefresh()
    await requestRefresh()

    expect(refresh).toHaveBeenCalledTimes(2)
  })
})
