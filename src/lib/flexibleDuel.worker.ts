import { searchDuelOptions, searchDuelSplits, type DuelSearchInput, type DuelSearchCatalog, type DuelSplit } from './flexibleDuel'

let input: DuelSearchInput
let catalog: DuelSearchCatalog
self.onmessage = (event: MessageEvent<{ requestId: number; type: 'search' | 'options'; input?: DuelSearchInput; split?: DuelSplit; excluded?: string[]; currentIds?: string[] }>) => {
  const { requestId, type } = event.data
  const progress = (value: unknown) => self.postMessage({ requestId, type: 'progress', progress: value })
  try {
    if (type === 'search') { input = event.data.input!; catalog = searchDuelSplits(input, progress); self.postMessage({ requestId, type: 'catalog', catalog }); return }
    if (event.data.input) input = event.data.input
    const split = event.data.split!
    let options = searchDuelOptions(input, split, event.data.excluded, progress), restarted = false
    if (!options.length && event.data.excluded?.length) {
      restarted = true
      options = searchDuelOptions(input, split, event.data.currentIds ?? [], progress)
      if (!options.length) options = searchDuelOptions(input, split, [], progress)
    }
    self.postMessage({ requestId, type: 'options', inputKey: input.inputKey, splitId: split.id, options, restarted })
  } catch (error) { self.postMessage({ requestId, type: 'error', message: error instanceof Error ? error.message : String(error) }) }
}
