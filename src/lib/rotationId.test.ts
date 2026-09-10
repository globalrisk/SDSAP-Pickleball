import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRotationId } from './rotationId'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

afterEach(() => vi.unstubAllGlobals())

describe('rotation IDs', () => {
  it('uses randomUUID when the browser provides it', () => {
    const expected = '11111111-1111-4111-8111-111111111111'
    vi.stubGlobal('crypto', { randomUUID: () => expected })
    expect(createRotationId()).toBe(expected)
  })

  it('creates a valid UUID on non-HTTPS mobile browsers', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(17)
        return bytes
      },
    })
    expect(createRotationId()).toMatch(uuidPattern)
  })
})
