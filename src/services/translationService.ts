// Translation & Cross-Language Service for Raahi (राही)
// Supports English, Hindi, Marathi, Telugu, Tamil, Bengali, Gujarati
// Strictly preserves named entities, coordinates, numbers, negation, and route constraints.

export type SupportedLanguage = 'en' | 'hi' | 'mr' | 'te' | 'ta' | 'bn' | 'gu';

export interface TranslationResult {
  translatedText: string;
  sourceLanguage: SupportedLanguage;
  targetLanguage: SupportedLanguage;
  preservedEntities: string[];
  executionSeparated: boolean;
  navigationCommand?: string;
}

export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  hi: 'Hindi (हिन्दी)',
  mr: 'Marathi (मराठी)',
  te: 'Telugu (తెలుగు)',
  ta: 'Tamil (தமிழ்)',
  bn: 'Bengali (বাংলা)',
  gu: 'Gujarati (ગુજરાતી)',
};

/**
 * Translates text between supported language pairs using backend Gemini API.
 * Preserves place names, stops, distances, units, negation, and route instructions.
 */
export async function translateText(
  text: string,
  targetLang: SupportedLanguage,
  sourceLang?: SupportedLanguage
): Promise<TranslationResult> {
  const clean = text.trim();
  if (!clean) {
    return {
      translatedText: '',
      sourceLanguage: sourceLang || 'en',
      targetLanguage: targetLang,
      preservedEntities: [],
      executionSeparated: true,
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: clean,
        targetLang,
        sourceLang,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      return {
        translatedText: data.translatedText || clean,
        sourceLanguage: data.sourceLanguage || sourceLang || 'en',
        targetLanguage: data.targetLanguage || targetLang,
        preservedEntities: data.preservedEntities || [],
        executionSeparated: true,
        navigationCommand: data.navigationCommand,
      };
    }
  } catch {
    // Graceful fallback to raw text preservation
  }

  // Basic fallback if backend is unreachable
  return {
    translatedText: clean,
    sourceLanguage: sourceLang || 'en',
    targetLanguage: targetLang,
    preservedEntities: [],
    executionSeparated: true,
  };
}

/**
 * Separates explicit translation requests from navigation commands.
 * Example 1: 'Translate "Set the destination to Agra" into Hindi' -> translation only!
 * Example 2: 'Set the destination to Agra' -> navigation only!
 * Example 3: 'Translate this to Hindi and then navigate to Agra' -> translation + navigation!
 */
export function parseTranslationIntent(text: string): {
  isTranslationOnly: boolean;
  isTranslateAndExecute: boolean;
  targetLang?: SupportedLanguage;
  textToTranslate?: string;
  commandToExecute?: string;
} {
  const clean = text.trim();
  const lower = clean.toLowerCase();

  const isTranslateRequest =
    lower.startsWith('translate ') ||
    lower.includes(' into hindi') ||
    lower.includes(' into marathi') ||
    lower.includes(' into telugu') ||
    lower.includes(' into tamil') ||
    lower.includes(' into bengali') ||
    lower.includes(' into gujarati') ||
    lower.includes(' into english') ||
    lower.includes('हिंदी में अनुवाद') ||
    lower.includes('ट्रांसलेट करो');

  if (!isTranslateRequest) {
    return { isTranslationOnly: false, isTranslateAndExecute: false };
  }

  // Detect target language
  let targetLang: SupportedLanguage = 'hi';
  if (/into english|in english|अंग्रेजी|to english/i.test(lower)) targetLang = 'en';
  else if (/into hindi|in hindi|हिंदी|हिन्दी|to hindi/i.test(lower)) targetLang = 'hi';
  else if (/into marathi|in marathi|मराठी|to marathi/i.test(lower)) targetLang = 'mr';
  else if (/into telugu|in telugu|తెలుగు|to telugu/i.test(lower)) targetLang = 'te';
  else if (/into tamil|in tamil|தமிழ்|to tamil/i.test(lower)) targetLang = 'ta';
  else if (/into bengali|in bengali|বাংলা|to bengali/i.test(lower)) targetLang = 'bn';
  else if (/into gujarati|in gujarati|ગુજરાતી|to gujarati/i.test(lower)) targetLang = 'gu';

  // Check if both translation and navigation were requested
  const hasAndNavigate =
    lower.includes('and then navigate to') ||
    lower.includes('and navigate to') ||
    lower.includes('and go to') ||
    lower.includes('aur fir navigate karo') ||
    lower.includes('aur fir chalo');

  if (hasAndNavigate) {
    const parts = clean.split(/(?:and then navigate to|and navigate to|aur fir navigate karo)/i);
    return {
      isTranslationOnly: false,
      isTranslateAndExecute: true,
      targetLang,
      textToTranslate: parts[0]?.replace(/^translate\s+/i, '').trim(),
      commandToExecute: parts[1]?.trim() ? `Navigate to ${parts[1].trim()}` : undefined,
    };
  }

  // Pure translation request
  // Extract text inside quotes if present
  const quoted = clean.match(/["']([^"']+)["']/);
  const textToTranslate = quoted
    ? quoted[1]
    : clean
        .replace(/^translate\s+/i, '')
        .replace(/(?:into|in|to)\s+(?:hindi|english|marathi|telugu|tamil|bengali|gujarati)/gi, '')
        .replace(/हिंदी में अनुवाद करो|ट्रांसलेट करो/gi, '')
        .trim();

  return {
    isTranslationOnly: true,
    isTranslateAndExecute: false,
    targetLang,
    textToTranslate,
  };
}
