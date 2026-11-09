#!/usr/bin/env node
// Two independent MCP clients, not model-driven conversations.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const url = new URL(process.env.MEMORIES_MCP_URL || 'http://127.0.0.1:16818/mcp')
async function connect(name) {
  const client = new Client({ name, version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(url))
  return client
}
async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args })
  if (result.isError) throw new Error(JSON.stringify(result.content))
  return JSON.parse(result.content.find((part) => part.type === 'text').text)
}
const marker = randomUUID().slice(0, 8)
const a = await connect('eidos-smoke-a')
let b
try {
  const created = await call(a, 'memory_create', {
    title: `品牌主色 ${marker}`,
    body: '不用紫色',
    type: 'Preference',
    sourceAgent: 'eidos-smoke-a',
    sourceURL: 'https://example.com/source'
  })
  const id = created.created[0].rowId
  console.log(`A 写入: 品牌主色 ${marker}，不用紫色`)
  await a.close()
  b = await connect('eidos-smoke-b-new-session')
  let found = await call(b, 'memory_search', { query: marker, type: 'Preference', status: 'active' })
  assert.equal(found.memories.length, 1)
  assert.equal(found.memories[0]._id, id)
  assert.equal(found.memories[0].SourceAgent, 'eidos-smoke-a')
  assert.equal(found.memories[0].SourceURL, 'https://example.com/source')
  console.log('B 新会话检索到记忆及来源: eidos-smoke-a, https://example.com/source')
  await call(b, 'memory_update', { id, body: '改为蓝色，不用紫色', sourceAgent: 'eidos-smoke-b' })
  found = await call(b, 'memory_search', { query: marker, type: 'Preference', status: 'active' })
  assert.equal(found.memories[0].Body, '改为蓝色，不用紫色')
  console.log('B 更正: 改为蓝色，不用紫色')
  await call(b, 'memory_forget', { id })
  found = await call(b, 'memory_search', { query: marker, status: 'all' })
  assert.equal(found.memories.length, 0)
  const forgotten = await call(b, 'memory_search', { status: 'forgotten', limit: 50 })
  const tombstone = forgotten.memories.find((row) => row._id === id)
  assert.equal(tombstone?.Body, '')
  assert.equal(tombstone?.SourceURL, '')
  console.log('B 遗忘: 原内容与来源已从行中清空，保留 forgotten 标记')
  console.log('结果: 通过（非模型驱动；SQLite 历史页和备份未验证擦除）')
} finally {
  if (b) await b.close()
  else await a.close()
}
