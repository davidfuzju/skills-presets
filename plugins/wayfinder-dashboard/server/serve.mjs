// Wayfinder dashboard's local web server. Started by the mod (node serve.mjs
// <dataDir> <port> <pagePath>); no dependencies.
//
// The mod owns the data: it writes <dataDir>/view.json whenever a map moves.
// This only serves the page, serves the last valid view.json, and tells open
// pages to refetch over Server-Sent Events when the file changes.
//
// Bound to 127.0.0.1 only. Two sessions on one workspace share the port and
// the data directory, so a second server finding the port taken just says so
// and exits: the first one already serves the same file.

import { readFileSync, watch } from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const [dataDir, portArg, pagePath] = process.argv.slice(2)
const port = Number(portArg)
const viewPath = path.join(dataDir, 'view.json')
const clients = new Set()
let view = '{}'

function load() {
  try {
    const text = readFileSync(viewPath, 'utf8')
    JSON.parse(text) // a half-written file keeps the last good one
    if (text === view) return false
    view = text
    return true
  } catch {
    return false
  }
}

function broadcast() {
  for (const res of clients) res.write('event: update\ndata: {}\n\n')
}

load()
let debounce
watch(dataDir, () => {
  clearTimeout(debounce)
  debounce = setTimeout(() => load() && broadcast(), 80)
})
setInterval(() => {
  for (const res of clients) res.write(': ping\n\n')
}, 15_000)

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(readFileSync(pagePath))
  } else if (url.pathname === '/view.json') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(view)
  } else if (url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write('retry: 2000\n\n')
    clients.add(res)
    req.on('close', () => clients.delete(res))
  } else if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('wayfinder')
  } else {
    res.writeHead(404)
    res.end()
  }
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.log(`in-use ${port}`)
    process.exit(0)
  }
  console.error(String(error))
  process.exit(1)
})
server.listen(port, '127.0.0.1', () => console.log(`listening ${port}`))
