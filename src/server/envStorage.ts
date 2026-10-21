import fs from 'fs';
import path from 'path';

const ENV_FILE_PATH = path.resolve(process.cwd(), '.env');

export interface PersistedConfig {
  apiKey: string;
  voiceId: string;
  hasPersistentFile: boolean;
  source: 'env_file' | 'process_env' | 'none';
}

/**
 * Safely parses the git-ignored .env file into key-value pairs without exposing contents to logs.
 */
export function readEnvFile(): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(ENV_FILE_PATH)) return result;

  try {
    const content = fs.readFileSync(ENV_FILE_PATH, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        result[key] = val;
      }
    }
  } catch (err: any) {
    console.error('Error reading .env file:', err?.message || err);
  }
  return result;
}

/**
 * Persists ElevenLabs configuration to the git-ignored .env file and syncs process.env.
 * Ensures permissions are 0o600 so only the server process can read it.
 */
export function persistEnvConfig(updates: { apiKey?: string; voiceId?: string }): { success: boolean; error?: string } {
  try {
    const existing = readEnvFile();

    // Preserve system keys from environment if not present in existing .env
    if (!existing.VITE_GOOGLE_MAPS_API_KEY && process.env.VITE_GOOGLE_MAPS_API_KEY) {
      existing.VITE_GOOGLE_MAPS_API_KEY = process.env.VITE_GOOGLE_MAPS_API_KEY;
    }
    if (!existing.GEMINI_API_KEY && process.env.GEMINI_API_KEY) {
      existing.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    }
    if (!existing.PORT && process.env.PORT) {
      existing.PORT = process.env.PORT;
    }

    if (typeof updates.apiKey === 'string') {
      const cleanKey = updates.apiKey.trim();
      if (cleanKey === '') {
        delete existing.ELEVENLABS_API_KEY;
        delete process.env.ELEVENLABS_API_KEY;
      } else {
        existing.ELEVENLABS_API_KEY = cleanKey;
        process.env.ELEVENLABS_API_KEY = cleanKey;
      }
    }

    if (typeof updates.voiceId === 'string') {
      const cleanVoiceId = updates.voiceId.trim();
      if (cleanVoiceId) {
        existing.ELEVENLABS_VOICE_ID = cleanVoiceId;
        process.env.ELEVENLABS_VOICE_ID = cleanVoiceId;
      }
    }

    const lines: string[] = [
      '# Raahi Persistent Environment Configuration',
      '# This file is strictly excluded from Git tracking via .gitignore',
      `VITE_GOOGLE_MAPS_API_KEY=${existing.VITE_GOOGLE_MAPS_API_KEY || ''}`,
      `GEMINI_API_KEY=${existing.GEMINI_API_KEY || ''}`,
      `ELEVENLABS_API_KEY=${existing.ELEVENLABS_API_KEY || ''}`,
      `ELEVENLABS_VOICE_ID=${existing.ELEVENLABS_VOICE_ID || 'F8IvasoAdpDhOjLm5YBm'}`,
      `PORT=${existing.PORT || '3000'}`,
    ];

    fs.writeFileSync(ENV_FILE_PATH, lines.join('\n') + '\n', { mode: 0o600 });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to write persistent .env file' };
  }
}

/**
 * Returns active configuration with source provenance without exposing secret keys.
 */
export function getAuthoritativeConfig(): PersistedConfig {
  const envFile = readEnvFile();
  const fileKey = (envFile.ELEVENLABS_API_KEY || '').trim();
  const processKey = (process.env.ELEVENLABS_API_KEY || '').trim();

  // 1. Check persistent file first
  if (fileKey && fileKey.startsWith('sk_')) {
    return {
      apiKey: fileKey,
      voiceId: (envFile.ELEVENLABS_VOICE_ID || process.env.ELEVENLABS_VOICE_ID || 'F8IvasoAdpDhOjLm5YBm').trim(),
      hasPersistentFile: true,
      source: 'env_file',
    };
  }

  // 2. Check process.env (only if valid secret starting with sk_)
  if (processKey && processKey.startsWith('sk_')) {
    return {
      apiKey: processKey,
      voiceId: (process.env.ELEVENLABS_VOICE_ID || envFile.ELEVENLABS_VOICE_ID || 'F8IvasoAdpDhOjLm5YBm').trim(),
      hasPersistentFile: fs.existsSync(ENV_FILE_PATH),
      source: 'process_env',
    };
  }

  // 3. Fallback: No valid key configured
  return {
    apiKey: '',
    voiceId: (envFile.ELEVENLABS_VOICE_ID || process.env.ELEVENLABS_VOICE_ID || 'F8IvasoAdpDhOjLm5YBm').trim(),
    hasPersistentFile: fs.existsSync(ENV_FILE_PATH),
    source: 'none',
  };
}
