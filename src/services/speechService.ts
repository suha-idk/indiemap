// Web Speech API and Text-to-Speech service for Raahi

// Declare Web Speech API types for TypeScript
interface IWindow extends Window {
  webkitSpeechRecognition?: any;
  SpeechRecognition?: any;
}

export type SupportedSpeechLang = 'hi-IN' | 'en-IN' | 'mr-IN' | 'te-IN' | 'ta-IN' | 'bn-IN' | 'en-US';

export interface SpeechListenerCallbacks {
  onStart?: () => void;
  onInterimResult?: (transcript: string) => void;
  onFinalResult?: (transcript: string) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

class SpeechService {
  private recognition: any = null;
  private isListening: boolean = false;
  private silenceTimer: any = null;
  private currentLanguage: SupportedSpeechLang = 'hi-IN';
  private synthesisVoice: SpeechSynthesisVoice | null = null;
  public isMuted: boolean = false;

  constructor() {
    this.initRecognition();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => {
        this.selectVoice();
      };
      this.selectVoice();
    }
  }

  private initRecognition() {
    if (typeof window === 'undefined') return;

    const win = window as unknown as IWindow;
    const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('SpeechRecognition API is not supported in this browser.');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;
    this.recognition.lang = this.currentLanguage;
  }

  public setLanguage(lang: SupportedSpeechLang) {
    this.currentLanguage = lang;
    if (this.recognition) {
      this.recognition.lang = lang;
    }
    this.selectVoice();
  }

  public getLanguage(): SupportedSpeechLang {
    return this.currentLanguage;
  }

  public isAvailable(): boolean {
    if (typeof window === 'undefined') return false;
    const win = window as unknown as IWindow;
    return Boolean(win.SpeechRecognition || win.webkitSpeechRecognition);
  }

  public startListening(callbacks: SpeechListenerCallbacks) {
    if (!this.recognition) {
      this.initRecognition();
    }

    if (!this.recognition) {
      callbacks.onError?.('Speech recognition is not supported in your browser. You can type commands below.');
      return;
    }

    if (this.isListening) {
      try {
        this.recognition.abort();
      } catch (e) {
        // ignore
      }
    }

    let finalTranscriptAcc = '';

    this.recognition.onstart = () => {
      this.isListening = true;
      callbacks.onStart?.();
    };

    this.recognition.onresult = (event: any) => {
      clearTimeout(this.silenceTimer);
      let interim = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscriptAcc += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      const activeText = (finalTranscriptAcc + ' ' + interim).trim();
      callbacks.onInterimResult?.(activeText);

      // Auto-submit after 1200ms of silence once speech has been detected
      if (activeText.length > 0) {
        this.silenceTimer = setTimeout(() => {
          this.stopListening();
          callbacks.onFinalResult?.(activeText);
        }, 1200);
      }
    };

    this.recognition.onerror = (event: any) => {
      clearTimeout(this.silenceTimer);
      this.isListening = false;
      const errorMsg = event.error === 'no-speech' ? 'No speech detected' : event.error;
      callbacks.onError?.(errorMsg);
    };

    this.recognition.onend = () => {
      clearTimeout(this.silenceTimer);
      this.isListening = false;
      callbacks.onEnd?.();
      if (finalTranscriptAcc.trim().length > 0) {
        callbacks.onFinalResult?.(finalTranscriptAcc.trim());
      }
    };

    try {
      this.recognition.start();
    } catch (e: any) {
      console.warn('Failed to start speech recognition:', e);
      callbacks.onError?.(e.message || 'Microphone error');
    }
  }

  public stopListening() {
    clearTimeout(this.silenceTimer);
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch (e) {
        // ignore
      }
    }
    this.isListening = false;
  }

  private selectVoice() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const voices = window.speechSynthesis.getVoices();
    // Prefer Indian English or Hindi voice
    const indianVoice =
      voices.find((v) => v.lang === 'hi-IN') ||
      voices.find((v) => v.lang === 'en-IN') ||
      voices.find((v) => v.name.toLowerCase().includes('india')) ||
      voices.find((v) => v.lang.startsWith('en'));

    this.synthesisVoice = indianVoice || null;
  }

  public speak(text: string) {
    if (this.isMuted || !text || typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    try {
      window.speechSynthesis.cancel(); // cancel previous utterance
      const utterance = new SpeechSynthesisUtterance(text);
      if (this.synthesisVoice) {
        utterance.voice = this.synthesisVoice;
      }
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('Speech synthesis error:', err);
    }
  }

  public stopSpeaking() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }
}

export const speechService = new SpeechService();
