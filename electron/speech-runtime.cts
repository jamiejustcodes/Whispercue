import { app } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const runtime = 'v1.9.2'
const directory = join(process.env.LOCALAPPDATA || app.getPath('userData'), 'Whispercue', 'speech', runtime)
const executable = join(directory, 'Release', 'whisper-server.exe')
const model = join(directory, 'ggml-base.en.bin')
const vad = join(directory, 'ggml-silero-v6.2.0.bin')
const archive = join(directory, 'whisper-bin-x64.zip')
const ready = join(directory, 'installed')
const systemDirectory = join(process.env.SystemRoot || 'C:\\Windows', 'System32')
const assets = [
  { path: archive, size: 8194445, hash: '49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a',
    url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip' },
  { path: model, size: 147964211, hash: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin' },
  { path: vad, size: 885098, hash: '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987',
    url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin' },
]

let install: Promise<void> | undefined

async function digest(path: string) {
  const hash = createHash('sha256')
  for await (const block of createReadStream(path)) hash.update(block)
  return hash.digest('hex')
}

async function download(asset: typeof assets[number], signal: AbortSignal) {
  if (existsSync(asset.path) && await digest(asset.path) === asset.hash) return
  const temp = asset.path + '.download'
  try {
    await runSystemTool('curl.exe', [
      '--disable', '--fail', '--location', '--silent', '--show-error',
      '--proto', '=https', '--proto-redir', '=https', '--retry', '2',
      '--connect-timeout', '15', '--speed-limit', '1024', '--speed-time', '120',
      '--max-time', '300', '--max-filesize', String(asset.size), '--output', temp, asset.url,
    ], signal, 'Could not download the speech components. Check your connection and try again.')
    if ((await stat(temp)).size !== asset.size || await digest(temp) !== asset.hash) {
      throw new Error('The speech download failed its checksum.')
    }
    await rename(temp, asset.path)
  } finally {
    await rm(temp, { force: true }).catch(() => {})
  }
}

function runSystemTool(name: string, args: string[], signal: AbortSignal, failure: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(join(systemDirectory, name), args, { windowsHide: true, stdio: 'ignore', signal })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(failure))
    })
  })
}

export function speechInstalled() {
  return existsSync(ready) && existsSync(executable) && existsSync(model) && existsSync(vad)
}

export function installSpeech(signal: AbortSignal) {
  if (speechInstalled()) return Promise.resolve()
  install ??= (async () => {
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      throw new Error('The built-in speech download requires Windows x64.')
    }
    await mkdir(directory, { recursive: true })
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(600_000)])
    for (const asset of assets) await download(asset, deadline)
    await runSystemTool('tar.exe', ['-xf', archive, '-C', directory], deadline,
      'Could not extract the local speech runtime.')
    if (!existsSync(executable)) throw new Error('The local speech executable is missing.')
    await writeFile(ready, runtime)
    await rm(archive, { force: true }).catch(() => {})
  })().finally(() => { install = undefined })
  return install
}

export function launchSpeech(port: number, path: string, signal: AbortSignal) {
  const child = spawn(executable, [
    '--host', '127.0.0.1', '--port', String(port), '--request-path', path,
    '--model', model, '--vad', '--vad-model', vad, '--no-gpu', '--threads', '4',
  ], { windowsHide: true, stdio: 'ignore', signal })
  return child
}
