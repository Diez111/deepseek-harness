// Hard flash@max probe: subtle expression-evaluator bug needing run/debug/edit/iterate.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'

const PROG = [
  "def parse(s):",
  "    i = 0",
  "    def expr():",
  "        nonlocal i",
  "        v = term()",
  "        while i < len(s) and s[i] in '+-':",
  "            op = s[i]; i += 1",
  "            r = term()",
  "            v = v + r if op == '+' else v - r",
  "        return v",
  "    def term():",
  "        nonlocal i",
  "        v = num()",
  "        while i < len(s) and s[i] == '*':",
  "            i += 1",
  "            v = v * num()",
  "        return v",
  "    def num():",
  "        nonlocal i",
  "        j = i",
  "        while j < len(s) and s[j].isdigit():",
  "            j += 1",
  "        v = int(s[i:j]); i = j",
  "        return v",
  "    return expr()",
  "def eval_expression(s):",
  "    return parse(s.replace(' ', ''))",
  "assert eval_expression('3 + 5 * 2') == 13",
  "assert eval_expression('10 - 4 * 2 + 3') == 5",
  "assert eval_expression('2 * 3 * 4 - 10') == 14",
  "print('HARD_OK=' + str(eval_expression('3 + 5 * 2')))",
].join('\n') + '\n'

const wd = mkdtempSync(join(tmpdir(), 'htop-'))
writeFileSync(join(wd, 'prog.py'), PROG)
const t0 = performance.now()
const run = spawnSync('/home/diez/.nvm/versions/node/v24.16.0/bin/dsh', ['--profile', 'headless',
  'There is prog.py in this dir with a subtle bug: the asserts at the bottom likely fail. '
  + 'Run python3 prog.py, find the bug (read the file, reason about the parser), fix it so both '
  + 'asserts pass and it prints HARD_OK=<number>. Reply with the program\'s exact output.'], { cwd: wd, timeout: 300_000, encoding: 'utf8' })
const ms = Math.round(performance.now() - t0)
const out = (run.stdout ?? '') + (run.stderr ?? '')
const ok = /HARD_OK=13/.test(out)
console.log(JSON.stringify({ probe: 'hard-eval', ok, ms, rc: run.status }))
console.log('  marker:', (out.match(/HARD_OK=\d+/) || ['NO_MARKER'])[0], '| assert_err:', /AssertionError/.test(out))
console.log('  tail:', out.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 220))
rmSync(wd, { recursive: true, force: true })
