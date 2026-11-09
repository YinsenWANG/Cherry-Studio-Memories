import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import {
  SettingDescription,
  SettingGroup,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useMcpRuntimeStatus } from '@renderer/hooks/useMcpRuntimeStatus'
import { useMcpServerMutations, useMcpServers } from '@renderer/hooks/useMcpServer'
import { ipcApi } from '@renderer/ipc'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'

const localUrl = 'http://127.0.0.1:16807/mcp'
const statusKeys = {
  disabled: 'settings.mcp.runtimeStatus.disabled',
  connecting: 'settings.mcp.runtimeStatus.connecting',
  connected: 'settings.mcp.runtimeStatus.connected',
  error: 'settings.mcp.runtimeStatus.error'
} as const

export function SpaceSettings() {
  const { t } = useTranslation()
  const { mcpServers } = useMcpServers()
  const server = mcpServers.find((item) => item.name === BuiltinMcpServerNames.sharedMemories)
  const { updateMcpServer } = useMcpServerMutations(server?.id ?? '')
  const status = useMcpRuntimeStatus(server?.id, !!server?.isActive)
  const [mode, setMode] = useState<'local' | 'remote'>('local')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!server) return
    const isRemote = !!server.baseUrl && server.baseUrl !== localUrl
    setMode(isRemote ? 'remote' : 'local')
    setUrl(isRemote ? server.baseUrl!.replace(/\/mcp\/?$/, '') : '')
    const authorization = Object.entries(server.headers ?? {}).find(
      ([key]) => key.toLowerCase() === 'authorization'
    )?.[1]
    setToken(isRemote ? (authorization?.replace(/^Bearer\s+/i, '') ?? '') : '')
  }, [server])

  const save = async () => {
    if (!server) return
    setBusy(true)
    setError('')
    try {
      let baseUrl = localUrl
      if (mode === 'remote') {
        if (!token.trim()) throw new Error('Missing token')
        const parsed = new URL(url)
        if (
          !['http:', 'https:'].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password ||
          parsed.search ||
          parsed.hash
        ) {
          throw new Error('Invalid URL')
        }
        parsed.pathname = `${parsed.pathname.replace(/\/+$/, '').replace(/\/mcp$/, '')}/mcp`
        baseUrl = parsed.toString()
      }
      const previousAuthorization = Object.entries(server.headers ?? {}).find(
        ([key]) => key.toLowerCase() === 'authorization'
      )?.[1]
      const authorization =
        mode === 'remote' ? `Bearer ${token.trim()}` : server.baseUrl === localUrl ? (previousAuthorization ?? '') : ''
      const headers = Object.fromEntries(
        Object.entries(server.headers ?? {}).filter(([key]) => key.toLowerCase() !== 'authorization')
      )
      await updateMcpServer({ body: { baseUrl, headers: { ...headers, Authorization: authorization } } })
      setDirty(false)
      if (server.isActive) {
        try {
          await ipcApi.request('mcp.server.restart', { serverId: server.id })
        } catch {
          setError(t('settings.mcp.runtimeStatus.error'))
        }
      }
    } catch {
      setError(t('settings.space.saveError'))
    } finally {
      setBusy(false)
    }
  }

  const testConnection = async () => {
    if (!server) return
    setBusy(true)
    setError('')
    try {
      await ipcApi.request('mcp.server.restart', { serverId: server.id })
      await ipcApi.request('mcp.server.get_version', { serverId: server.id })
    } catch {
      setError(t('settings.mcp.runtimeStatus.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsContentColumn>
      <SettingGroup className="space-y-4">
        <SettingTitle>{t('settings.space.title')}</SettingTitle>
        <SettingDescription>{t('settings.space.restart')}</SettingDescription>
        {!server ? (
          <SettingDescription>{t('settings.mcp.noServers')}</SettingDescription>
        ) : (
          <>
            <div className="space-y-2">
              <label htmlFor="space-mode">{t('settings.space.mode')}</label>
              <Select
                value={mode}
                onValueChange={(value) => {
                  setMode(value as 'local' | 'remote')
                  setToken('')
                  setDirty(true)
                }}>
                <SelectTrigger id="space-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">{t('settings.skills.source.local')}</SelectItem>
                  <SelectItem value="remote">{t('settings.space.remote')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {mode === 'remote' && (
              <>
                <div className="space-y-2">
                  <label htmlFor="space-url">{t('settings.mcp.url')}</label>
                  <Input
                    id="space-url"
                    value={url}
                    onChange={(event) => {
                      setUrl(event.target.value)
                      setDirty(true)
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="space-token">{t('settings.data.siyuan.token.label')}</label>
                  <Input
                    id="space-token"
                    type="password"
                    value={token}
                    onChange={(event) => {
                      setToken(event.target.value)
                      setDirty(true)
                    }}
                  />
                </div>
              </>
            )}
            <div className="flex gap-2">
              <Button disabled={busy} onClick={() => void save()}>
                {t('common.save')}
              </Button>
              <Button variant="outline" disabled={busy || dirty} onClick={() => void testConnection()}>
                {t('settings.proxy.test.action')}
              </Button>
            </div>
            <SettingDescription>
              {t('settings.voice.status.label')}: {t(statusKeys[status.state])}
            </SettingDescription>
            {error && (
              <p role="alert" className="text-error">
                {error}
              </p>
            )}
          </>
        )}
      </SettingGroup>
    </SettingsContentColumn>
  )
}
