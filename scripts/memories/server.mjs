#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const port = 16808
const backend = process.env.SIYUAN_URL || 'http://127.0.0.1:16807'
let token = process.env.SIYUAN_TOKEN
if (!token && process.env.SIYUAN_WORKSPACE) {
  token = JSON.parse(await readFile(join(process.env.SIYUAN_WORKSPACE, 'conf', 'conf.json'), 'utf8')).api.token
}
const escapeHtml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const prompt = '使用这个指南帮我设置 Cherry-Studio-Memories 作为我的上下文系统：http://127.0.0.1:16808/setup'
const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cherry-Studio-Memories</title><style>body{font:16px system-ui,sans-serif;line-height:1.6;max-width:760px;margin:3rem auto;padding:0 1.3rem;color:#26252a}button,a.button{display:inline-block;background:#a62749;color:white;border:0;border-radius:7px;padding:.7rem 1rem;margin:.3rem .4rem .3rem 0;text-decoration:none;cursor:pointer;font-size:1rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f2f3;padding:1rem;border-radius:8px}small{color:#555}</style><h1>Memories</h1><p>在同一份文档中保存和查看多个 agent 的共享记忆。</p><p id="status">正在检测思源笔记…</p><button id="init">初始化共享记忆</button><a class="button" href="http://127.0.0.1:16807/" target="_blank" rel="noopener">打开文档</a><p>将这句话粘贴给其他 agent：</p><pre id="prompt">${prompt}</pre><button id="copy">复制接入提示</button><p><a href="/setup">查看本机接入指南</a> · <a href="https://github.com/siyuan-note/siyuan/releases">下载思源笔记</a></p><small>本机指南地址只适合同一台机器上的 agent。云端 agent 需要单独配置受保护的 HTTPS 地址。</small><script>
const status=document.getElementById('status');
async function check(){try{const r=await fetch('/status');const x=await r.json();status.textContent=x.ready?'思源笔记已连接。':'未连接：请启动思源内核并检查 API token。'}catch{status.textContent='无法检测思源笔记。'}}
document.getElementById('init').onclick=async()=>{status.textContent='正在初始化…';try{const r=await fetch('/init',{method:'POST'});const x=await r.json();status.textContent=r.ok?'初始化完成。现在可以打开文档。':x.error}catch{status.textContent='初始化失败，请查看终端。'}};
document.getElementById('copy').onclick=async()=>{const text=document.getElementById('prompt').textContent;const input=document.createElement('textarea');input.value=text;input.style.position='fixed';input.style.left='-10000px';document.body.appendChild(input);input.focus();input.select();const copied=document.execCommand('copy');input.remove();try{if(!copied)await navigator.clipboard.writeText(text);status.textContent='接入提示已复制。'}catch{status.textContent='复制失败，请手动选择并复制上面的提示。'}};check();
</script></html>`
let initializing = false
const server = createServer(async (req, res) => {
  const host = req.headers.host
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
    res.writeHead(403).end()
    return
  }
  const send = (status, type, body) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    res.end(body)
  }
  const json = (status, body) => send(status, 'application/json; charset=utf-8', JSON.stringify(body))
  if (req.method === 'GET' && req.url === '/') return send(200, 'text/html; charset=utf-8', page)
  if (req.method === 'GET' && req.url === '/setup') {
    const guide = await readFile(join(dir, '../../docs/setup.md'), 'utf8')
    return send(
      200,
      'text/html; charset=utf-8',
      `<!doctype html><meta charset="utf-8"><title>Memories setup</title><pre style="white-space:pre-wrap">${escapeHtml(guide)}</pre>`
    )
  }
  if (req.method === 'GET' && req.url === '/status') {
    let ready = false
    if (token)
      try {
        const response = await fetch(new URL('/api/system/version', backend), {
          method: 'POST',
          headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
          body: '{}'
        })
        ready = response.ok && (await response.json()).code === 0
      } catch {
        /* The sidecar has not started yet. */
      }
    return json(200, { ready })
  }
  if (req.method === 'POST' && req.url === '/init') {
    if (req.headers.origin !== `http://${host}`) return json(403, { error: 'Invalid origin' })
    if (!token) return json(400, { error: 'Set SIYUAN_WORKSPACE or SIYUAN_TOKEN before starting Memories.' })
    if (initializing) return json(409, { error: 'Initialization is already running.' })
    initializing = true
    const child = spawn(process.execPath, [join(dir, 'bootstrap.mjs')], {
      env: { ...process.env, SIYUAN_URL: backend, SIYUAN_TOKEN: token },
      stdio: ['ignore', 'ignore', 'pipe']
    })
    child.stderr.pipe(process.stderr)
    child.on('error', () => {
      initializing = false
      json(500, { error: 'Could not start initialization.' })
    })
    child.on('close', (code) => {
      initializing = false
      if (!res.writableEnded)
        json(
          code === 0 ? 200 : 500,
          code === 0 ? { ok: true } : { error: 'Initialization failed; check the backend and API token.' }
        )
    })
    return
  }
  return json(404, { error: 'Not found' })
})
server.listen(port, '127.0.0.1', () => process.stdout.write(`Memories UI: http://127.0.0.1:${port}/\n`))
