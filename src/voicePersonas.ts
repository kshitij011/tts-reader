export type VoicePersona = {
  id: string
  label: string
  description: string
  pitch: number
  rateOffset: number
  volume: number
  commaPauseMs: number
  sentencePauseMs: number
  expressive: boolean
  preferVoiceKeywords: string[]
}

export type PersonaOverrides = Partial<Pick<
  VoicePersona,
  'pitch' | 'volume' | 'commaPauseMs' | 'sentencePauseMs'
>>

export const VOICE_PERSONAS: VoicePersona[] = [
  {
    id: 'default',
    label: 'Default',
    description: 'Your selected browser voice, unchanged.',
    pitch: 1,
    rateOffset: 0,
    volume: 1,
    commaPauseMs: 150,
    sentencePauseMs: 350,
    expressive: false,
    preferVoiceKeywords: [],
  },
  {
    id: 'deep-lady',
    label: 'Deep Lady',
    description: 'Lower-pitch female-style narrator',
    pitch: 0.75,
    rateOffset: -0.05,
    volume: 1,
    commaPauseMs: 260,
    sentencePauseMs: 520,
    expressive: true,
    preferVoiceKeywords: ['female', 'woman', 'zira', 'samantha', 'aria', 'jenny', 'google uk english female'],
  },
  {
    id: 'official-soft',
    label: 'Official Soft',
    description: 'Soft neutral assistant voice',
    pitch: 1,
    rateOffset: 0,
    volume: 0.95,
    commaPauseMs: 180,
    sentencePauseMs: 400,
    expressive: false,
    preferVoiceKeywords: ['natural', 'neural', 'online', 'aria', 'jenny', 'google us english'],
  },
  {
    id: 'laid-back-rap-narrator',
    label: 'Laid-back Rap Narrator',
    description: 'Relaxed rhythmic storytelling style. Not a real celebrity voice.',
    pitch: 0.85,
    rateOffset: -0.08,
    volume: 1,
    commaPauseMs: 320,
    sentencePauseMs: 650,
    expressive: true,
    preferVoiceKeywords: ['male', 'man', 'daniel', 'alex', 'fred', 'david'],
  },
  {
    id: 'deep-man',
    label: 'Deep Man',
    description: 'Low male-style narrator',
    pitch: 0.65,
    rateOffset: -0.05,
    volume: 1,
    commaPauseMs: 240,
    sentencePauseMs: 500,
    expressive: true,
    preferVoiceKeywords: ['male', 'man', 'daniel', 'alex', 'fred', 'david', 'google uk english male'],
  },
]

export function findPersona(id: string) {
  return VOICE_PERSONAS.find((persona) => persona.id === id) ?? VOICE_PERSONAS[0]
}