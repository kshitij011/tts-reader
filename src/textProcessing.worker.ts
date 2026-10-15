import { processText } from './textProcessing'
import type { TextProcessingOptions } from './textProcessing'

type WorkerRequest = {
  requestId: number
  text: string
  options: TextProcessingOptions
}

type WorkerResponse = {
  requestId: number
  result?: ReturnType<typeof processText>
  error?: string
}

const workerContext = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage: (message: WorkerResponse) => void
}

workerContext.onmessage = (event) => {
  try {
    workerContext.postMessage({
      requestId: event.data.requestId,
      result: processText(event.data.text, event.data.options),
    })
  } catch {
    workerContext.postMessage({ requestId: event.data.requestId, error: 'Could not process this document.' })
  }
}