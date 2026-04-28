export const PROMPT_API_TYPES = {
  OPENAI_COMPATIBLE: 'openai-compatible',
  CUSTOM: 'custom-prompt'
};

export const IMAGE_API_TYPES = {
  OPENAI_COMPATIBLE: 'openai-compatible-image',
  CUSTOM: 'custom-image'
};

export const AUTH_TYPES = {
  NONE: 'none',
  BEARER: 'bearer',
  X_API_KEY: 'x-api-key',
  QUERY_KEY: 'query-key',
  CUSTOM_HEADER: 'custom-header'
};

export const REQUEST_MODES = {
  SYNC: 'sync',
  ASYNC: 'async'
};

// Legacy aliases for backward compatibility in adapters
export const PROMPT_PROVIDER_TYPES = PROMPT_API_TYPES;
export const IMAGE_PROVIDER_TYPES = IMAGE_API_TYPES;
