export type View = 'dashboard' | 'composer' | 'answer' | 'widget'
export type Message = { role: 'user' | 'assistant'; content: string }
export type AnswerRequest = { id: string; model: string; messages: Message[]; liveContext?: string; automatic?: boolean }
export type AnswerEvent = { id: string; text: string }
export type AudioSource = 'microphone' | 'system'
export type ScreenMode = 'off' | 'text' | 'vision'
export type LiveOptions = { microphone: boolean; system: boolean; screen: ScreenMode }
export type LiveStatus = { screen?: 'off' | 'waiting' | 'ready' | 'unavailable'; speechError?: string }
export interface DesktopAPI {
  version(): Promise<string>
  checkUpdate(): Promise<'development' | 'current' | 'ready'>
  installUpdate(): Promise<void>
  setView(view: View): Promise<void>
  windowAction(action: 'minimize' | 'maximize' | 'close'): Promise<void>
  answer(request: AnswerRequest): Promise<void>
  cancelAnswer(id: string): Promise<void>
  onAnswer(listener: (event: AnswerEvent) => void): () => void
  copy(text: string): Promise<void>
  startLive(options: LiveOptions): Promise<void>
  prepareLive(options: LiveOptions, model: string): Promise<void>
  stopLive(): Promise<void>
  transcribe(wav: ArrayBuffer): Promise<string>
  onLiveStatus(listener: (status: LiveStatus) => void): () => void
}
