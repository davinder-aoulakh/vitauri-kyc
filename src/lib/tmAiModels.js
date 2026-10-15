// Models a tenant can pin for TM AI agents. '' = not pinned: the platform's automatic selection, whose model id
// cannot be read from the app, so it is shown read-only as "Automatic".
// (glm_5_2 is left out: it cannot take file attachments, which some TM agents use.)
export const AI_MODEL_OPTIONS = [
  { value: '', label: 'Automatic (platform default)' },
  { value: 'gemini_3_8_flash', label: 'gemini_3_8_flash' },
  { value: 'gpt_6_luna', label: 'gpt_6_luna' },
  { value: 'gpt_6_sol', label: 'gpt_6_sol' },
  { value: 'gpt_6_astra', label: 'gpt_6_astra' },
  { value: 'claude-sonnet-5', label: 'claude-sonnet-5' },
  { value: 'claude_opus_5_5', label: 'claude_opus_5_5' },
  { value: 'claude_fable_5_1', label: 'claude_fable_5_1' },
];

export const MODEL_CHANGE_ROLES = ['Compliance Admin', 'Compliance Officer'];
export const MIN_NOTE = 20;
export const modelLabel = (v) => v || 'Automatic (platform default)';