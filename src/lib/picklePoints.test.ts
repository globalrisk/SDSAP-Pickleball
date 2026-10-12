import { describe, expect, it } from 'vitest'
import { formatPicklePoints, isPicklePrize } from './picklePoints'

describe('Pickle point decimal presentation', () => {
  it('uses Vietnamese thousands and fractional separators', () => {
    expect(formatPicklePoints('10000')).toBe('10.000 🥒')
    expect(formatPicklePoints('14285.714286')).toBe('14.285,71 🥒')
    expect(formatPicklePoints('1000.500000')).toBe('1.000,5 🥒')
    expect(formatPicklePoints('0.000000')).toBe('0 🥒')
  })
  it('rounds at display precision without losing large balances or carry', () => {
    expect(formatPicklePoints('999.995000')).toBe('1.000 🥒')
    expect(formatPicklePoints('9007199254740993.125000')).toBe('9.007.199.254.740.993,13 🥒')
    expect(() => formatPicklePoints('NaN')).toThrow()
  })
  it('accepts only supported prizes in thousands', () => {
    for (const value of ['0', '1000', '1000000000000']) expect(isPicklePrize(value)).toBe(true)
    for (const value of ['', '-1000', '1', '1500', '1000.5', '1e3', '1000000001000', 'Infinity']) expect(isPicklePrize(value)).toBe(false)
  })
})
