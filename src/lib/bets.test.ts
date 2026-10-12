import { describe, expect, it, vi } from 'vitest'
vi.mock('./supabase',()=>({supabase:{}}))
import { addPoints, isBetStake } from './betsApi'
import { formatPicklePoints, formatSignedPicklePoints } from './picklePoints'

describe('Bet point arithmetic',()=>{
  it('validates positive thousand-point stakes',()=>{
    for(const value of ['1000','21000','1000000000000']) expect(isBetStake(value)).toBe(true)
    for(const value of ['0','-1000','1500','1000.1','1e3','Infinity','1000000001000']) expect(isBetStake(value)).toBe(false)
  })
  it('adds transported decimal stakes and correction deltas exactly',()=>{
    expect(addPoints('1000.000000','5000.000000')).toBe('6000.000000')
    expect(addPoints('-6000.000001','5000.000000')).toBe('-1000.000001')
    expect(addPoints('9007199254740993.125000','1000.875000')).toBe('9007199254741994.000000')
  })
  it('formats debt and signed history without negative zero',()=>{
    expect(formatPicklePoints('-14285.714286')).toBe('-14.285,71 🥒')
    expect(formatPicklePoints('-0.000001')).toBe('0 🥒')
    expect(formatSignedPicklePoints('5000.000000')).toBe('+5.000 🥒')
    expect(formatSignedPicklePoints('-5000.000000')).toBe('-5.000 🥒')
  })
})
