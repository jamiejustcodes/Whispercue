import type { AudioSource, LiveOptions } from '../electron/contract.cjs'

const SAMPLE_RATE = 16_000
const START_FRAMES = 3
const PAUSE_FRAMES = 28
const MAX_FRAMES = 400

function wav(frames: Float32Array[]) {
  const samples = frames.reduce((sum, frame) => sum + frame.length, 0)
  const buffer = new ArrayBuffer(44 + samples * 2)
  const out = new DataView(buffer)
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) {
    for (let i = 0; i < text.length; i++) out.setUint8(offset + i, text.charCodeAt(i))
  }
  out.setUint32(4, buffer.byteLength - 8, true)
  out.setUint32(16, 16, true)
  out.setUint16(20, 1, true)
  out.setUint16(22, 1, true)
  out.setUint32(24, SAMPLE_RATE, true)
  out.setUint32(28, SAMPLE_RATE * 2, true)
  out.setUint16(32, 2, true)
  out.setUint16(34, 16, true)
  out.setUint32(40, samples * 2, true)
  let offset = 44
  for (const frame of frames) {
    for (const sample of frame) {
      out.setInt16(offset, Math.round(Math.min(1, Math.max(-1, sample)) * 32767), true)
      offset += 2
    }
  }
  return buffer
}

function segmenter(onSegment: (bytes: ArrayBuffer) => void) {
  let noise = 0.001
  let voiced = 0
  let consecutive = 0
  let quiet = 0
  let recording = false
  let frames: Float32Array[] = []

  return (frame: Float32Array) => {
    let sum = 0
    for (const sample of frame) sum += sample * sample
    const energy = Math.sqrt(sum / frame.length)
    const speech = energy > Math.max(0.005, noise * 3.5)
    if (!recording) {
      if (!speech) noise = noise * 0.98 + energy * 0.02
      consecutive = speech ? consecutive + 1 : 0
      frames.push(frame)
      if (frames.length > 12) frames.shift()
      if (consecutive < START_FRAMES) return
      recording = true
      voiced = consecutive
      quiet = 0
      return
    }
    frames.push(frame)
    if (speech) voiced++
    quiet = speech ? 0 : quiet + 1
    if (quiet < PAUSE_FRAMES && frames.length < MAX_FRAMES) return
    if (voiced >= 10) onSegment(wav(frames.slice(0, frames.length - Math.max(0, quiet - 8))))
    frames = []
    voiced = 0
    recording = false
    consecutive = 0
  }
}

export type AudioState = 'off' | 'starting' | 'live' | 'unavailable'

export function captureAudio(
  options: LiveOptions,
  onState: (source: AudioSource, state: AudioState) => void,
  onSegment: (source: AudioSource, bytes: ArrayBuffer) => void,
) {
  if (!options.microphone && !options.system) return () => {}
  const context = new AudioContext({ sampleRate: SAMPLE_RATE })
  const streams: MediaStream[] = []
  let stopped = false
  const worklet = context.audioWorklet.addModule(new URL('audio-worklet.js', document.baseURI))
  const sink = context.createGain()
  sink.gain.value = 0
  sink.connect(context.destination)
  const ready = Promise.all([worklet, context.resume()])

  async function attach(source: AudioSource, getStream: () => Promise<MediaStream>) {
    onState(source, 'starting')
    let stream: MediaStream | undefined
    try {
      stream = await getStream()
      if (stopped) {
        for (const track of stream.getTracks()) track.stop()
        return
      }
      streams.push(stream)
      for (const track of stream.getVideoTracks()) track.stop()
      const audioTracks = stream.getAudioTracks()
      if (!audioTracks.length) throw new Error('The selected source has no audio.')
      await ready
      if (stopped) return
      const input = context.createMediaStreamSource(stream)
      const processor = new AudioWorkletNode(context, 'speech-capture')
      const push = segmenter(bytes => onSegment(source, bytes))
      processor.port.onmessage = event => { if (!stopped) push(event.data as Float32Array) }
      input.connect(processor).connect(sink)
      for (const track of audioTracks) {
        track.addEventListener('ended', () => {
          input.disconnect()
          processor.disconnect()
          processor.port.close()
          if (!stopped) onState(source, 'unavailable')
        }, { once: true })
      }
      onState(source, 'live')
    } catch {
      for (const track of stream?.getTracks() ?? []) track.stop()
      if (!stopped) onState(source, 'unavailable')
    }
  }

  // Start the display request while the user's Start action can authorize it.
  if (options.system) void attach('system', () => navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }))
  if (options.microphone) {
    void attach('microphone', () => navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
    }))
  }
  void ready.catch(() => {})
  return () => {
    stopped = true
    for (const stream of streams) for (const track of stream.getTracks()) track.stop()
    void context.close()
  }
}
