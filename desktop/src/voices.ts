// Curated ElevenLabs voices for the in-chat picker. IDs are the stable public library
// voices; with the multilingual model they speak Russian too. Split by gender, ~10 each,
// with a one-to-two-word Russian descriptor.

export type Voice = { id: string; name: string; desc: string };

export const FEMALE_VOICES: Voice[] = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", desc: "спокойный" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", desc: "мягкий" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", desc: "молодой" },
  { id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", desc: "тёплый" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", desc: "чёткий" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", desc: "дружелюбный" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", desc: "живой" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", desc: "нежный" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi", desc: "уверенный" },
  { id: "MF3mGyEYCf7bMcULKgHm", name: "Elli", desc: "эмоциональный" },
];

export const MALE_VOICES: Voice[] = [
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", desc: "тёплый" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", desc: "глубокий" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", desc: "дикторский" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", desc: "низкий" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni", desc: "мягкий" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", desc: "молодой" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold", desc: "резкий" },
  { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie", desc: "естественный" },
  { id: "N2lVS1w4EtoT3dr4eOWO", name: "Callum", desc: "интенсивный" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", desc: "энергичный" },
];

export const ALL_VOICES: Voice[] = [...FEMALE_VOICES, ...MALE_VOICES];

/** Display name for a voice id ("George"), or the raw id if unknown. */
export function voiceName(id: string | undefined): string {
  if (!id) return "голос";
  return ALL_VOICES.find((v) => v.id === id)?.name ?? "свой голос";
}
