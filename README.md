# Whispercue

Whispercue is a Windows desktop app for asking a local model questions from a floating session window. The first development build streams answers, supports cancellation and copying, and saves recent conversations for search and review. Preferences and conversations live in the Windows user profile.

## Run from source

Use Windows x64 and Node.js 22.12 or newer within the supported LTS lines. Install [Ollama for Windows](https://docs.ollama.com/windows), run it, and pull a local chat model. The default model is a starting point that can be changed in Settings.

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

Audio capture, transcription, screen context, expanded settings and shortcut coverage remain open. Visual comparisons, display transitions, failure recovery and production benchmarks are required before release.
