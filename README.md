# Whispercue

Whispercue is a Windows desktop app for live conversation assistance. It transcribes microphone and system audio, samples the screen, and automatically streams suggestions into a floating session window. The models run on the user's PC. There is no hosted inference bill, subscription, or API key.

## Start a live session

1. Install and run Ollama for Windows. The app uses Ollama over loopback. [Ollama for Windows](https://docs.ollama.com/windows)
2. On the dashboard, select **Microphone** and **System audio**. Leave **Screen context** set to **Live text**, then click **Set up live AI**. This downloads the pinned Windows x64 whisper.cpp runtime, English Whisper `base.en`, Silero VAD, and the Qwen2.5 1.5B answer model. Allow about 1.2 GB for the models and speech runtime, plus space for Ollama.
3. Click **Start live session** and speak or play meeting audio. The overlay shows each source's status and a rolling transcript. Suggestions can appear after newly transcribed speech, with an 18-second minimum interval between automatic requests. Typed questions use the same context.
4. Click **End live session** to stop capture and return to history. Whispercue saves text transcripts and answers in the Windows user profile. It keeps the latest screenshot in memory and uses it only as local inference context.

Screen context samples the display under the pointer every 3.5 seconds. **Live text** runs local OCR on changed frames and gives the answer model the visible text. **Live vision** provides the latest screenshot directly to Qwen3‑VL 2B Instruct, which can interpret charts, images, and layout at a higher compute cost. Set up live AI again when switching models. Live vision uses about 2.2 GB for its model and speech runtime, plus space for Ollama. **Off** keeps live audio and suggestions active. **Text chat** accepts typed questions without capture.

If GPU inference stalls, quit the running Ollama instance and start it from PowerShell with `$env:CUDA_VISIBLE_DEVICES = '-1'` and `$env:OLLAMA_VULKAN = '0'` set for that process. Screen-based suggestions may take longer on CPU. For an offline-only Ollama setup, enable its no-cloud setting. [Ollama FAQ](https://docs.ollama.com/faq)

## Run from source

Use Windows x64 and Node.js 22.12 or newer within the supported LTS lines. Start Ollama before setting up live AI. To use manual text chat, pull the default model below or choose an installed local model in Settings.

```powershell
ollama pull qwen2.5:1.5b
npm ci
npm run build
npm start
```

Start a session, type a prompt and send it. Use the square control in the compact widget to end the session, or select **Stop session** from the session menu.

The main process sends the current conversation to the Ollama-compatible chat endpoint at `127.0.0.1:11434`. With a downloaded local model, Whispercue requires no subscription or per-request API key. Model storage, hardware and inference time depend on the selected model.

## Build and distribute

```powershell
npm run package:windows
```

The installer, block map and `latest.yml` are written to `release`. The installer filename is `Whispercue-Setup-<version>.exe`. This command builds locally with publishing disabled. For signed builds, configure the Windows signing identity for electron-builder and verify that the installer and installed executable report a valid Authenticode signature. Keep signing credentials outside the repository.

Before promoting a release, test the signed installer on a clean Windows x64 VM. For an update test, install an older signed build, publish the new installer, block map and `latest.yml` together to the GitHub Releases feed, then use **Settings → Check for updates**. Verify restart, publisher validation, version change, preference and history retention, and uninstall. Use a controlled test feed while validating release candidates.

## 0.1.0 verification

| Check | Result |
| --- | --- |
| Type checking, renderer build and Windows x64 NSIS packaging | Passed |
| Install, open main window and uninstall on the development PC | Passed |
| Packaged UI streaming, cancellation, disconnected-backend feedback and saved history | Passed with a deterministic local HTTP fixture |
| Installed UI answer using the default local model in CPU mode | Passed |
| Update manifest filename and installer SHA-512 | Matched |
| Installer | Approximately 117 MiB, unsigned |
| Signed update, clean VM, comparative end-to-end latency and audio tests | Open |

The installed app exposed its main window in 1.08 seconds in one launch sample on the development PC. A 12-second idle sample recorded 351.8 MiB summed working set, 172.7 MiB private bytes, and 0.19 CPU-seconds across four Whispercue processes. This run used renderer accessibility for UI automation. The fixture was separate and the sample excludes inference resources.

A local model trial used Ollama 0.40.16 in CPU mode on a Ryzen 7 3700X with 32 GiB RAM. It asked three synthetic questions per model, three times each with the model warm. The criteria checked a one-word instruction, recall of an owner and deadline, and an explicit unknown when the transcript omitted the answer.

| Qwen2.5 Instruct, Q4_K_M | Warm passes | Median warm time to first text | First text with model cold |
| --- | ---: | ---: | ---: |
| 0.5B | 6/9 | 63 ms | 1,006 ms |
| 1.5B | 9/9 | 102 ms | 1,541 ms |

The 1.5B model is the default because it returned the requested fact without adding unrelated transcript details in this trial. These are loopback API timings. The separate CUDA trial reached a 90-second timeout on the first request. CPU mode completed the trial without a metered API. Electricity and hardware costs were outside the measurement.

The 0.1.0 measurements above predate the live capture pipeline. Review live performance separately with a representative meeting workload. Expanded settings, shortcuts, display transitions, and signed release verification remain open.

## 0.2.0 live verification

The installer passed install, first launch, session start and stop, and uninstall on the development PC. The microphone and system audio were active together. A synthetic question played through Windows produced a transcript about 1.2 seconds after playback and began an automatic suggestion about 2.4 seconds after playback. The answer contained a code shown only on a test screen. A short sample recorded about 2.6 GiB of private memory across Whispercue, Whisper, and Ollama.

Both screen modes recovered the test code. The first CPU live-vision suggestion took about 27 seconds in its initial probe, so live text is the default. These are controlled runs on one PC. Microphone transcription accuracy, sustained meeting load, lower-spec hardware, and signed updates still need separate verification.
