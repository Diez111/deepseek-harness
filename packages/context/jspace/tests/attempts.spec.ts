import { describe, expect, it } from 'vitest'
import {
  AttemptMemory, canonicalizeArguments, compileAttemptFilter, preview, trackedTool, wildcardToRegExp,
} from '../src/attempts.ts'

describe('canonicalizeArguments', () => {
  it('ignores property order, deeply', () => {
    const a = { a: 1, nested: { x: [1, 2], y: null } }
    const b = { nested: { y: null, x: [1, 2] }, a: 1 }
    expect(canonicalizeArguments(a)).toBe(canonicalizeArguments(b))
  })
})

describe('AttemptMemory', () => {
  it('remembers a failure and reports a prior failure for the same canonical call', () => {
    const memory = new AttemptMemory()
    expect(memory.priorFailure('bash', { cmd: 'ls' })).toBeUndefined()
    memory.markFailed('bash', { cmd: 'ls' }, 'boom', 100)
    const prior = memory.priorFailure('bash', { cmd: 'ls' })
    expect(prior).toBeDefined()
    expect(prior?.reason).toBe('boom')
  })

  it('forget clears a prior failure after new evidence', () => {
    const memory = new AttemptMemory()
    memory.markFailed('bash', { cmd: 'ls' }, 'boom', 100)
    expect(memory.priorFailure('bash', { cmd: 'ls' })).toBeDefined()
    memory.forget('bash', { cmd: 'ls' })
    expect(memory.priorFailure('bash', { cmd: 'ls' })).toBeUndefined()
    expect(memory.hasFailures()).toBe(false)
  })

  it('keys by canonical call identity, not by property order', () => {
    const memory = new AttemptMemory()
    memory.markFailed('bash', { cmd: 'x', flag: true }, 'e1', 100)
    expect(memory.priorFailure('bash', { flag: true, cmd: 'x' })).toBeDefined()
  })

  it('caps previews', () => {
    const m = new AttemptMemory()
    m.markFailed('bash', { cmd: 'y'.repeat(40) }, 'r'.repeat(40), 20)
    const prior = m.priorFailure('bash', { cmd: 'y'.repeat(40) })
    expect(prior).toBeDefined()
    expect(prior?.argsPreview).not.toContain('y'.repeat(40))
    expect(prior?.argsPreview).toContain('more chars')
    expect(prior?.reason).not.toContain('r'.repeat(40))
  })
})

describe('preview / wildcard patterns / filter', () => {
  it('preview truncates with an omitted marker', () => {
    expect(preview('abc', 5)).toBe('abc')
    expect(preview('abcdefgh', 4)).toContain('…')
  })

  it('wildcardToRegExp escapes regex metacharacters and honors stars', () => {
    expect(wildcardToRegExp('pr.be').test('prXbe')).toBe(false)
    expect(wildcardToRegExp('pr.be').test('pr.be')).toBe(true)
    expect(wildcardToRegExp('mcp_*').test('mcp_foo')).toBe(true)
  })

  it('trackedTool applies include/exclude semantics', () => {
    const filter = compileAttemptFilter([], ['todo_write'])
    expect(trackedTool('bash', filter)).toBe(true)
    expect(trackedTool('todo_write', filter)).toBe(false)
    const only = compileAttemptFilter(['bash*'], [])
    expect(trackedTool('bash', only)).toBe(true)
    expect(trackedTool('grep', only)).toBe(false)
  })
})
