// Counting proxy: forwards to the opencode gateway, estimates I/O tokens
// (chars/4) per request, appends a JSON line per request to a log file.
import http from 'node:http'
import https from 'node:https'
import { appendFileSync } from 'node:fs'
const UPSTREAM = process.env.UPS ?? 'https://opencode.ai/zen/go/v1'
const LOG = process.env.PROXY_LOG ?? '/tmp/proxy.log'
const serv = http.createServer((req, res) => {
  let body = ''
  req.on('data', c => (body += c))
  req.on('end', () => {
    let estInput = 0
    try {
      const parsed = JSON.parse(body)
      for (const m of parsed.messages ?? []) estInput += Math.ceil((m.content ?? '').length / 4)
      estInput += Math.ceil((parsed.system ?? '').length / 4)
    } catch { estInput = 0 }
    const u = new URL(req.url, UPSTREAM)
    const upstreamReq = https.request(u, { method: req.method, headers: { ...req.headers, host: u.host, 'content-length': Buffer.byteLength(body) } }, (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers)
      let outBytes = 0
      upRes.on('data', chunk => { outBytes += chunk.length; res.write(chunk) })
      upRes.on('end', () => {
        res.end()
        appendFileSync(LOG, JSON.stringify({ path: req.url, in: estInput, out: Math.ceil(outBytes / 4), ts: Date.now() }) + String.fromCharCode(10))
      })
    })
    upstreamReq.on('error', () => { res.writeHead(502); res.end(); appendFileSync(LOG, JSON.stringify({ path: req.url, error: 'upstream' }) + String.fromCharCode(10)) })
    upstreamReq.write(body)
    upstreamReq.end()
  })
})
serv.listen(Number(process.env.PROXY_PORT ?? 18081), '127.0.0.1', () => {
  console.log('proxy up :' + (process.env.PROXY_PORT ?? 18081))
})
process.on('SIGTERM', () => serv.close(() => process.exit(0)))
