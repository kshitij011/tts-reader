import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  AudioLines,
  BookOpenText,
  Check,
  ChevronDown,
  CircleStop,
  Download,
  FileText,
  Headphones,
  Keyboard,
  Moon,
  Pause,
  PenLine,
  Play,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  Sun,
  Trash2,
  Volume2,
} from 'lucide-react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { createSpeakSegments, findTokenIndexByOffset, processText, SPEECH_RATES, tokenize } from './textProcessing'
import type { PlayerStatus, SpeakSegment, Token } from './textProcessing'
import { findPersona, VOICE_PERSONAS } from './voicePersonas'
import type { PersonaOverrides, VoicePersona } from './voicePersonas'

const RATE_STORAGE_KEY = 'stillvoice:rate'
const VOICE_STORAGE_KEY = 'stillvoice:voice'
const SESSION_STORAGE_KEY = 'stillvoice:session'
const WORD_COLOR_DEFAULT = '#facc15'
const SENTENCE_COLOR_DEFAULT = '#facc15'

type ThemePreference = 'system' | 'light' | 'dark'
type ContentMode = 'edit' | 'reader' | 'preview'
type SidebarTab = 'playback' | 'voice' | 'settings'
type StoredSession = {
  documentId: string
  text: string
  lastOffset: number
  selectedPersonaId: string
  selectedRate: number
  selectedVoiceURI: string
  manualVoiceSelection: boolean
  personaOverrides: Record<string, PersonaOverrides>
  themePreference: ThemePreference
  wordColor: string
  sentenceColor: string
  skipCodeBlocks: boolean
  skipLinks: boolean
}
type ProcessedText = ReturnType<typeof processText>
type AsyncProcessedText = {
  sourceText: string
  optionsKey: string
  result: ProcessedText
}

const LARGE_DOCUMENT_THRESHOLD = 120_000
const EMPTY_PROCESSED_TEXT: ProcessedText = { text: '', chunks: [] }

function getDocumentId(value: string) {
  return `${value.length}:${value.slice(0, 200)}`
}

function readStoredSession(): StoredSession | null {
  try {
    const stored = window.localStorage.getItem(SESSION_STORAGE_KEY)
    if (!stored) return null
    const session = JSON.parse(stored) as Partial<StoredSession>
    if (typeof session.text !== 'string' || typeof session.documentId !== 'string') return null
    return {
      documentId: session.documentId,
      text: session.text,
      lastOffset: Number.isFinite(session.lastOffset) ? Math.max(0, Number(session.lastOffset)) : 0,
      selectedPersonaId: typeof session.selectedPersonaId === 'string' ? session.selectedPersonaId : 'default',
      selectedRate: Number.isFinite(session.selectedRate) ? Number(session.selectedRate) : 1,
      selectedVoiceURI: typeof session.selectedVoiceURI === 'string' ? session.selectedVoiceURI : '',
      manualVoiceSelection: Boolean(session.manualVoiceSelection),
      personaOverrides: session.personaOverrides ?? {},
      themePreference: session.themePreference === 'dark' || session.themePreference === 'light' ? session.themePreference : 'system',
      wordColor: typeof session.wordColor === 'string' ? session.wordColor : WORD_COLOR_DEFAULT,
      sentenceColor: typeof session.sentenceColor === 'string' ? session.sentenceColor : SENTENCE_COLOR_DEFAULT,
      skipCodeBlocks: session.skipCodeBlocks !== false,
      skipLinks: session.skipLinks !== false,
    }
  } catch {
    return null
  }
}

let voiceSnapshot: SpeechSynthesisVoice[] = []

function getVoicesSnapshot() {
  return voiceSnapshot
}

function subscribeToVoices(listener: () => void) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return () => {}
  const synthesis = window.speechSynthesis
  const updateSnapshot = () => {
    voiceSnapshot = synthesis.getVoices()
    listener()
  }
  voiceSnapshot = synthesis.getVoices()
  synthesis.addEventListener('voiceschanged', updateSnapshot)
  return () => synthesis.removeEventListener('voiceschanged', updateSnapshot)
}

function readSavedRate() {
  try {
    const savedRate = Number(window.localStorage.getItem(RATE_STORAGE_KEY))
    return SPEECH_RATES.includes(savedRate as (typeof SPEECH_RATES)[number]) ? savedRate : 1
  } catch {
    return 1
  }
}

function readSavedVoice() {
  try {
    return window.localStorage.getItem(VOICE_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

const NATURAL_VOICE_KEYWORDS = ['natural', 'online', 'aria', 'jenny', 'guy', 'davis', 'sonia']
const APPLE_NEURAL_KEYWORDS = ['siri', 'ava', 'evan', 'neural']
const APPLE_ENHANCED_VOICE_NAMES = ['samantha', 'karen', 'daniel']
const GOOGLE_NETWORK_KEYWORDS = ['network', 'google us english network', 'google uk english network']
const LEGACY_VOICE_KEYWORDS = ['david', 'zira', 'mark', 'espeak', 'mbrola', 'festival', 'cepstral']

function isPreferredNaturalVoice(voice: SpeechSynthesisVoice) {
  const name = voice.name.toLowerCase()
  const hasAppleEnhancedName = APPLE_ENHANCED_VOICE_NAMES.some((voiceName) =>
    new RegExp(`\\b${voiceName}\\s*\\((?:enhanced|premium)\\)`, 'i').test(name),
  )
  return [
    ...NATURAL_VOICE_KEYWORDS,
    ...APPLE_NEURAL_KEYWORDS,
    ...GOOGLE_NETWORK_KEYWORDS,
  ].some((keyword) => name.includes(keyword)) || hasAppleEnhancedName
}

function getBestVoice(availableVoices: SpeechSynthesisVoice[]) {
  const naturalVoice = availableVoices.find(isPreferredNaturalVoice)
  if (naturalVoice) return naturalVoice

  const nonLegacyVoice = availableVoices.find((voice) =>
    !LEGACY_VOICE_KEYWORDS.some((keyword) => voice.name.toLowerCase().includes(keyword)),
  )
  return nonLegacyVoice ?? availableVoices[0]
}

function getPlatformVoiceGuidance() {
  if (typeof navigator === 'undefined') return ''
  const agent = navigator.userAgent
  const platform = navigator.platform
  const isIOS = /iPhone|iPad|iPod/i.test(agent) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isWindows = /Windows/i.test(agent) || /Win/i.test(platform)
  const isAndroid = /Android/i.test(agent)
  const isMac = !isIOS && (/Macintosh|Mac OS X/i.test(agent) || /Mac/i.test(platform))
  const isFirefox = /Firefox|FxiOS/i.test(agent)
  const isSafari = /Safari/i.test(agent) && !/Chrome|Chromium|CriOS|Edg|OPR|FxiOS/i.test(agent)

  if (isWindows && isFirefox) return "⚠️ Firefox doesn't support Natural voices. Switch to Edge/Chrome for best quality."
  if (isMac && !isSafari) return '💡 Safari provides the best voices on Mac.'
  if (isAndroid && isFirefox) return '⚠️ Use Chrome for better voice quality on Android.'
  if (isIOS && !isSafari) return '💡 Safari provides the best voices on iPhone/iPad.'
  return ''
}

function getSystemTheme() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function subscribeToSystemTheme(listener: () => void) {
  if (typeof window === 'undefined') return () => {}
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

function countRemainingWords(tokens: Token[], offset: number) {
  let low = 0
  let high = tokens.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (tokens[middle].end <= offset) low = middle + 1
    else high = middle
  }
  return tokens.length - low
}

function formatDuration(seconds: number) {
  const rounded = Math.max(0, Math.ceil(seconds))
  const minutes = Math.floor(rounded / 60)
  const remainder = rounded % 60
  return minutes ? `${minutes}m ${String(remainder).padStart(2, '0')}s` : `${remainder}s`
}

function getCurrentTime() {
  return Date.now()
}

function getExportTimestamp() {
  return new Date().toISOString()
}

function readOffset(offsetRef: { current: number }) {
  return offsetRef.current
}

function App() {
  const [storedSession] = useState(readStoredSession)
  const [text, setText] = useState(() => storedSession?.text ?? '')
  const [mode, setMode] = useState<ContentMode>('edit')
  const [status, setStatus] = useState<PlayerStatus>('idle')
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0)
  const [selectedRate, setSelectedRate] = useState(() => storedSession?.selectedRate ?? readSavedRate())
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(() => storedSession?.selectedVoiceURI ?? readSavedVoice())
  const [manualVoiceSelection, setManualVoiceSelection] = useState(() => storedSession?.manualVoiceSelection ?? Boolean(readSavedVoice()))
  const [selectedPersonaId, setSelectedPersonaId] = useState(() => findPersona(storedSession?.selectedPersonaId ?? 'default').id)
  const [personaOverrides, setPersonaOverrides] = useState<Record<string, PersonaOverrides>>(() => storedSession?.personaOverrides ?? {})
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('playback')
  const [showShortcutHelp, setShowShortcutHelp] = useState(false)
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => storedSession?.themePreference ?? 'system')
  const [wordColor, setWordColor] = useState(() => storedSession?.wordColor ?? WORD_COLOR_DEFAULT)
  const [sentenceColor, setSentenceColor] = useState(() => storedSession?.sentenceColor ?? SENTENCE_COLOR_DEFAULT)
  const [skipCodeBlocks, setSkipCodeBlocks] = useState(() => storedSession?.skipCodeBlocks ?? true)
  const [skipLinks, setSkipLinks] = useState(() => storedSession?.skipLinks ?? true)
  const [resumeAvailable, setResumeAvailable] = useState(() => Boolean(storedSession?.lastOffset))
    const [asyncProcessed, setAsyncProcessed] = useState<AsyncProcessedText | null>(null)
  const [processingError, setProcessingError] = useState('')
  const voices = useSyncExternalStore(subscribeToVoices, getVoicesSnapshot, getVoicesSnapshot)
  const hasPreferredNaturalVoice = voices.some(isPreferredNaturalVoice)
  const platformVoiceGuidance = hasPreferredNaturalVoice ? '' : getPlatformVoiceGuidance()
  const bestVoiceURI = !manualVoiceSelection && !selectedVoiceURI
    ? getBestVoice(voices)?.voiceURI ?? ''
    : selectedVoiceURI
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, getSystemTheme, () => false)
  const isDark = themePreference === 'dark' || (themePreference === 'system' && systemDark)
  const personaBase = findPersona(selectedPersonaId)
  const activePersona: VoicePersona = { ...personaBase, ...personaOverrides[personaBase.id] }
  const effectiveRate = Math.max(0.1, selectedRate + activePersona.rateOffset)

  const readerRef = useRef<HTMLDivElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const progressPercentRef = useRef<HTMLSpanElement>(null)
  const remainingTimeRef = useRef<HTMLSpanElement>(null)
  const statusRef = useRef<PlayerStatus>('idle')
  const currentOffsetRef = useRef(
    storedSession && storedSession.documentId === getDocumentId(storedSession.text) ? storedSession.lastOffset : 0,
  )
  const activeTokenIndexRef = useRef(-1)
  const currentSegmentIndexRef = useRef(0)
  const boundarySeenRef = useRef(false)
  const runIdRef = useRef(0)
  const nativePauseRef = useRef(false)
  const lastScrollAtRef = useRef(0)
  const autoScrollPausedRef = useRef(false)
  const rateTimeoutRef = useRef<number | undefined>(undefined)
  const pauseTimeoutRef = useRef<number | undefined>(undefined)
  const persistTimeoutRef = useRef<number | undefined>(undefined)
  const lastPersistAtRef = useRef(0)
  const persistSessionRef = useRef<() => void>(() => {})
  const shortcutActionsRef = useRef<Record<string, () => void>>({})
  const pendingSettingsRestartRef = useRef(false)
  const clearPersistOnceRef = useRef(false)
  const workerRef = useRef<Worker | null>(null)
  const workerRequestIdRef = useRef(0)
  const pendingWorkerRequestRef = useRef<{ requestId: number; sourceText: string; optionsKey: string } | null>(null)

  const isLargeDocument = text.length > LARGE_DOCUMENT_THRESHOLD
  const processingOptionsKey = `${skipCodeBlocks}:${skipLinks}`
  const synchronousProcessed = useMemo(
    () => isLargeDocument ? null : processText(text, { skipCodeBlocks, skipLinks }),
    [text, skipCodeBlocks, skipLinks, isLargeDocument],
  )
  const matchingAsyncResult = asyncProcessed?.sourceText === text && asyncProcessed.optionsKey === processingOptionsKey
    ? asyncProcessed.result
    : null
  const isProcessingLargeDocument = isLargeDocument && matchingAsyncResult === null
  const processed = synchronousProcessed ?? matchingAsyncResult ?? EMPTY_PROCESSED_TEXT
  const tokens = useMemo(() => tokenize(processed.text), [processed.text])
  const segments = useMemo(
    () => createSpeakSegments(processed.chunks, activePersona.commaPauseMs, activePersona.sentencePauseMs),
    [processed.chunks, activePersona.commaPauseMs, activePersona.sentencePauseMs],
  )
  const previewHtml = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false })), [text])
  const canSpeak = text.trim().length > 0 && segments.length > 0 && !isProcessingLargeDocument

    useEffect(() => {
      const worker = new Worker(new URL('./textProcessing.worker.ts', import.meta.url), { type: 'module' })
      workerRef.current = worker
      worker.onmessage = (event: MessageEvent<{ requestId: number; result?: ProcessedText; error?: string }>) => {
        const pending = pendingWorkerRequestRef.current
        if (!pending || event.data.requestId !== pending.requestId) return
        if (event.data.error) {
          setProcessingError(event.data.error)
          return
        }
        if (!event.data.result) return
        setAsyncProcessed({ sourceText: pending.sourceText, optionsKey: pending.optionsKey, result: event.data.result })
      }
      worker.onerror = () => setProcessingError('Could not process this document. Try a smaller file.')
      return () => {
        pendingWorkerRequestRef.current = null
        worker.terminate()
        workerRef.current = null
      }
    }, [])

    useEffect(() => {
      if (!isLargeDocument || !workerRef.current) {
        if (!isLargeDocument) pendingWorkerRequestRef.current = null
        return
      }
      const requestId = ++workerRequestIdRef.current
      const options = { skipCodeBlocks, skipLinks }
      pendingWorkerRequestRef.current = { requestId, sourceText: text, optionsKey: processingOptionsKey }
      const timer = window.setTimeout(() => {
        workerRef.current?.postMessage({ requestId, text, options })
      }, 100)
      return () => window.clearTimeout(timer)
    }, [text, skipCodeBlocks, skipLinks, isLargeDocument, processingOptionsKey])
  const estimatedSeconds = Math.ceil(tokens.length * 60 / (170 * effectiveRate))

  const saveSession = (offset = readOffset(currentOffsetRef)) => {
    try {
      const session: StoredSession = {
        documentId: getDocumentId(text),
        text,
        lastOffset: offset,
        selectedPersonaId,
        selectedRate,
        selectedVoiceURI,
        manualVoiceSelection,
        personaOverrides,
        themePreference,
        wordColor,
        sentenceColor,
        skipCodeBlocks,
        skipLinks,
      }
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
      lastPersistAtRef.current = getCurrentTime()
    } catch {
      // The reader remains usable when local storage is unavailable.
    }
  }
  const scheduleSessionSave = () => {
    if (persistTimeoutRef.current !== undefined) return
    const delay = Math.max(0, 700 - (getCurrentTime() - lastPersistAtRef.current))
    persistTimeoutRef.current = window.setTimeout(() => {
      persistTimeoutRef.current = undefined
      persistSessionRef.current()
    }, delay)
  }

  const updateStatus = (nextStatus: PlayerStatus) => {
    statusRef.current = nextStatus
    setStatus(nextStatus)
  }

  const updateProgress = (offset: number) => {
    currentOffsetRef.current = offset
    const percent = processed.text.length ? Math.min(100, Math.round((offset / processed.text.length) * 100)) : 0
    if (progressRef.current) {
      progressRef.current.style.width = `${percent}%`
      progressRef.current.parentElement?.setAttribute('aria-valuenow', String(percent))
    }
    if (progressPercentRef.current) progressPercentRef.current.textContent = `Progress: ${percent}%`
    if (remainingTimeRef.current) {
      const remaining = countRemainingWords(tokens, offset) * 60 / (170 * effectiveRate)
      remainingTimeRef.current.textContent = `Estimated time left: ${formatDuration(remaining)}`
    }
    setResumeAvailable(offset > 0)
    scheduleSessionSave()
  }

  const clearHighlights = () => {
    readerRef.current?.querySelectorAll('.active-word, .active-sentence').forEach((element) => {
      element.classList.remove('active-word', 'active-sentence')
    })
    activeTokenIndexRef.current = -1
  }

  const highlightSegment = (segment: SpeakSegment) => {
    const reader = readerRef.current
    if (!reader) return
    reader.querySelectorAll('.active-sentence').forEach((element) => element.classList.remove('active-sentence'))
    reader.querySelector('.active-word')?.classList.remove('active-word')
    activeTokenIndexRef.current = -1
    let firstActive: HTMLElement | null = null
    reader.querySelectorAll<HTMLElement>('[data-start][data-end]').forEach((element) => {
      const tokenStart = Number(element.dataset.start)
      const tokenEnd = Number(element.dataset.end)
      if (tokenStart < segment.end && tokenEnd > segment.start) {
        element.classList.add('active-sentence')
        firstActive ??= element
      }
    })
    if (firstActive) scrollToActiveToken(firstActive)
  }

  const highlightToken = (tokenIndex: number) => {
    if (tokenIndex < 0 || tokenIndex === activeTokenIndexRef.current) return
    const reader = readerRef.current
    if (!reader) return
    reader.querySelector('.active-word')?.classList.remove('active-word')
    const active = reader.querySelector<HTMLElement>(`[data-token-index="${tokenIndex}"]`)
    if (!active) return
    active.classList.add('active-word')
    activeTokenIndexRef.current = tokenIndex
    scrollToActiveToken(active)
  }

  const scrollToActiveToken = (active: HTMLElement) => {
    if (autoScrollPausedRef.current) return
    const now = getCurrentTime()
    if (now - lastScrollAtRef.current > 140) {
      active.scrollIntoView({ block: 'center', behavior: 'smooth' })
      lastScrollAtRef.current = now
    }
  }

  const speakSegment = (
    segmentIndex: number,
    startOffset: number,
    runId: number,
    rate = selectedRate,
    voiceURI = bestVoiceURI,
    persona = activePersona,
  ) => {
    const segment = segments[segmentIndex]
    if (!segment || runId !== runIdRef.current) return
    const localStart = Math.max(0, startOffset - segment.start)
    const spokenText = segment.text.slice(localStart)
    if (!spokenText) {
      const nextIndex = segmentIndex + 1
      if (nextIndex < segments.length) speakSegment(nextIndex, segments[nextIndex].start, runId, rate, voiceURI, persona)
      else updateStatus('finished')
      return
    }

    currentSegmentIndexRef.current = segmentIndex
    setCurrentSegmentIndex(segmentIndex)
    boundarySeenRef.current = false
    const utterance = new SpeechSynthesisUtterance(spokenText)
    const mark = segment.text.trimEnd().match(/[!?.,;:](?:["')\]]*)$/)?.[0]?.[0] ?? ''
    const expressive = persona.expressive
    const expressivePitch = expressive && mark === '!' ? 0.05 : expressive && mark === '?' ? 0.03 : 0
    const expressiveRate = expressive && mark === '!' ? 0.03 : expressive && segment.punctuationType === 'comma' ? -0.02 : 0
    try {
      utterance.rate = Math.min(2, Math.max(0.1, rate + persona.rateOffset + expressiveRate))
      utterance.pitch = Math.min(2, Math.max(0.5, persona.pitch + expressivePitch))
      utterance.volume = Math.min(1, Math.max(0, persona.volume))
    } catch {
      // Unsupported rate, pitch, or volume settings should not block speech.
    }
    const voice = voices.find((candidate) => candidate.voiceURI === voiceURI)
    if (voice) utterance.voice = voice

    utterance.onstart = () => {
      if (runId !== runIdRef.current) return
      updateStatus('speaking')
      updateProgress(startOffset)
      highlightSegment(segment)
    }
    utterance.onboundary = (event) => {
      if (runId !== runIdRef.current) return
      boundarySeenRef.current = true
      const globalOffset = Math.min(segment.end - 1, startOffset + event.charIndex)
      updateProgress(globalOffset)
      highlightToken(findTokenIndexByOffset(tokens, globalOffset))
    }
    utterance.onend = () => {
      if (runId !== runIdRef.current) return
      updateProgress(segment.end)
      const nextIndex = segmentIndex + 1
      if (nextIndex < segments.length) {
        const continuePlayback = () => {
          pauseTimeoutRef.current = undefined
          if (runId === runIdRef.current) {
            speakSegment(nextIndex, segments[nextIndex].start, runId, rate, voiceURI, persona)
          }
        }
        if (segment.pauseAfterMs > 0) {
          pauseTimeoutRef.current = window.setTimeout(continuePlayback, segment.pauseAfterMs)
        } else {
          continuePlayback()
        }
      } else {
        clearHighlights()
        updateStatus('finished')
      }
    }
    utterance.onerror = (event) => {
      if (runId !== runIdRef.current || event.error === 'canceled' || event.error === 'interrupted') return
      clearHighlights()
      updateStatus('error')
    }

    updateStatus('loading')
    try {
      window.speechSynthesis.speak(utterance)
    } catch {
      clearHighlights()
      updateStatus('error')
    }
  }

  const startFromOffset = (
    offset: number,
    runId: number,
    rate = selectedRate,
    voiceURI = bestVoiceURI,
    persona = activePersona,
  ) => {
    const start = Math.max(0, Math.min(offset, processed.text.length))
    const segmentIndex = segments.findIndex((segment) => segment.end > start)
    if (segmentIndex === -1) {
      updateProgress(processed.text.length)
      updateStatus('finished')
      return
    }
    const segment = segments[segmentIndex]
    speakSegment(segmentIndex, Math.max(start, segment.start), runId, rate, voiceURI, persona)
  }

  const cancelSpeech = () => {
    runIdRef.current += 1
    if (pauseTimeoutRef.current !== undefined) window.clearTimeout(pauseTimeoutRef.current)
    pauseTimeoutRef.current = undefined
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  }

  const handlePlay = () => {
    if (!canSpeak) return
    if (!('speechSynthesis' in window)) {
      updateStatus('error')
      return
    }
    const resumeOffset = statusRef.current === 'finished' ? 0 : currentOffsetRef.current
    cancelSpeech()
    const runId = runIdRef.current
    nativePauseRef.current = false
    autoScrollPausedRef.current = false
    setMode('reader')
    clearHighlights()
    startFromOffset(resumeOffset, runId)
  }

  const handlePause = () => {
    if (statusRef.current !== 'speaking') return
    if (pauseTimeoutRef.current !== undefined) {
      window.clearTimeout(pauseTimeoutRef.current)
      pauseTimeoutRef.current = undefined
      nativePauseRef.current = false
      updateStatus('paused')
      saveSession()
      return
    }
    let isPaused = false
    try {
      window.speechSynthesis.pause()
      isPaused = window.speechSynthesis.paused
    } catch {
      // Fall back to cancel-and-resume from the saved offset below.
    }
    if (isPaused) {
      nativePauseRef.current = true
      updateStatus('paused')
      saveSession()
      return
    }
    const savedOffset = currentOffsetRef.current
    cancelSpeech()
    nativePauseRef.current = false
    updateProgress(savedOffset)
    updateStatus('paused')
    saveSession(savedOffset)
  }

  const handleResume = () => {
    if (statusRef.current !== 'paused') return
    autoScrollPausedRef.current = false
    if (nativePauseRef.current) {
      let isPaused = false
      try {
        window.speechSynthesis.resume()
        isPaused = window.speechSynthesis.paused
      } catch {
        // Restart the current offset if native resume is unavailable.
      }
      if (isPaused) {
        nativePauseRef.current = false
        cancelSpeech()
        startFromOffset(currentOffsetRef.current, runIdRef.current)
        return
      }
      nativePauseRef.current = false
      updateStatus('speaking')
      return
    }
    startFromOffset(currentOffsetRef.current, runIdRef.current)
  }

  const handleStop = () => {
    cancelSpeech()
    nativePauseRef.current = false
    updateProgress(0)
    clearHighlights()
    currentSegmentIndexRef.current = 0
    setCurrentSegmentIndex(0)
    updateStatus('idle')
    saveSession(0)
  }

  const handleRateChange = (value: number) => {
    setSelectedRate(value)
    try {
      window.localStorage.setItem(RATE_STORAGE_KEY, String(value))
    } catch {
      // Local storage can be unavailable in private browsing modes.
    }
    if (rateTimeoutRef.current) window.clearTimeout(rateTimeoutRef.current)
    if (statusRef.current === 'paused' && nativePauseRef.current) {
      cancelSpeech()
      nativePauseRef.current = false
    }
    if (statusRef.current === 'speaking') {
      rateTimeoutRef.current = window.setTimeout(() => {
        const offset = currentOffsetRef.current
        cancelSpeech()
        startFromOffset(offset, runIdRef.current, value)
      }, 300)
    }
    saveSession()
  }

  const handleVoiceChange = (voiceURI: string) => {
    setSelectedVoiceURI(voiceURI)
    setManualVoiceSelection(true)
    try {
      window.localStorage.setItem(VOICE_STORAGE_KEY, voiceURI)
    } catch {
      // Local storage can be unavailable in private browsing modes.
    }
    if (statusRef.current === 'speaking' || statusRef.current === 'loading') {
      const offset = currentOffsetRef.current
      cancelSpeech()
      startFromOffset(offset, runIdRef.current, selectedRate, voiceURI)
    } else if (statusRef.current === 'paused' && nativePauseRef.current) {
      cancelSpeech()
      nativePauseRef.current = false
    }
    saveSession()
  }

  const handlePersonaChange = (personaId: string) => {
    const persona = findPersona(personaId)
    setSelectedPersonaId(persona.id)
    let recommendedVoice = selectedVoiceURI
    if (!manualVoiceSelection && persona.preferVoiceKeywords.length) {
      const keywords = persona.preferVoiceKeywords.map((keyword) => keyword.toLowerCase())
      recommendedVoice = voices.find((voice) => keywords.some((keyword) => voice.name.toLowerCase().includes(keyword)))?.voiceURI ?? selectedVoiceURI
      if (recommendedVoice !== selectedVoiceURI) setSelectedVoiceURI(recommendedVoice)
    }
    if (statusRef.current === 'speaking' || statusRef.current === 'loading') {
      pendingSettingsRestartRef.current = true
      cancelSpeech()
    } else if (statusRef.current === 'paused' && nativePauseRef.current) {
      cancelSpeech()
      nativePauseRef.current = false
    }
    saveSession()
  }

  const updatePersonaOverride = <K extends keyof PersonaOverrides>(key: K, value: NonNullable<PersonaOverrides[K]>) => {
    const nextOverrides = { ...personaOverrides, [activePersona.id]: { ...personaOverrides[activePersona.id], [key]: value } }
    setPersonaOverrides(nextOverrides)
    if (statusRef.current === 'speaking' || statusRef.current === 'loading') {
      pendingSettingsRestartRef.current = true
      cancelSpeech()
    } else if (statusRef.current === 'paused' && nativePauseRef.current) {
      cancelSpeech()
      nativePauseRef.current = false
    }
    saveSession()
  }

  const handleResumeSaved = () => {
    const currentOffset = readOffset(currentOffsetRef)
    const offset = currentOffset > 0 ? currentOffset : storedSession?.lastOffset ?? 0
    if (!canSpeak || offset <= 0) return
    cancelSpeech()
    nativePauseRef.current = false
    autoScrollPausedRef.current = false
    setMode('reader')
    startFromOffset(offset, runIdRef.current)
  }

  const handleStartOver = () => {
    cancelSpeech()
    nativePauseRef.current = false
    autoScrollPausedRef.current = false
    clearHighlights()
    setMode('reader')
    updateProgress(0)
    startFromOffset(0, runIdRef.current)
  }

  const handleSkipSegment = (direction: -1 | 1) => {
    if (!processed.chunks.length) return
    const activeSegment = segments[currentSegmentIndexRef.current]
    const currentChunkIndex = activeSegment
      ? processed.chunks.findIndex((chunk) => activeSegment.start < chunk.end && activeSegment.end > chunk.start)
      : 0
    const nextIndex = Math.max(0, Math.min(processed.chunks.length - 1, currentChunkIndex + direction))
    const offset = processed.chunks[nextIndex].start
    cancelSpeech()
    nativePauseRef.current = false
    autoScrollPausedRef.current = false
    setMode('reader')
    startFromOffset(offset, runIdRef.current)
  }

  const handleToggleTheme = () => setThemePreference(isDark ? 'light' : 'dark')

  const handleTogglePlayback = () => {
    if (statusRef.current === 'speaking' || statusRef.current === 'loading') handlePause()
    else if (statusRef.current === 'paused') handleResume()
    else handlePlay()
  }

  const handleSpeedStep = (direction: -1 | 1) => {
    const currentIndex = SPEECH_RATES.indexOf(selectedRate as (typeof SPEECH_RATES)[number])
    const nextIndex = Math.max(0, Math.min(SPEECH_RATES.length - 1, currentIndex + direction))
    handleRateChange(SPEECH_RATES[nextIndex])
  }

  const handleExportSession = () => {
    const payload = {
      version: 1,
      exportedAt: getExportTimestamp(),
      text,
      settings: {
        rate: selectedRate,
        voiceURI: selectedVoiceURI || null,
        personaId: activePersona.id,
        pitch: activePersona.pitch,
        volume: activePersona.volume,
        commaPauseMs: activePersona.commaPauseMs,
        sentencePauseMs: activePersona.sentencePauseMs,
        darkMode: isDark,
        highlightWordColor: wordColor,
        highlightSentenceColor: sentenceColor,
        skipCodeBlocks,
        skipLinks,
      },
      position: {
        lastOffset: readOffset(currentOffsetRef),
        estimatedRemainingSeconds: tokens.length
          ? Math.ceil(countRemainingWords(tokens, readOffset(currentOffsetRef)) * 60 / (170 * effectiveRate))
          : null,
      },
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const downloadUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = 'reading-session.json'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
  }

  const setProcessingOption = (option: 'skipCodeBlocks' | 'skipLinks', value: boolean) => {
    handleStop()
    if (option === 'skipCodeBlocks') setSkipCodeBlocks(value)
    else setSkipLinks(value)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      const editingText = target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)
      const formControl = target instanceof HTMLInputElement || target instanceof HTMLSelectElement
      if (event.key === 'Escape') {
        event.preventDefault()
        shortcutActionsRef.current.stop()
        return
      }
      if (editingText || formControl || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.code === 'Space') {
        event.preventDefault()
        shortcutActionsRef.current.toggle()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        shortcutActionsRef.current.previous()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        shortcutActionsRef.current.next()
      } else if (['+', '=', 'Add'].includes(event.key)) {
        event.preventDefault()
        shortcutActionsRef.current.faster()
      } else if (['-', '_', 'Subtract'].includes(event.key)) {
        event.preventDefault()
        shortcutActionsRef.current.slower()
      } else if (event.key.toLowerCase() === 'd') {
        shortcutActionsRef.current.theme()
      } else if (event.key.toLowerCase() === 'm') {
        shortcutActionsRef.current.preview()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    shortcutActionsRef.current = {
      toggle: handleTogglePlayback,
      stop: handleStop,
      previous: () => handleSkipSegment(-1),
      next: () => handleSkipSegment(1),
      faster: () => handleSpeedStep(1),
      slower: () => handleSpeedStep(-1),
      theme: handleToggleTheme,
      preview: () => setMode((currentMode) => currentMode === 'preview' ? 'reader' : 'preview'),
    }
  })

  const restartFromSettings = useEffectEvent(() => {
    startFromOffset(currentOffsetRef.current, runIdRef.current)
  })

  useEffect(() => {
    persistSessionRef.current = () => saveSession()
  })

  useEffect(() => {
    if (clearPersistOnceRef.current) {
      clearPersistOnceRef.current = false
      return
    }
    persistSessionRef.current()
  }, [
    text,
    selectedPersonaId,
    selectedRate,
    selectedVoiceURI,
    manualVoiceSelection,
    personaOverrides,
    themePreference,
    wordColor,
    sentenceColor,
    skipCodeBlocks,
    skipLinks,
  ])

  useEffect(() => {
    if (!pendingSettingsRestartRef.current) return
    pendingSettingsRestartRef.current = false
    restartFromSettings()
  }, [segments, selectedPersonaId, personaOverrides])

  const handleTextChange = (nextText: string) => {
    cancelSpeech()
    clearHighlights()
    setProcessingError('')
    currentOffsetRef.current = 0
    setResumeAvailable(false)
    setCurrentSegmentIndex(0)
    currentSegmentIndexRef.current = 0
    updateStatus('idle')
    setText(nextText)
  }

  const handleClearSavedData = () => {
    cancelSpeech()
    clearPersistOnceRef.current = true
    if (persistTimeoutRef.current !== undefined) window.clearTimeout(persistTimeoutRef.current)
    persistTimeoutRef.current = undefined
    for (const key of [SESSION_STORAGE_KEY, RATE_STORAGE_KEY, VOICE_STORAGE_KEY]) {
      try {
        window.localStorage.removeItem(key)
      } catch {
        // Clearing storage is best-effort in restricted browser modes.
      }
    }
    currentOffsetRef.current = 0
    setText('')
    setSelectedRate(1)
    setSelectedVoiceURI('')
    setManualVoiceSelection(false)
    setSelectedPersonaId('default')
    setPersonaOverrides({})
    setThemePreference('system')
    setWordColor(WORD_COLOR_DEFAULT)
    setSentenceColor(SENTENCE_COLOR_DEFAULT)
    setSkipCodeBlocks(true)
    setSkipLinks(true)
    setResumeAvailable(false)
    setCurrentSegmentIndex(0)
    currentSegmentIndexRef.current = 0
    setMode('edit')
    setProcessingError('')
    updateStatus('idle')
  }

  useEffect(() => () => {
    if (rateTimeoutRef.current) window.clearTimeout(rateTimeoutRef.current)
    if (pauseTimeoutRef.current !== undefined) window.clearTimeout(pauseTimeoutRef.current)
    if (persistTimeoutRef.current !== undefined) window.clearTimeout(persistTimeoutRef.current)
    cancelSpeech()
  }, [])

  const tokensToRender = (wordTokens: Token[]): ReactNode[] => {
    const rendered: ReactNode[] = []
    let cursor = 0
    wordTokens.forEach((token, index) => {
      if (token.start > cursor) rendered.push(processed.text.slice(cursor, token.start))
      rendered.push(
        <span
          className="reader-token"
          data-start={token.start}
          data-end={token.end}
          data-token-index={index}
          key={token.start}
        >
          {token.text}
        </span>,
      )
      cursor = token.end
    })
    if (cursor < processed.text.length) rendered.push(processed.text.slice(cursor))
    return rendered
  }

  return (
    <main
      className={`app-shell flex min-h-svh${isDark ? ' dark is-dark' : ''}`}
      style={{ '--highlight-word-bg': wordColor, '--highlight-sentence-color': sentenceColor } as CSSProperties}
    >
      <section className="workspace-panel" aria-label="Document reader">
        <header className="workspace-header">
          <div className="workspace-mark" aria-hidden="true"><AudioLines size={17} strokeWidth={1.8} /></div>
          <div className="workspace-label">YOUR READING DESK</div>
          <div className="workspace-divider" />
          <div className="document-name"><FileText size={15} /> <span>{text.trim() ? 'Untitled document' : 'New document'}</span></div>
          <div className="privacy-label"><span /> Stays on this device</div>
        </header>

        <div className="document-toolbar">
          <div className="mode-switch" role="tablist" aria-label="Document mode">
            <button className={mode === 'edit' ? 'mode-tab is-selected' : 'mode-tab'} onClick={() => setMode('edit')} role="tab" aria-selected={mode === 'edit'}>
              <PenLine size={15} /> Edit
            </button>
            <button className={mode === 'reader' ? 'mode-tab is-selected' : 'mode-tab'} onClick={() => setMode('reader')} role="tab" aria-selected={mode === 'reader'}>
              <BookOpenText size={15} /> Reader
            </button>
            <button className={mode === 'preview' ? 'mode-tab is-selected' : 'mode-tab'} onClick={() => setMode('preview')} role="tab" aria-selected={mode === 'preview'}>
              <FileText size={15} /> Preview
            </button>
          </div>
          <div className="document-meta">
            <span>{isProcessingLargeDocument ? 'Preparing document…' : text.trim() ? `${tokens.length.toLocaleString()} words` : 'A quiet place for long reads'}</span>
            {text.trim() && !isProcessingLargeDocument && <span className="meta-dot">·</span>}
            {text.trim() && !isProcessingLargeDocument && <span>{Math.max(1, Math.ceil(tokens.length / 150))} min read</span>}
          </div>
        </div>

        <div className="document-stage">
          {mode === 'edit' ? (
            <div className="editor-wrap">
              <textarea
                aria-label="Document text"
                className="document-editor"
                value={text}
                onChange={(event) => handleTextChange(event.target.value)}
                placeholder="Paste your document or AI response here..."
                spellCheck
              />
            </div>
          ) : mode === 'reader' && isProcessingLargeDocument ? (
            <div className="reader-empty" role="status" aria-live="polite"><BookOpenText size={23} /><p>{processingError || 'Preparing your document…'}</p></div>
          ) : mode === 'reader' && processed.text ? (
            <div
              className="reader-scroll"
              ref={readerRef}
              aria-label="Reader text"
              role="region"
              tabIndex={0}
              onWheel={() => { autoScrollPausedRef.current = true }}
              onTouchStart={() => { autoScrollPausedRef.current = true }}
              onPointerDown={() => { autoScrollPausedRef.current = true }}
              onKeyDown={(event) => {
                if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
                  autoScrollPausedRef.current = true
                }
              }}
            >
              <article className="reader-copy" style={{ whiteSpace: 'pre-wrap' }}>{tokensToRender(tokens)}</article>
            </div>
          ) : mode === 'preview' && text ? (
            <div className="reader-scroll markdown-preview" aria-label="Markdown preview" role="region" tabIndex={0} dangerouslySetInnerHTML={{ __html: previewHtml }} />
          ) : (
            <div className="reader-empty">
              <BookOpenText size={23} strokeWidth={1.5} />
              <p>Your reading space is ready.</p>
              <button onClick={() => setMode('edit')}>Add something to read <span aria-hidden="true">→</span></button>
            </div>
          )}
        </div>

        <footer className="workspace-footer">
          <span><span className="footer-live-dot" /> PRIVATE BY DESIGN</span>
          <span>No uploads. No accounts. Just your browser.</span>
        </footer>
      </section>

      <aside className="control-panel" aria-label="Reader controls">
        <div className="sidebar-fixed-header">
          <div className="sidebar-topline"><span>STILLVOICE</span><span className="version-mark">LOCAL READER <span>01</span></span></div>
          <div className="sidebar-brand-row">
            <div className="brand-block">
              <div className="brand-icon"><Headphones size={19} strokeWidth={1.7} /></div>
              <h1>Stillvoice</h1>
              <p>A little space to listen.</p>
            </div>
            <button
              className="quick-play-button"
              onClick={handleTogglePlayback}
              disabled={!canSpeak || !speechSupported}
              aria-label={status === 'speaking' || status === 'loading' ? 'Pause playback' : status === 'paused' ? 'Resume playback' : 'Play again'}
              title={status === 'speaking' || status === 'loading' ? 'Pause' : status === 'paused' ? 'Resume' : 'Play again'}
            >
              {status === 'speaking' || status === 'loading' ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
              <span>{status === 'speaking' || status === 'loading' ? 'Pause' : status === 'paused' ? 'Resume' : 'Play again'}</span>
            </button>
          </div>
        </div>

        <div className="sidebar-scroll-area">
          <div className="sidebar-tabs" role="tablist" aria-label="Controls">
          <button className={sidebarTab === 'playback' ? 'sidebar-tab is-selected' : 'sidebar-tab'} role="tab" aria-selected={sidebarTab === 'playback'} onClick={() => setSidebarTab('playback')}><Play size={14} />Playback</button>
          <button className={sidebarTab === 'voice' ? 'sidebar-tab is-selected' : 'sidebar-tab'} role="tab" aria-selected={sidebarTab === 'voice'} onClick={() => setSidebarTab('voice')}><SlidersHorizontal size={14} />Voice</button>
          <button className={sidebarTab === 'settings' ? 'sidebar-tab is-selected' : 'sidebar-tab'} role="tab" aria-selected={sidebarTab === 'settings'} onClick={() => setSidebarTab('settings')}><Settings2 size={14} />Settings</button>
          </div>

        {sidebarTab === 'playback' && <div className="sidebar-content">
          <div className="player-section">
            <div className="section-heading"><span>LISTEN</span><span className="status-indicator"><i className={`status-dot ${status}`} />{statusLabel(status)}</span></div>
            <div className="transport-controls">
              <button className="play-button" onClick={handleTogglePlayback} disabled={!canSpeak || !speechSupported} aria-label={status === 'speaking' ? 'Pause playback' : status === 'paused' ? 'Resume playback' : 'Play from current position'}>
                {status === 'speaking' || status === 'loading' ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                <span>{status === 'speaking' || status === 'loading' ? 'Pause' : status === 'paused' ? 'Resume' : status === 'finished' ? 'Play again' : 'Play'}</span>
              </button>
              <button className="transport-button stop-button" onClick={handleStop} disabled={status === 'idle'} aria-label="Stop playback" title="Stop"><CircleStop size={18} /></button>
            </div>
            <div className="playback-progress" role="progressbar" aria-label="Playback progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}><div ref={progressRef} /></div>
            <div className="queue-caption"><span>{status === 'speaking' || status === 'loading' ? `Passage ${currentSegmentIndex + 1} of ${segments.length}` : 'Ready when you are'}</span><span className="queue-icon"><Volume2 size={14} /> WEB SPEECH</span></div>
            <div className="playback-stats"><span ref={progressPercentRef}>Progress: 0%</span><span ref={remainingTimeRef}>Estimated time left: {formatDuration(estimatedSeconds)}</span></div>
            <div className="playback-actions">
              <button className="quiet-button" onClick={handleResumeSaved} disabled={!canSpeak || !resumeAvailable} aria-label="Resume from saved position"><RotateCcw size={14} />Resume</button>
              <button className="quiet-button" onClick={handleStartOver} disabled={!canSpeak}><CircleStop size={14} />Start over</button>
            </div>
            <button className="shortcut-toggle" onClick={() => setShowShortcutHelp((visible) => !visible)} aria-expanded={showShortcutHelp}><Keyboard size={14} />Keyboard shortcuts <ChevronDown size={13} /></button>
            {showShortcutHelp && <div className="shortcut-list"><span><kbd>Space</kbd> Play / pause</span><span><kbd>Esc</kbd> Stop</span><span><kbd>← / →</kbd> Previous / next</span><span><kbd>+ / −</kbd> Speed</span><span><kbd>D</kbd> Dark mode</span><span><kbd>M</kbd> Markdown preview</span></div>}
          </div>
        </div>}

        {sidebarTab === 'voice' && <div className="sidebar-content voice-content">
          <section className="persona-section">
            <div className="section-heading"><span>VOICE STYLE</span><span className="voice-count">{VOICE_PERSONAS.length} STYLES</span></div>
            <div className="persona-list">
              {VOICE_PERSONAS.map((persona) => <button key={persona.id} className={selectedPersonaId === persona.id ? 'persona-card is-selected' : 'persona-card'} onClick={() => handlePersonaChange(persona.id)} aria-pressed={selectedPersonaId === persona.id}>
                <span className="persona-radio" />
                <span className="persona-copy"><strong>{persona.label}</strong><small>{persona.description}</small></span>
              </button>)}
            </div>
          </section>
          <p className="support-note">Voice style is simulated using your browser voices. Available voices depend on your device/browser.</p>
          <div className="voice-section">
            <label className="section-heading" htmlFor="voice-select"><span>BROWSER VOICE</span><span className="voice-count">{voices.length ? `${voices.length} AVAILABLE` : 'SYSTEM VOICES'}</span></label>
            <div className="select-wrap"><select id="voice-select" value={selectedVoiceURI || bestVoiceURI} onChange={(event) => handleVoiceChange(event.target.value)} disabled={!voices.length}>
              <option value="">System default</option>
              {voices.map((voice) => <option value={voice.voiceURI} key={voice.voiceURI}>{voice.name}{voice.lang ? ` · ${voice.lang}` : ''}</option>)}
            </select><ChevronDown size={15} aria-hidden="true" /></div>
            {!speechSupported && <p className="support-note warning" role="alert">Speech synthesis is not available in this browser.</p>}
            {!voices.length && speechSupported && <p className="support-note">Your browser hasn't provided any voices yet.</p>}
            {platformVoiceGuidance && <p className="support-note platform-voice-guidance" role="note">{platformVoiceGuidance}</p>}
          </div>
          <div className="control-divider" />
          <section className="voice-adjustments">
            <div className="section-heading"><span>DELIVERY</span><span className="voice-count">{activePersona.label.toUpperCase()}</span></div>
            <RangeControl label="Speaking speed" value={selectedRate} min={0} max={SPEECH_RATES.length - 1} step={1} values={SPEECH_RATES} display={`${selectedRate.toFixed(1)}x`} onChange={handleRateChange} />
            <RangeControl label="Pitch" value={activePersona.pitch} min={0.5} max={1.5} step={0.05} display={activePersona.pitch.toFixed(2)} onChange={(value) => updatePersonaOverride('pitch', value)} />
            <RangeControl label="Volume" value={activePersona.volume} min={0} max={1} step={0.05} display={`${Math.round(activePersona.volume * 100)}%`} onChange={(value) => updatePersonaOverride('volume', value)} />
            <RangeControl label="Pause after comma" value={activePersona.commaPauseMs} min={0} max={800} step={10} display={`${activePersona.commaPauseMs}ms`} onChange={(value) => updatePersonaOverride('commaPauseMs', value)} />
            <RangeControl label="Pause after sentence" value={activePersona.sentencePauseMs} min={0} max={1200} step={10} display={`${activePersona.sentencePauseMs}ms`} onChange={(value) => updatePersonaOverride('sentencePauseMs', value)} />
          </section>
        </div>}

        {sidebarTab === 'settings' && <div className="sidebar-content settings-content">
          <div className="settings-group">
            <div className="section-heading"><span>APPEARANCE</span></div>
            <button className="setting-row" onClick={handleToggleTheme} aria-label="Toggle dark mode"><span className="setting-copy"><strong>Dark mode</strong><small>{themePreference === 'system' ? 'Follows system preference' : isDark ? 'On' : 'Off'}</small></span>{isDark ? <Moon size={17} /> : <Sun size={17} />}<span className={`switch ${isDark ? 'is-on' : ''}`} /></button>
            <ColorControl label="Word highlight" value={wordColor} onChange={setWordColor} />
            <ColorControl label="Sentence highlight" value={sentenceColor} onChange={setSentenceColor} />
          </div>
          <div className="control-divider" />
          <div className="settings-group">
            <div className="section-heading"><span>READING</span></div>
            <ToggleControl label="Skip code blocks" checked={skipCodeBlocks} onChange={(value) => setProcessingOption('skipCodeBlocks', value)} />
            <ToggleControl label="Skip links" checked={skipLinks} onChange={(value) => setProcessingOption('skipLinks', value)} />
          </div>
          <div className="control-divider" />
          <div className="settings-group">
            <div className="section-heading"><span>YOUR DATA</span></div>
            <button className="action-row" onClick={handleExportSession}><Download size={15} />Export session</button>
            <button className="action-row danger-action" onClick={handleClearSavedData}><Trash2 size={15} />Clear saved data</button>
          </div>
        </div>}

        <div className="sidebar-note">
          <div className="note-icon"><Check size={14} /></div>
          <div><strong>Private by nature</strong><p>Your text never leaves this device.</p></div>
        </div>
        <div className="sidebar-bottom"><span>MADE FOR THE LONG READ</span><span aria-hidden="true">♡</span></div>
        </div>
      </aside>
    </main>
  )
}

type RangeControlProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (value: number) => void
  values?: readonly number[]
}

function RangeControl({ label, value, min, max, step, display, onChange, values }: RangeControlProps) {
  const sliderValue = values ? values.indexOf(value) : value
  return (
    <label className="range-control">
      <span className="range-heading"><span>{label}</span><strong>{display}</strong></span>
      <input type="range" min={min} max={max} step={step} value={sliderValue} onChange={(event) => onChange(values ? values[Number(event.target.value)] : Number(event.target.value))} aria-label={label} aria-valuetext={display} />
    </label>
  )
}

function ToggleControl({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="setting-row">
      <span className="setting-copy"><strong>{label}</strong></span>
      <input className="toggle-input" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className={`switch ${checked ? 'is-on' : ''}`} aria-hidden="true" />
    </label>
  )
}

function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="color-row">
      <span>{label}</span>
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} />
    </label>
  )
}

function statusLabel(status: PlayerStatus) {
  const labels: Record<PlayerStatus, string> = {
    idle: 'Idle',
    loading: 'Starting',
    speaking: 'Speaking',
    paused: 'Paused',
    finished: 'Finished',
    error: 'Could not play',
  }
  return labels[status]
}

export default App