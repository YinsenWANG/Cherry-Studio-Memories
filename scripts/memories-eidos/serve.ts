import { join, resolve } from 'node:path'

import { startEidosBackend } from '../../src/main/features/memories/eidosBackend'

async function main() {
  const directory = process.env.MEMORIES_TEST_DIR
  if (!directory) throw new Error('Set MEMORIES_TEST_DIR to an isolated test directory')
  const stop = await startEidosBackend({
    binary: resolve('resources/eidos/eidos-darwin-arm64'),
    file: join(directory, 'space.eidos'),
    pages: join(directory, 'pages'),
    log: (message, error) => process.stderr.write(`${message}${error ? `: ${String(error)}` : ''}\n`)
  })
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void stop().finally(() => process.exit(0))
    })
  }
}
void main()
