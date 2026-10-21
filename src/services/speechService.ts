// Unified Speech Provider Service for Raahi: ElevenLabs & Browser Fallback

interface IWindow extends Window {
  webkitSpeechRecognition?: any;
  SpeechRecognition?: any;
}

export type SupportedSpeechLang = 'hi-IN' | 'en-IN' | 'mr-IN' | 'te-IN' | 'ta-IN' | 'bn-IN' | 'en-US';
export type SpeechProviderType = 'elevenlabs' | 'browser';

export interface SpeechListenerCallbacks {
  onStart?: () => void;
  onInterimResult?: (transcript: string) => void;
  onFinalResult?: (transcript: string) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
  onTranscribing?: () => void;
}

export type MicLifecycleState = 'OFF' | 'STARTING' | 'LISTENING' | 'STOPPING' | 'ERROR';

class SpeechService {
  private recognition: any = null;
  private isListening: boolean = false;
  private micState: MicLifecycleState = 'OFF';
  private silenceTimer: any = null;
  private inactivityTimer: any = null;
  public inactivityTimeoutMs: number = 6500; // 6.5s inactivity timeout
  private sessionId: number = 0;
  private micStateListeners: Set<(state: MicLifecycleState) => void> = new Set();

  private currentLanguage: SupportedSpeechLang = 'hi-IN';
  private synthesisVoice: SpeechSynthesisVoice | null = null;
  public isMuted: boolean = false;
  public forceBrowserMode: boolean = false;

  private provider: SpeechProviderType = 'browser';
  public elevenLabsAvailable: boolean = false;
  public sttAvailable: boolean = false;
  public ttsAvailable: boolean = false;
  public voiceId: string = 'F8IvasoAdpDhOjLm5YBm';
  public voiceAccessible: boolean = false;
  public authStatus: string = 'not_configured';
  public authMessage: string = '';
  public isPersisted: boolean = false;
  public persistedSource: string = 'none';

  private mediaRecorder: MediaRecorder | null = null;
  private audioStream: MediaStream | null = null;
  private audioChunks: Blob[] = [];
  private isCancelled: boolean = false;
  private submissionLock: boolean = false;
  private currentAudioElement: HTMLAudioElement | null = null;
  private currentAudioUrl: string | null = null;

  constructor() {
    this.initBrowserRecognition();
    this.initBrowserVoices();
    this.checkServerSpeechConfig();
  }

  public getMicState(): MicLifecycleState {
    return this.micState;
  }

  public onMicStateChange(listener: (state: MicLifecycleState) => void): () => void {
    this.micStateListeners.add(listener);
    listener(this.micState);
    return () => this.micStateListeners.delete(listener);
  }

  private setMicState(next: MicLifecycleState) {
    if (this.micState === next) return;
    this.micState = next;
    this.isListening = next === 'LISTENING';
    this.micStateListeners.forEach((fn) => {
      try {
        fn(next);
      } catch (err) {
        console.warn('Mic listener error:', err);
      }
    });
  }

  private resetInactivityTimer(callbacks?: SpeechListenerCallbacks) {
    clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => {
      console.info(`[SpeechService] Inactivity timeout (${this.inactivityTimeoutMs}ms reached) -> auto-stopping microphone`);
      this.stopListening();
    }, this.inactivityTimeoutMs);
  }

  // 1. Check Server Capabilities for ElevenLabs
  public async checkServerSpeechConfig(forceRefresh = false): Promise<boolean> {
    try {
      const url = forceRefresh ? '/api/speech/config?refresh=true' : '/api/speech/config';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        this.elevenLabsAvailable = Boolean(data.elevenLabsAvailable);
        this.sttAvailable = Boolean(data.sttAvailable);
        this.ttsAvailable = Boolean(data.ttsAvailable);
        this.voiceId = data.ttsVoiceId || 'F8IvasoAdpDhOjLm5YBm';
        this.voiceAccessible = Boolean(data.ttsVoiceAccessible);
        this.authStatus = data.authStatus || 'not_configured';
        this.authMessage = data.authMessage || '';
        this.isPersisted = Boolean(data.persisted);
        this.persistedSource = data.source || 'none';

        if (!this.forceBrowserMode && this.elevenLabsAvailable && (this.sttAvailable || this.ttsAvailable)) {
          this.provider = 'elevenlabs';
        } else {
          this.provider = 'browser';
        }
        return this.elevenLabsAvailable;
      }
    } catch {
      // Backend config unreachable, default to browser
      this.elevenLabsAvailable = false;
      this.sttAvailable = false;
      this.ttsAvailable = false;
      this.isPersisted = false;
      this.provider = 'browser';
    }
    return false;
  }

  public getProvider(): SpeechProviderType {
    if (this.forceBrowserMode) return 'browser';
    return this.provider;
  }

  public setProvider(p: SpeechProviderType) {
    if (p === 'elevenlabs') {
      this.forceBrowserMode = false;
      if (!this.elevenLabsAvailable || (!this.sttAvailable && !this.ttsAvailable)) {
        console.info('ElevenLabs is not authenticated on the server. Falling back to browser.');
        this.provider = 'browser';
        return;
      }
      this.provider = 'elevenlabs';
      return;
    }
    this.provider = p;
  }

  public setForceBrowserMode(force: boolean) {
    this.forceBrowserMode = force;
    if (force) {
      this.provider = 'browser';
    } else if (this.elevenLabsAvailable && (this.sttAvailable || this.ttsAvailable)) {
      this.provider = 'elevenlabs';
    }
  }

  // Runtime settings update to server (never exposes or caches key in frontend storage)
  public async saveSettings(params: { apiKey?: string; voiceId?: string; resetToEnv?: boolean }): Promise<{
    success: boolean;
    message: string;
    status?: any;
    error?: string;
  }> {
    try {
      const res = await fetch('/api/speech/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.status) {
          this.elevenLabsAvailable = Boolean(data.status.authenticated && (data.status.sttAvailable || data.status.ttsAvailable));
          this.sttAvailable = Boolean(data.status.sttAvailable);
          this.ttsAvailable = Boolean(data.status.ttsAvailable);
          this.voiceId = data.status.voiceId || this.voiceId;
          this.voiceAccessible = Boolean(data.status.voiceAccessible);
          this.authStatus = data.status.status || 'authenticated';
          this.authMessage = data.status.message || '';
          if (!this.forceBrowserMode && this.elevenLabsAvailable) {
            this.provider = 'elevenlabs';
          }
        }
        return { success: true, message: data.message || 'Credentials saved successfully', status: data.status };
      } else {
        return {
          success: false,
          message: data.error || data.message || 'Authentication failed',
          error: data.error,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        message: 'Could not connect to settings server: ' + (err?.message || 'Network error'),
        error: err?.message,
      };
    }
  }

  // Audio preview test of selected voice
  public async testVoice(voiceId?: string, text?: string): Promise<{ success: boolean; error?: string }> {
    try {
      this.stopSpeaking();
      const res = await fetch('/api/speech/test-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceId: voiceId || this.voiceId,
          text: text || 'नमस्ते! यह राही का वॉयस टेस्ट है। Raahi voice test is working.',
        }),
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        this.currentAudioUrl = url;

        const audio = new Audio(url);
        this.currentAudioElement = audio;

        audio.onended = () => {
          this.cleanupAudio();
        };

        await audio.play();
        return { success: true };
      } else {
        const errJson = await res.json().catch(() => ({}));
        return {
          success: false,
          error: errJson.error || 'Voice test failed. Ensure credentials and Voice ID are valid.',
        };
      }
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Failed to play voice test preview',
      };
    }
  }

  public isElevenLabsConfigured(): boolean {
    return !this.forceBrowserMode && this.elevenLabsAvailable && (this.sttAvailable || this.ttsAvailable);
  }

  // 2. Browser Speech Init
  private initBrowserRecognition() {
    if (typeof window === 'undefined') return;
    const win = window as unknown as IWindow;
    const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;
    this.recognition.lang = this.currentLanguage;
  }

  private initBrowserVoices() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => {
        this.selectVoice();
      };
      this.selectVoice();
    }
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
    const hasMedia = Boolean(navigator?.mediaDevices?.getUserMedia);
    const hasWebSpeech = Boolean(win.SpeechRecognition || win.webkitSpeechRecognition);
    return hasMedia || hasWebSpeech;
  }

  // 3. Speech to Text: Start Recording
  public async startListening(callbacks: SpeechListenerCallbacks) {
    if (this.micState === 'STARTING' || this.micState === 'STOPPING') {
      return;
    }

    this.isCancelled = false;
    this.submissionLock = false;
    this.setMicState('STARTING');

    // Default Browser Web Speech Recognition (preserving built-in stack)
    this.fallbackToBrowserSpeech(callbacks);
  }

  private fallbackToBrowserSpeech(callbacks: SpeechListenerCallbacks) {
    if (!this.recognition) {
      this.initBrowserRecognition();
    }

    if (!this.recognition) {
      this.setMicState('ERROR');
      callbacks.onError?.('Speech recognition is not supported in this browser. Please type commands below.');
      this.setMicState('OFF');
      return;
    }

    const currentSession = ++this.sessionId;

    if (this.isListening) {
      try {
        this.recognition.abort();
      } catch {
        // ignore
      }
    }

    let finalTranscriptAcc = '';

    this.recognition.onstart = () => {
      if (this.sessionId !== currentSession) return;
      this.setMicState('LISTENING');
      this.resetInactivityTimer(callbacks);
      callbacks.onStart?.();
    };

    this.recognition.onresult = (event: any) => {
      if (this.sessionId !== currentSession || this.micState !== 'LISTENING') return;
      clearTimeout(this.silenceTimer);
      this.resetInactivityTimer(callbacks);

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

      // Auto-submit after 1200ms of silence once speech detected
      if (activeText.length > 0) {
        this.silenceTimer = setTimeout(() => {
          this.stopListening();
          if (!this.submissionLock && !this.isCancelled && this.sessionId === currentSession) {
            this.submissionLock = true;
            callbacks.onFinalResult?.(activeText);
          }
        }, 1200);
      }
    };

    this.recognition.onerror = (event: any) => {
      if (this.sessionId !== currentSession) return;
      clearTimeout(this.silenceTimer);
      clearTimeout(this.inactivityTimer);
      this.setMicState('ERROR');
      const errorMsg = event.error === 'no-speech' ? 'No speech detected' : event.error;
      callbacks.onError?.(errorMsg);
      setTimeout(() => {
        if (this.micState === 'ERROR') {
          this.setMicState('OFF');
        }
      }, 500);
    };

    this.recognition.onend = () => {
      if (this.sessionId !== currentSession) return;
      clearTimeout(this.silenceTimer);
      clearTimeout(this.inactivityTimer);
      this.setMicState('OFF');
      callbacks.onEnd?.();
      if (!this.submissionLock && !this.isCancelled && finalTranscriptAcc.trim().length > 0) {
        this.submissionLock = true;
        callbacks.onFinalResult?.(finalTranscriptAcc.trim());
      }
    };

    try {
      this.recognition.start();
    } catch (e: any) {
      console.warn('Failed to start browser speech recognition:', e);
      this.setMicState('ERROR');
      callbacks.onError?.(e.message || 'Microphone error');
      this.setMicState('OFF');
    }
  }

  // Stop listening and trigger transcription
  public stopListening() {
    clearTimeout(this.silenceTimer);
    clearTimeout(this.inactivityTimer);

    if (this.micState === 'OFF') return;
    this.setMicState('STOPPING');

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // ignore
      }
    }

    if (this.recognition && (this.isListening || this.micState === 'STOPPING')) {
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
    }

    this.setMicState('OFF');
  }

  // Cancel listening and discard any recorded audio
  public cancelListening() {
    this.isCancelled = true;
    this.isListening = false;
    clearTimeout(this.silenceTimer);

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // ignore
      }
    }
    this.cleanMediaStream();
    this.audioChunks = [];

    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // ignore
      }
    }
  }

  private cleanMediaStream() {
    if (this.audioStream) {
      this.audioStream.getTracks().forEach((t) => t.stop());
      this.audioStream = null;
    }
  }

  // 4. Text to Speech (ElevenLabs with Browser Fallback)
  public async speak(text: string) {
    if (this.isMuted || !text || typeof window === 'undefined') return;

    // Cancel any ongoing audio playback
    this.stopSpeaking();

    // If ElevenLabs is configured and TTS is available, try server-side TTS
    if (this.elevenLabsAvailable && this.ttsAvailable) {
      try {
        const res = await fetch('/api/speech/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });

        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          this.currentAudioUrl = url;

          const audio = new Audio(url);
          this.currentAudioElement = audio;

          audio.onended = () => {
            this.cleanupAudio();
          };

          audio.onerror = () => {
            this.cleanupAudio();
            this.speakWithBrowser(text);
          };

          await audio.play();
          return;
        } else {
          // If ElevenLabs returned 503 or error, update state to browser fallback
          this.ttsAvailable = false;
          if (!this.sttAvailable) {
            this.elevenLabsAvailable = false;
            this.provider = 'browser';
          }
        }
      } catch {
        this.ttsAvailable = false;
        if (!this.sttAvailable) {
          this.elevenLabsAvailable = false;
          this.provider = 'browser';
        }
      }
    }

    // Fallback: Browser Web SpeechSynthesis
    this.speakWithBrowser(text);
  }

  private speakWithBrowser(text: string) {
    if (this.isMuted || typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      if (this.synthesisVoice) {
        utterance.voice = this.synthesisVoice;
      }
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('Browser speech synthesis error:', err);
    }
  }

  public stopSpeaking() {
    this.cleanupAudio();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  private cleanupAudio() {
    if (this.currentAudioElement) {
      this.currentAudioElement.pause();
      this.currentAudioElement = null;
    }
    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
      this.currentAudioUrl = null;
    }
  }

  private selectVoice() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const voices = window.speechSynthesis.getVoices();

    const indianVoice =
      voices.find((v) => v.lang === 'hi-IN') ||
      voices.find((v) => v.lang === 'en-IN') ||
      voices.find((v) => v.name.toLowerCase().includes('india')) ||
      voices.find((v) => v.lang.startsWith('en'));

    this.synthesisVoice = indianVoice || null;
  }
}

export const speechService = new SpeechService();
