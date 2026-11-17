export type View = 'dashboard' | 'composer' | 'answer' | 'widget'
export type Message = { role: 'user' | 'assistant'; content: string }
export type AnswerRequest = { id: string; model: string; messages: Message[] }
export type AnswerEvent = { id: string; text: string }
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
}
