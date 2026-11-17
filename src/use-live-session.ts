import { useEffect, useRef, useState } from 'react'
import type { AudioSource, DesktopAPI, LiveOptions, LiveStatus } from '../electron/contract.cjs'
import { captureAudio, type AudioState } from './live-audio'

export type TranscriptEntry = { source: AudioSource; text: string; at: number }

export function useLiveSession(desktop: DesktopAPI) {
  const [phase, setPhase] = useState<'off' | 'starting' | 'live'>('off')
  const [screen, setScreen] = useState<NonNullable<LiveStatus['screen']>>('off')
  const [sources, setSources] = useState<Record<AudioSource, AudioState>>({ microphone: 'off', system: 'off' })
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [notice, setNotice] = useState('')
  const [activity, setActivity] = useState(0)
  const current = useRef<{ closeAudio?: () => void } | undefined>(undefined)

  useEffect(() => {
    const unsubscribe = desktop.onLiveStatus(status => {
      if (status.screen) setScreen(status.screen)
      if (status.speechError) setNotice(status.speechError)
    })
    return () => {
      unsubscribe()
      current.current?.closeAudio?.()
      if (current.current) void desktop.stopLive().catch(() => {})
      current.current = undefined
    }
  }, [desktop])

  async function stop() {
    current.current?.closeAudio?.()
    current.current = undefined
    setPhase('off')
    await desktop.stopLive()
  }

  async function start(options: LiveOptions) {
    if (current.current) return false
    const session: { closeAudio?: () => void } = {}
    current.current = session
    setPhase('starting')
    setScreen('off')
    setSources({ microphone: 'off', system: 'off' })
    setEntries([])
    setActivity(0)
    setNotice('')
    try {
      await desktop.startLive(options)
      if (current.current !== session) return false
      const queue: Array<{ source: AudioSource; bytes: ArrayBuffer; at: number }> = []
      let processing = false

      async function drain() {
        if (processing) return
        processing = true
        try {
          while (queue.length && current.current === session) {
            const item = queue.shift()!
            try {
              const text = await desktop.transcribe(item.bytes)
              if (current.current !== session) return
              setNotice('')
              if (!text || /^\s*(?:\[[^\]]+\]|\([^)]*\)|[.♪…]+)\s*$/.test(text)) continue
              setEntries(previous => [...previous.slice(-119), { source: item.source, text, at: item.at }])
              if (text.includes('?') || text.split(/\s+/).length >= 4) setActivity(value => value + 1)
            } catch (error) {
              if (current.current === session) setNotice(messageOf(error))
            }
          }
        } finally {
          processing = false
        }
      }

      session.closeAudio = captureAudio(options,
        (source, state) => {
          if (current.current === session) setSources(previous => ({ ...previous, [source]: state }))
        },
        (source, bytes) => {
          if (current.current !== session) return
          if (queue.length >= 4) {
            queue.shift()
            setNotice('Transcription is catching up. Some older audio was skipped.')
          }
          queue.push({ source, bytes, at: Date.now() })
          void drain()
        },
      )
      setPhase('live')
      return true
    } catch (error) {
      if (current.current === session) {
        setNotice(messageOf(error))
        await stop()
      }
      return false
    }
  }

  return { phase, screen, sources, entries, notice, activity, start, stop }
}

export function messageOf(error: unknown) {
  return String(error).replace(/^(?:Error: )?(?:Error invoking remote method '[^']+': )?(?:Error: )?/, '')
}
