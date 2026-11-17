import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { DesktopAPI, Message, View } from '../electron/contract.cjs'
import './style.css'

declare global {
  interface Window { desktop: DesktopAPI }
}

type HistoryItem = { title: string; at: number; messages: Message[] }
type Theme = 'system' | 'dark' | 'light'
const desktop = window.desktop
const presets = ['Assist', 'What should I say?', 'Follow-up questions', 'Recap']

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
  const requestId = useRef<string | undefined>(undefined)
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
    if (settings) settingsDialog.current?.showModal()
  }, [settings])

  function show(next: View) {
    setMenu(false)
    setView(next)
    return desktop.setView(next)
  }

  function startSession() {
    setMessages([])
    setError('')
    setPrompt('')
    setSelected(undefined)
    void show('composer')
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
    await cancel()
    if (messages.length) {
      const entry = { title: messages[0].content.slice(0, 100), at: Date.now(), messages }
      const next = [entry, ...history].slice(0, 30)
      localStorage.setItem('history', JSON.stringify(next))
      setHistory(next)
    }
    setMessages([])
    setError('')
    setPrompt('')
    await show('dashboard')
  }

  async function send(text: string) {
    text = text.trim()
    if (!text || requestId.current) return
    const next: Message[] = [...messages, { role: 'user', content: text }]
    const id = crypto.randomUUID()
    requestId.current = id
    setMessages(next)
    setError('')
    setPrompt('')
    setBusy(true)
    try {
      await show('answer')
      await desktop.answer({ id, model, messages: next.slice(-24) })
    } catch (failure) {
      if (requestId.current === id) {
        const message = String(failure).replace(/^(?:Error: )?(?:Error invoking remote method '[^']+': )?(?:Error: )?/, '')
        setError(message)
      }
    } finally {
      if (requestId.current === id) {
        requestId.current = undefined
        setBusy(false)
      }
    }
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
          <span className="model" title={model}>Local</span>
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
          <button className="primary start" onClick={startSession}>◈ Start Whispercue</button>
        </div>
      </section>
      <section className="wrapper history">
        {selected ? <><h2>{selected.title}</h2>{messageList(selected.messages)}</> : <>
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
