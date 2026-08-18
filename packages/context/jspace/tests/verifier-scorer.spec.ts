import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VERIFIER_CRITERIA, VERIFIER_MAX_SCORE, buildVerifierPrompt, parseVerifierScore,
} from '../src/verifier-scorer.ts'

describe('parseVerifierScore', () => {
  it('parses the first bounded integer 0..4', () => {
    expect(parseVerifierScore('4')).toBe(4)
    expect(parseVerifierScore('Score: 3')).toBe(3)
    expect(parseVerifierScore('2 points')).toBe(2)
    expect(parseVerifierScore('0')).toBe(0)
  })
  it('rejects out-of-range and non-integer output', () => {
    expect(parseVerifierScore('5')).toBeUndefined()
    expect(parseVerifierScore('seven')).toBeUndefined()
    expect(parseVerifierScore('1.5')).toBeUndefined()
    expect(parseVerifierScore('')).toBeUndefined()
  })
})

describe('buildVerifierPrompt', () => {
  it('embeds goal, criteria, and evidence (summary wins over the list)', () => {
    const p = buildVerifierPrompt('implement X', ['A compiles'], 'ran all tests: pass', DEFAULT_VERIFIER_CRITERIA)
    expect(p.system).toContain(VERIFIER_MAX_SCORE.toString())
    expect(p.user).toContain('implement X')
    expect(p.user).toContain('Correctness')
    expect(p.user).toContain('ran all tests: pass')
    expect(p.user).not.toContain('A compiles')
  })
  it('falls back to the verified list when no summary is provided', () => {
    const p = buildVerifierPrompt('g', ['module A compiles'], undefined, ['Correctness'])
    expect(p.user).toContain('module A compiles')
  })
})
