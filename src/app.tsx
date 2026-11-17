import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { DesktopAPI, LiveOptions, Message, ScreenMode, View } from '../electron/contract.cjs'
import { messageOf, useLiveSession, type TranscriptEntry } from './use-live-session'
import './style.css'

declare global {
  interface Window { desktop: DesktopAPI }
}

type HistoryItem = { title: string; at: number; messages: Message[]; transcript?: TranscriptEntry[] }
type Theme = 'system' | 'dark' | 'light'
const desktop = window.desktop
const presets = ['Assist', 'What should I say?', 'Follow-up questions', 'Recap']

function readCaptureOptions(): LiveOptions {
  try {
    const saved = JSON.parse(localStorage.getItem('capture-options') ?? '{}')
    const screen = saved.screen === false || saved.screen === 'off' ? 'off' :
      saved.screen === 'vision' ? 'vision' : 'text'
    return { microphone: saved.microphone !== false, system: saved.system !== false, screen }
  } catch {
    return { microphone: true, system: true, screen: 'text' }
  }
}

function readHistory(): HistoryItem[] {
  try { return JSON.parse(localStorage.getItem('history') ?? '[]') as HistoryItem[] }
  catch { return [] }
}

function App() {
  const [view, setView] = useState<View>('dashboard')
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<'idle' | 'checking' | 'ready'>('idle')
  const [updateStatus, setUpdateStatus] = useState('')
  const [model, setModel] = useState(localStorage.getItem('model') || 'qwen2.5:1.5b')
  const [theme, setTheme] = useState<Theme>((localStorage.getItem('theme') as Theme) || 'system')
  const [settings, setSettings] = useState(false)
  const [menu, setMenu] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState('')
  const [history, setHistory] = useState(readHistory)
  const [selected, setSelected] = useState<HistoryItem>()
  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [busy, setBusy] = useState(false)
  const [options, setOptions] = useState(readCaptureOptions)
  const [showTranscript, setShowTranscript] = useState(true)
  const [preparing, setPreparing] = useState(false)
  const [setupNotice, setSetupNotice] = useState('')
  const live = useLiveSession(desktop)
  const requestId = useRef<string | undefined>(undefined)
  const lastSuggestion = useRef({ activity: 0, at: 0 })
  const liveTranscript = useRef<HTMLDivElement>(null)
  const transcript = useRef<HTMLDivElement>(null)
  const settingsDialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    void desktop.version().then(setVersion)
    return desktop.onAnswer(({ id, text }) => {
      if (requestId.current !== id) return
      setMessages(previous => {
        const tail = previous.at(-1)
        return tail?.role === 'assistant'
          ? [...previous.slice(0, -1), { ...tail, content: tail.content + text }]
          : [...previous, { role: 'assistant', content: text }]
      })
    })
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight
  }, [messages])

  useEffect(() => {
    if (liveTranscript.current) liveTranscript.current.scrollTop = liveTranscript.current.scrollHeight
  }, [live.entries, showTranscript, view])

  useEffect(() => {
    if (live.phase !== 'live' || busy || requestId.current ||
        live.activity <= lastSuggestion.current.activity) return
    const activity = live.activity
    const delay = Math.max(1100, lastSuggestion.current.at + 18_000 - Date.now())
    const timer = setTimeout(() => {
      if (requestId.current) return
      lastSuggestion.current = { activity, at: Date.now() }
      void send('Live suggestion', true)
    }, delay)
    return () => clearTimeout(timer)
  }, [live.activity, live.phase, busy, view])

  useEffect(() => {
    if (settings) settingsDialog.current?.showModal()
  }, [settings])

  function show(next: View) {
    setMenu(false)
    setView(next)
    return desktop.setView(next)
  }

  function startSession(next: View = 'composer') {
    setMessages([])
    setError('')
    setPrompt('')
    setSelected(undefined)
    void show(next)
  }

  async function startLiveSession() {
    setSetupNotice('')
    lastSuggestion.current = { activity: 0, at: 0 }
    setShowTranscript(true)
    if (await live.start(options)) {
      startSession('answer')
    }
  }

  async function prepareLive() {
    setPreparing(true)
    setSetupNotice('Downloading local AI components…')
    setError('')
    try {
      await desktop.prepareLive(options, model)
      setSetupNotice('Local AI is ready. Start a live session when you’re ready.')
    } catch (error) {
      setSetupNotice('')
      setError(messageOf(error))
    } finally {
      setPreparing(false)
    }
  }

  function saveOptions(next: LiveOptions) {
    setOptions(next)
    localStorage.setItem('capture-options', JSON.stringify(next))
  }

  async function cancel() {
    const id = requestId.current
    if (!id) return
    requestId.current = undefined
    await desktop.cancelAnswer(id)
    setBusy(false)
  }

  async function checkUpdate() {
    if (update === 'ready') {
      await desktop.installUpdate()
      return
    }
    setUpdate('checking')
    setUpdateStatus('Checking and downloading updates…')
    try {
      const result = await desktop.checkUpdate()
      setUpdate(result === 'ready' ? 'ready' : 'idle')
      setUpdateStatus({
        development: 'Update checks are available in the installer build.',
        current: 'Whispercue is up to date.',
        ready: 'The update is ready to install.',
      }[result])
    } catch {
      setUpdate('idle')
      setUpdateStatus('Could not check for or download an update.')
    }
  }

  async function stopSession() {
    const entries = live.phase === 'live' ? live.entries : []
    await Promise.all([cancel(), live.stop()])
    setError('')
    if (messages.length || entries.length) {
      const entry = {
        title: (entries[0]?.text ?? messages[0].content).slice(0, 100),
        at: Date.now(), messages, ...(entries.length ? { transcript: entries } : {}),
      }
      const next = [entry, ...history].slice(0, 30)
      while (next.length > 1 && JSON.stringify(next).length > 1_800_000) next.pop()
      try { localStorage.setItem('history', JSON.stringify(next)) }
      catch { setError('History storage is full. This session is available until the app closes.') }
      setHistory(next)
    }
    setMessages([])
    setPrompt('')
    await show('dashboard')
  }

  async function send(text: string, automatic = false) {
    text = text.trim()
    if (!text || requestId.current) return
    const next: Message[] = [...messages, { role: 'user', content: text }]
    const id = crypto.randomUUID()
    requestId.current = id
    setMessages(next)
    setError('')
    if (!automatic) setPrompt('')
    setBusy(true)
    try {
      if (view !== 'answer' && !(automatic && view === 'widget')) await show('answer')
      const context = live.entries.slice(-24).map(entry =>
        `${entry.source === 'microphone' ? 'You' : 'System audio'}: ${entry.text}`).join('\n').slice(-5000)
      const outgoing = next.slice(-24)
      if (automatic) outgoing[outgoing.length - 1] = {
        role: 'user',
        content: 'Answer the latest spoken question directly using the supplied screen and transcript. '
          + 'If there is no question, suggest one useful response, next step, or clarification. '
          + 'Output one or two sentences.',
      }
      await desktop.answer({ id, model, messages: outgoing, liveContext: context, automatic })
    } catch (failure) {
      if (requestId.current === id) {
        setError(messageOf(failure))
      }
    } finally {
      if (requestId.current === id) {
        requestId.current = undefined
        setBusy(false)
      }
    }
  }

  function transcriptLines(items: TranscriptEntry[]) {
    return items.map((entry, i) => <p key={i}>
      <strong>{entry.source === 'microphone' ? 'You' : 'System'}</strong> {entry.text}
    </p>)
  }

  function messageList(items: Message[]) {
    return items.map((message, i) =>
      <div className={`message ${message.role}`} key={i}>
        {message.content}
        {message.role === 'assistant' &&
          <button className="copy" aria-label="Copy answer" onClick={() => void desktop.copy(message.content)}>⧉</button>}
      </div>)
  }

  if (view === 'widget') {
    return <main className="widget"><button className="icon" aria-label="Expand" onClick={() => void show('composer')}>◈</button>
      <button className="primary" onClick={() => void show(messages.length ? 'answer' : 'composer')}>✧ Ask</button>
      <button className="icon square" aria-label="Stop session" onClick={() => void stopSession()}>■</button></main>
  }

  if (view !== 'dashboard') {
    return <main className={`overlay ${view}`}>
      {view === 'answer' && <><button className="collapse icon" aria-label="Collapse overlay" onClick={() => void show('widget')}>×</button>
        {live.phase === 'live' && <>
          <div className="live-status" role="status">
            <span>{`Mic ${live.sources.microphone} · System ${live.sources.system} · Screen ${live.screen}`}</span>
            <button onClick={() => setShowTranscript(!showTranscript)} aria-expanded={showTranscript}>Transcript</button>
            <button onClick={() => void stopSession()}>End live session</button>
          </div>
          {showTranscript && <div className="live-transcript" ref={liveTranscript} aria-label="Live transcript">
            {live.entries.length ? transcriptLines(live.entries) : <p className="muted">Waiting for speech…</p>}
          </div>}
          {live.notice && <p role="alert" className="error">{live.notice}</p>}
        </>}
        <div className="transcript" ref={transcript} aria-live="polite">
          {messageList(messages)}{busy && messages.at(-1)?.role === 'user' && <p className="muted">Thinking…</p>}
          {error && <p role="alert" className="error">{error}</p>}
        </div></>}
      <nav className="presets" aria-label="Prompts">
        {presets.map(label => <button key={label} disabled={busy} onClick={() => void send(label)}>{label}</button>)}
      </nav>
      <form className="prompt" onSubmit={event => { event.preventDefault(); void send(prompt) }}>
        <input aria-label="Ask Whispercue" placeholder="Ask about your conversation…" maxLength={16000} value={prompt}
          onChange={event => setPrompt(event.target.value)} />
        <div className="prompt-tools">
          <span className="model" title={model}>{live.phase === 'live' ? 'Live · Local' : 'Local'}</span>
          <button type="button" className="icon" aria-label="Session options" aria-expanded={menu} onClick={() => setMenu(!menu)}>···</button>
          {busy
            ? <button type="button" className="send" aria-label="Stop answer" onClick={() => void cancel()}>■</button>
            : <button className="send" aria-label="Send prompt" disabled={!prompt.trim()}>➤</button>}
        </div>
        {menu && <div className="session-menu menu">
          <button type="button" onClick={() => void show('widget')}>Collapse overlay</button>
          <button type="button" onClick={() => void stopSession()}>Stop session</button>
        </div>}
      </form>
    </main>
  }

  const filtered = history.filter(item => item.title.toLowerCase().includes(query.toLowerCase()))
  return <>
    <header className="titlebar">
      {selected && <button className="back icon" aria-label="Back to history" onClick={() => setSelected(undefined)}>←</button>}
      <input aria-label="Search history" placeholder="⌕  Search sessions..." value={query}
        onChange={event => { setQuery(event.target.value); setSelected(undefined) }} />
      <div className="window-tools">
        <button className="account" aria-label="Settings" onClick={() => setSettings(true)}>W</button>
        <button aria-label="Minimize" onClick={() => void desktop.windowAction('minimize')}>−</button>
        <button aria-label="Maximize or restore" onClick={() => void desktop.windowAction('maximize')}>□</button>
        <button className="close" aria-label="Close" onClick={() => void desktop.windowAction('close')}>×</button>
      </div>
    </header>
    <main className="dashboard">
      <section className="banner">
        <div className="wrapper intro">
          <div><h1>Whispercue</h1><p className="muted">Local model · {model}</p></div>
          <div className="start-actions">
            <button className="primary start" disabled={preparing || live.phase === 'starting' || !options.microphone && !options.system}
              onClick={() => void startLiveSession()}>
              {live.phase === 'starting' ? 'Starting…' : '◈ Start live session'}
            </button>
            <button onClick={() => startSession()} disabled={preparing || live.phase === 'starting'}>Text chat</button>
          </div>
        </div>
        <div className="wrapper capture-options" role="group" aria-label="Live capture">
          {(['microphone', 'system'] as const).map((source, index) =>
            <label key={source}><input type="checkbox" checked={options[source]} disabled={preparing || live.phase === 'starting'}
              onChange={event => saveOptions({ ...options, [source]: event.target.checked })} />
              {['Microphone', 'System audio'][index]}</label>)}
          <label>Screen context <select value={options.screen} disabled={preparing || live.phase === 'starting'}
            onChange={event => saveOptions({ ...options, screen: event.target.value as ScreenMode })}>
            <option value="text">Live text</option>
            <option value="vision">Live vision</option>
            <option value="off">Off</option>
          </select></label>
          <button className="setting-button" onClick={() => void prepareLive()} disabled={preparing || live.phase === 'starting'}>Set up live AI</button>
          {setupNotice && <p role="status" className="setup-notice muted">{setupNotice}</p>}
          {live.notice && <p role="alert" className="error">{live.notice}</p>}
          {error && <p role="alert" className="error">{error}</p>}
        </div>
      </section>
      <section className="wrapper history">
        {selected ? <><h2>{selected.title}</h2>
          {selected.transcript && <div className="live-transcript">{transcriptLines(selected.transcript)}</div>}
          {messageList(selected.messages)}</> : <>
          <h2>Sessions</h2>
          {!filtered.length && <p className="muted">{query ? 'No matching sessions.' : 'No sessions yet.'}</p>}
          {filtered.map((item, i) =>
            <button className="history-row" key={i} onClick={() => setSelected(item)}>
              <strong>{item.title}</strong><time>{new Date(item.at).toLocaleString()}</time>
            </button>)}
        </>}
      </section>
    </main>
    {settings && <dialog className="settings" ref={settingsDialog} onClose={() => setSettings(false)}>
      <aside><button className="icon" aria-label="Close settings" onClick={() => settingsDialog.current?.close()}>×</button>
        <strong>⚙ General</strong></aside>
      <div className="settings-content">
        <h2>General</h2>
        <div className="setting"><div><strong>Whispercue version</strong><p className="muted">{version}</p>
          <p aria-live="polite" className="muted">{updateStatus}</p></div>
          <button className="setting-button" disabled={update === 'checking'} onClick={() => void checkUpdate()}>
            {update === 'ready' ? 'Restart and update' : 'Check for updates'}
          </button></div>
        <label className="setting"><div><strong>Color theme</strong><p className="muted">Match Windows or set a theme.</p></div>
          <select value={theme} onChange={event => setTheme(event.target.value as Theme)}>
            <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
          </select></label>
        <label className="setting"><div><strong>Ollama model</strong><p className="muted">Choose a model installed on this PC.</p></div>
          <input value={model} maxLength={150} onChange={event => {
            setModel(event.target.value)
            localStorage.setItem('model', event.target.value)
          }} /></label>
      </div>
    </dialog>}
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
