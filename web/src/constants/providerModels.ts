/** Central provider registry — single source of truth for frontend fallbacks.
 * Primary data is fetched from GET /v1/settings/providers; this map is
 * used only as offline fallback and for synchronous UI updates.
 */
export const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o-mini', 'gpt-4o', 'o3-mini', 'o1', 'gpt-4-turbo'],
  anthropic: ['claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
  openrouter: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'meta-llama/llama-3.3-70b-instruct', 'deepseek/deepseek-chat'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  ollama: ['llama3:latest', 'mistral:latest', 'qwen2.5:latest'],
  custom: ['llama-3.3-70b-versatile', 'deepseek-chat', 'gpt-4o-mini', 'mistral-7b'],
};

export const PROVIDER_DEFAULT_BASE_URLS: Record<string, string> = {
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  deepseek: 'https://api.deepseek.com/v1',
  ollama: 'http://localhost:11434',
  custom: 'https://api.groq.com/openai/v1',
};

export const PROVIDER_FALLBACK_MODELS: string[] = ['llama-3.3-70b-versatile', 'gpt-4o-mini', 'deepseek-chat'];
