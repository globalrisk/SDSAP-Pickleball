export function createRefreshCoordinator(refresh: () => Promise<void>) {
  let refreshRequested = false
  let runningRefresh: Promise<void> | null = null

  return function requestRefresh(): Promise<void> {
    refreshRequested = true

    if (!runningRefresh) {
      runningRefresh = (async () => {
        try {
          while (refreshRequested) {
            refreshRequested = false
            await refresh()
          }
        } finally {
          runningRefresh = null
        }
      })()
    }

    return runningRefresh
  }
}
