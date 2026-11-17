class SpeechCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.frame = new Float32Array(320)
    this.offset = 0
  }

  process(inputs) {
    const channels = inputs[0]
    if (!channels?.length) return true
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0
      for (const channel of channels) sample += channel[i]
      this.frame[this.offset++] = sample / channels.length
      if (this.offset === this.frame.length) {
        this.port.postMessage(this.frame, [this.frame.buffer])
        this.frame = new Float32Array(320)
        this.offset = 0
      }
    }
    return true
  }
}

registerProcessor('speech-capture', SpeechCapture)
