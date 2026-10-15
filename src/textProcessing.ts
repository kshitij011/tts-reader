export type Token = {
  text: string
  start: number
  end: number
}

export type Chunk = {
  text: string
  start: number
  end: number
}

export type SpeakSegment = {
  text: string
  start: number
  end: number
  pauseAfterMs: number
  punctuationType: 'comma' | 'sentence' | 'none'
}

export type TextProcessingOptions = {
  skipCodeBlocks?: boolean
  skipLinks?: boolean
}

export type PlayerStatus = 'idle' | 'loading' | 'speaking' | 'paused' | 'finished' | 'error'

export const SPEECH_RATES = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.4, 1.5] as const

const MAX_CHUNK_LENGTH = 250

function cleanMarkdown(input: string, options: Required<TextProcessingOptions>) {
  const codeProcessed = options.skipCodeBlocks
    ? input.replace(/```[^\n]*\n?[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ')
    : input.replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1').replace(/`([^`]*)`/g, '$1')
  const linkText = options.skipLinks
    ? codeProcessed.replace(/!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1').replace(/https?:\/\/\S+/g, ' ')
    : codeProcessed.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 $2')
  return linkText
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, '')
    .replace(/\*\*|__|~~|\*|_/g, '')
}

function sentenceRanges(paragraph: string): Array<{ text: string; index: number }> {
  if ('Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })
    return Array.from(segmenter.segment(paragraph), (part) => ({ text: part.segment, index: part.index }))
  }
  const ranges: Array<{ text: string; index: number }> = []
  const pattern = /[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g
  for (const match of paragraph.matchAll(pattern)) {
    if (match.index !== undefined) ranges.push({ text: match[0], index: match.index })
  }
  return ranges
}

function splitLongSentence(text: string, start: number): Chunk[] {
  const chunks: Chunk[] = []
  let cursor = 0
  while (cursor < text.length) {
    let end = Math.min(cursor + MAX_CHUNK_LENGTH, text.length)
    if (end < text.length) {
      const window = text.slice(cursor, end)
      const boundary = Math.max(window.lastIndexOf(' '), window.lastIndexOf('\n'), window.lastIndexOf('\t'))
      if (boundary > 0) end = cursor + boundary
    }
    const rawChunk = text.slice(cursor, end)
    const leading = rawChunk.length - rawChunk.trimStart().length
    const spokenText = rawChunk.trim()
    if (spokenText) {
      const chunkStart = start + cursor + leading
      chunks.push({ text: spokenText, start: chunkStart, end: chunkStart + spokenText.length })
    }
    cursor = end
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1
  }
  return chunks
}

export function processText(input: string, options: TextProcessingOptions = {}): { text: string; chunks: Chunk[] } {
  const text = cleanMarkdown(input.replace(/\r\n?/g, '\n'), {
    skipCodeBlocks: options.skipCodeBlocks ?? true,
    skipLinks: options.skipLinks ?? true,
  })
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const chunks: Chunk[] = []
  let searchFrom = 0
  for (const paragraph of text.split(/\n\n/)) {
    const paragraphStart = text.indexOf(paragraph, searchFrom)
    searchFrom = paragraphStart + paragraph.length
    for (const sentence of sentenceRanges(paragraph)) {
      const leading = sentence.text.length - sentence.text.trimStart().length
      const sentenceText = sentence.text.trim()
      if (!sentenceText) continue
      const sentenceStart = paragraphStart + sentence.index + leading
      if (sentenceText.length > MAX_CHUNK_LENGTH) chunks.push(...splitLongSentence(sentenceText, sentenceStart))
      else chunks.push({ text: sentenceText, start: sentenceStart, end: sentenceStart + sentenceText.length })
    }
  }
  return { text, chunks }
}

export function createSpeakSegments(
  chunks: Chunk[],
  commaPauseMs: number,
  sentencePauseMs: number,
): SpeakSegment[] {
  const segments: SpeakSegment[] = []
  const punctuationPattern = /[,;:]|[!?](?:["')\]]*)|\.(?:["')\]]*)(?=\s|$)/g

  for (const chunk of chunks) {
    let cursor = 0
    for (const match of chunk.text.matchAll(punctuationPattern)) {
      if (match.index === undefined) continue
      const localEnd = match.index + match[0].length
      const mark = match[0][0]
      const punctuationType = mark === ',' || mark === ';' || mark === ':' ? 'comma' : 'sentence'
      segments.push({
        text: chunk.text.slice(cursor, localEnd),
        start: chunk.start + cursor,
        end: chunk.start + localEnd,
        pauseAfterMs: punctuationType === 'comma' ? commaPauseMs : sentencePauseMs,
        punctuationType,
      })
      cursor = localEnd
    }
    if (cursor < chunk.text.length) {
      segments.push({
        text: chunk.text.slice(cursor),
        start: chunk.start + cursor,
        end: chunk.end,
        pauseAfterMs: 0,
        punctuationType: 'none',
      })
    }
  }
  return segments
}

export function tokenize(text: string): Token[] {
  if ('Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
    return Array.from(segmenter.segment(text))
      .filter((part) => part.isWordLike)
      .map((part) => ({ text: part.segment, start: part.index, end: part.index + part.segment.length }))
  }
  const tokens: Token[] = []
  for (const match of text.matchAll(/\S+/g)) {
    if (match.index !== undefined) tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length })
  }
  return tokens
}

export function findTokenIndexByOffset(tokens: Token[], offset: number): number {
  let left = 0
  let right = tokens.length - 1
  while (left <= right) {
    const middle = Math.floor((left + right) / 2)
    const token = tokens[middle]
    if (offset < token.start) right = middle - 1
    else if (offset >= token.end) left = middle + 1
    else return middle
  }
  return -1
}