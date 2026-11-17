import { desktopCapturer, screen } from 'electron'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { dirname, join } from 'node:path'
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js'
import type { LiveOptions, LiveStatus } from './contract.cjs'
import { launchSpeech } from './speech-runtime.cjs'

const audioByteLimit = 16_000 * 2 * 10 + 44

function localPort() {
  return new Promise<number>((resolve, reject) => {
    const reservation = createServer()
    reservation.once('error', reject)
    reservation.listen(0, '127.0.0.1', () => {
      const port = (reservation.address() as { port: number }).port
      reservation.close(error => error ? reject(error) : resolve(port))
    })
  })
}

export function parseLiveOptions(value: unknown): LiveOptions {
  const options = value as Partial<LiveOptions> | null
  if (typeof options?.microphone !== 'boolean' || typeof options.system !== 'boolean' ||
      (options.screen !== 'off' && options.screen !== 'text' && options.screen !== 'vision')) {
    throw new Error('Invalid capture settings.')
  }
  return { microphone: options.microphone, system: options.system, screen: options.screen }
}

export class LiveSession {
  readonly abort = new AbortController()
  image: string | undefined
  screenText = ''
  private ocr: Worker | undefined
  private previousFrame: Buffer | undefined
  private screenTimer: ReturnType<typeof setInterval> | undefined
  private picking = false
  private transcribing = false
  private screenState: LiveStatus['screen'] | undefined
  private speechReady: Promise<string | undefined> | undefined

  constructor(
    readonly options: LiveOptions,
    private readonly report: (status: LiveStatus) => void,
  ) {}

  start() {
    if (this.options.microphone || this.options.system) {
      this.speechReady = this.startSpeech().catch(() => {
        if (!this.abort.signal.aborted) this.report({ speechError: 'Local speech could not start. End the session and run Set up live AI.' })
        return undefined
      })
    }
    this.setScreenStatus(this.options.screen !== 'off' ? 'waiting' : 'off')
    if (this.options.screen !== 'off') {
      void this.sampleScreen()
      this.screenTimer = setInterval(() => void this.sampleScreen(), 3500)
    }
  }

  private async startSpeech() {
    const port = await localPort()
    const path = '/' + randomUUID()
    const url = `http://127.0.0.1:${port}${path}`
    const session = this.abort.signal
    session.throwIfAborted()
    const processLifetime = new AbortController()
    const child = launchSpeech(port, path, AbortSignal.any([session, processLifetime.signal]))
    let exited = false
    child.once('error', () => { exited = true })
    child.once('exit', () => { exited = true })
    const deadline = Date.now() + 15_000
    try {
      while (!exited && Date.now() < deadline) {
        try {
          const response = await fetch(url + '/health', {
            signal: AbortSignal.any([session, AbortSignal.timeout(500)]), redirect: 'error',
          })
          if (response.ok && (await response.json() as { status?: string }).status === 'ok') return url
        } catch {
          session.throwIfAborted()
        }
        await sleep(200, undefined, { signal: session })
      }
      throw new Error('Local Whisper did not become ready.')
    } catch (error) {
      processLifetime.abort()
      throw error
    }
  }

  stop() {
    this.abort.abort()
    clearInterval(this.screenTimer)
    this.image = undefined
    this.screenText = ''
    this.previousFrame = undefined
    void this.ocr?.terminate().catch(() => {})
  }

  private setScreenStatus(state: LiveStatus['screen']) {
    if (!this.abort.signal.aborted && this.screenState !== state) {
      this.screenState = state
      this.report({ screen: state })
    }
  }

  private async sampleScreen() {
    if (this.picking || this.abort.signal.aborted) return
    this.picking = true
    try {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const textMode = this.options.screen === 'text'
      const sources = await desktopCapturer.getSources({
        types: ['screen'], thumbnailSize: textMode ? { width: 1440, height: 900 } : { width: 960, height: 640 },
      })
      if (this.abort.signal.aborted) return
      const source = sources.find(item => item.display_id === String(display.id)) ??
        (sources.length === 1 ? sources[0] : undefined)
      if (!source || source.thumbnail.isEmpty()) {
        this.image = undefined
        this.screenText = ''
        this.previousFrame = undefined
        this.setScreenStatus('unavailable')
        return
      }
      const frame = source.thumbnail.toJPEG(textMode ? 85 : 76)
      if (textMode && !this.previousFrame?.equals(frame)) {
        const worker = this.ocr ?? await createWorker('eng', OEM.LSTM_ONLY, {
          langPath: join(dirname(require.resolve('@tesseract.js-data/eng')), '4.0.0_best_int'),
          cacheMethod: 'none',
        })
        if (this.abort.signal.aborted) {
          await worker.terminate()
          return
        }
        if (!this.ocr) {
          this.ocr = worker
          await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
        }
        const { data } = await worker.recognize(frame)
        if (this.abort.signal.aborted) return
        this.screenText = data.text.trim().slice(0, 3500)
        this.previousFrame = frame
      }
      if (!textMode) this.image = frame.toString('base64')
      this.setScreenStatus('ready')
    } catch {
      this.image = undefined
      this.screenText = ''
      this.previousFrame = undefined
      this.setScreenStatus('unavailable')
    } finally {
      this.picking = false
    }
  }

  async transcribe(value: unknown) {
    if (this.abort.signal.aborted || (!this.options.microphone && !this.options.system)) {
      throw new Error('Audio capture is off.')
    }
    if (!(value instanceof ArrayBuffer) || value.byteLength < 48 || value.byteLength > audioByteLimit ||
        Buffer.from(value, 0, 4).toString() !== 'RIFF' || Buffer.from(value, 8, 4).toString() !== 'WAVE') {
      throw new Error('Invalid speech segment.')
    }
    if (this.transcribing) throw new Error('Local transcription is busy.')
    this.transcribing = true
    try {
      const speechUrl = await this.speechReady
      if (this.abort.signal.aborted) return ''
      if (!speechUrl) throw new Error('Local speech could not start.')
      const data = new FormData()
      data.set('file', new Blob([value], { type: 'audio/wav' }), 'speech.wav')
      data.set('response_format', 'json')
      data.set('temperature', '0')
      const response = await fetch(speechUrl + '/inference', {
        method: 'POST', body: data, redirect: 'error',
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(30_000)]),
      })
      if (!response.ok) throw new Error(`Local Whisper returned HTTP ${response.status}.`)
      const result = await response.json() as { text?: unknown }
      if (typeof result.text !== 'string') throw new Error('Local Whisper returned an invalid transcript.')
      return result.text.replace(/\s+/g, ' ').trim().slice(0, 1200)
    } catch (error) {
      if (this.abort.signal.aborted) return ''
      if (error instanceof TypeError) throw new Error('The local Whisper server disconnected.')
      throw error
    } finally {
      this.transcribing = false
    }
  }
}
