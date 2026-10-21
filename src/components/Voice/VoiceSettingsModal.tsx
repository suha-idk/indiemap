import React, { useState, useEffect } from 'react';
import { speechService } from '../../services/speechService';
import {
  X,
  Key,
  Volume2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Eye,
  EyeOff,
  Play,
  RotateCcw,
  ShieldCheck,
  Radio,
  Sliders,
  HardDrive,
  RefreshCw,
  Lock,
} from 'lucide-react';

interface VoiceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigChanged?: () => void;
}

export const VoiceSettingsModal: React.FC<VoiceSettingsModalProps> = ({
  isOpen,
  onClose,
  onConfigChanged,
}) => {
  // Key state
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isReplacingKey, setIsReplacingKey] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);

  // Voice ID state
  const [voiceIdInput, setVoiceIdInput] = useState(speechService.voiceId || 'F8IvasoAdpDhOjLm5YBm');
  const [isSavingVoiceId, setIsSavingVoiceId] = useState(false);

  // Test & general state
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Live status from speechService
  const [authStatus, setAuthStatus] = useState(speechService.authStatus);
  const [authMessage, setAuthMessage] = useState(speechService.authMessage);
  const [sttAvailable, setSttAvailable] = useState(speechService.sttAvailable);
  const [ttsAvailable, setTtsAvailable] = useState(speechService.ttsAvailable);
  const [voiceAccessible, setVoiceAccessible] = useState(speechService.voiceAccessible);
  const [forceBrowserMode, setForceBrowserMode] = useState(speechService.forceBrowserMode);
  const [currentProvider, setCurrentProvider] = useState(speechService.getProvider());
  const [isPersisted, setIsPersisted] = useState(speechService.isPersisted);

  const refreshStatus = () => {
    setAuthStatus(speechService.authStatus);
    setAuthMessage(speechService.authMessage);
    setSttAvailable(speechService.sttAvailable);
    setTtsAvailable(speechService.ttsAvailable);
    setVoiceAccessible(speechService.voiceAccessible);
    setForceBrowserMode(speechService.forceBrowserMode);
    setCurrentProvider(speechService.getProvider());
    setIsPersisted(speechService.isPersisted);
    setVoiceIdInput(speechService.voiceId || 'F8IvasoAdpDhOjLm5YBm');
  };

  useEffect(() => {
    if (isOpen) {
      speechService.checkServerSpeechConfig(true).then(() => {
        refreshStatus();
      });
      setFeedbackMessage(null);
      setApiKeyInput(''); // Always empty, never prepopulated
      setIsReplacingKey(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Separate Action A: Validate and Save API Key (Persistent)
  const handleSaveApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const keyToSubmit = apiKeyInput.trim();

    if (!keyToSubmit) {
      setFeedbackMessage({
        text: 'Please enter your secret ElevenLabs API key starting with "sk_".',
        type: 'error',
      });
      return;
    }

    if (!keyToSubmit.startsWith('sk_')) {
      setFeedbackMessage({
        text: 'Invalid API key format. Secret keys must start with "sk_". API Key IDs are not accepted.',
        type: 'error',
      });
      return;
    }

    setIsSavingKey(true);
    setFeedbackMessage(null);

    const result = await speechService.saveSettings({ apiKey: keyToSubmit });
    setIsSavingKey(false);

    if (result.success) {
      setApiKeyInput(''); // Securely clear input
      setIsReplacingKey(false);
      refreshStatus();
      setFeedbackMessage({
        text: 'Secret API key verified and permanently saved to .env (survives server restarts).',
        type: 'success',
      });
      onConfigChanged?.();
    } else {
      refreshStatus();
      setFeedbackMessage({
        text: result.message || result.error || 'Authentication failed. Please check your ElevenLabs key.',
        type: 'error',
      });
    }
  };

  // Separate Action B: Save Voice ID (Persistent)
  const handleSaveVoiceId = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetVoiceId = voiceIdInput.trim() || 'F8IvasoAdpDhOjLm5YBm';

    setIsSavingVoiceId(true);
    setFeedbackMessage(null);

    const result = await speechService.saveSettings({ voiceId: targetVoiceId });
    setIsSavingVoiceId(false);

    if (result.success) {
      refreshStatus();
      setFeedbackMessage({
        text: `Voice ID "${targetVoiceId}" saved to persistent configuration.`,
        type: 'success',
      });
      onConfigChanged?.();
    } else {
      refreshStatus();
      setFeedbackMessage({
        text: result.message || result.error || 'Failed to update Voice ID.',
        type: 'error',
      });
    }
  };

  // Test Voice Audio Preview
  const handleTestVoice = async () => {
    setIsTestingVoice(true);
    setFeedbackMessage(null);

    const testResult = await speechService.testVoice(
      voiceIdInput.trim() || speechService.voiceId,
      'नमस्ते, यह राhi का वॉयस टेस्ट है। Raahi navigation voice is working perfectly.'
    );

    setIsTestingVoice(false);
    if (testResult.success) {
      setFeedbackMessage({
        text: 'Voice sample generated and playback started successfully!',
        type: 'success',
      });
    } else {
      setFeedbackMessage({
        text: testResult.error || 'Voice test failed. Ensure credentials and Voice ID are valid.',
        type: 'error',
      });
    }
  };

  // Toggle Browser Fallback Override
  const handleToggleBrowserFallback = () => {
    const nextState = !forceBrowserMode;
    speechService.setForceBrowserMode(nextState);
    setForceBrowserMode(nextState);
    setCurrentProvider(speechService.getProvider());
    setFeedbackMessage({
      text: nextState
        ? 'Switched to native browser speech fallback (ElevenLabs bypassed).'
        : 'Restored automatic speech engine selection.',
      type: 'info',
    });
    onConfigChanged?.();
  };

  // Clear Stored Key from Persistent Storage
  const handleClearCredentials = async () => {
    if (!window.confirm('Are you sure you want to remove your ElevenLabs credentials? Raahi will revert to native browser speech.')) {
      return;
    }
    setIsSavingKey(true);
    const result = await speechService.saveSettings({ apiKey: '' });
    setIsSavingKey(false);
    setApiKeyInput('');
    setIsReplacingKey(false);
    refreshStatus();
    setFeedbackMessage({
      text: 'ElevenLabs credentials removed from .env. Native browser speech is active.',
      type: 'info',
    });
    onConfigChanged?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-400">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                Voice & Speech Configuration
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-medium">
                  ElevenLabs & Native
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">Manage persistent secret key, voice ID, and speech fallbacks</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Feedback & Alert Banner */}
          {feedbackMessage && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                feedbackMessage.type === 'success'
                  ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-200'
                  : feedbackMessage.type === 'error'
                  ? 'bg-rose-950/70 border-rose-500/50 text-rose-200'
                  : 'bg-blue-950/70 border-blue-500/50 text-blue-200'
              }`}
            >
              {feedbackMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />}
              {feedbackMessage.type === 'error' && <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />}
              {feedbackMessage.type === 'info' && <AlertCircle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />}
              <span className="flex-1 leading-relaxed">{feedbackMessage.text}</span>
            </div>
          )}

          {/* Service Status Dashboard (5 Clear Indicators + Storage Persistence) */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300">Active Audio Engine:</span>
              <span
                className={`px-2 py-0.5 rounded text-[11px] font-semibold flex items-center gap-1.5 border ${
                  currentProvider === 'elevenlabs'
                    ? 'bg-purple-950/80 border-purple-500/50 text-purple-300'
                    : 'bg-blue-950/80 border-blue-500/50 text-blue-300'
                }`}
              >
                <Radio className="w-3 h-3" />
                {currentProvider === 'elevenlabs' ? 'ElevenLabs AI Engine' : 'Browser Web Speech'}
              </span>
            </div>

            {/* 5 Distinct Capability Indicators */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 border-t border-slate-800/80 text-[11px]">
              {/* 1. API Authentication */}
              <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800 flex flex-col gap-0.5">
                <span className="text-slate-400 text-[10px]">1. API Auth</span>
                <div className="flex items-center gap-1 font-medium">
                  {authStatus === 'authenticated' ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-300">Authenticated</span>
                    </>
                  ) : authStatus === 'invalid_key' ? (
                    <>
                      <XCircle className="w-3.5 h-3.5 text-rose-400" />
                      <span className="text-rose-300">Invalid Key</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-amber-300">Not Configured</span>
                    </>
                  )}
                </div>
              </div>

              {/* 2. Speech-to-Text (STT) */}
              <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800 flex flex-col gap-0.5">
                <span className="text-slate-400 text-[10px]">2. Scribe STT</span>
                <div className="flex items-center gap-1 font-medium">
                  {sttAvailable ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-300">Available</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3.5 h-3.5 text-slate-500" />
                      <span className="text-slate-400">Offline</span>
                    </>
                  )}
                </div>
              </div>

              {/* 3. Text-to-Speech (TTS) */}
              <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800 flex flex-col gap-0.5">
                <span className="text-slate-400 text-[10px]">3. ElevenLabs TTS</span>
                <div className="flex items-center gap-1 font-medium">
                  {ttsAvailable ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-300">Available</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3.5 h-3.5 text-slate-500" />
                      <span className="text-slate-400">Offline</span>
                    </>
                  )}
                </div>
              </div>

              {/* 4. Voice Accessibility */}
              <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800 flex flex-col gap-0.5">
                <span className="text-slate-400 text-[10px]">4. Voice Accessibility</span>
                <div className="flex items-center gap-1 font-medium">
                  {voiceAccessible ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-300">Accessible</span>
                    </>
                  ) : authStatus === 'authenticated' ? (
                    <>
                      <XCircle className="w-3.5 h-3.5 text-rose-400" />
                      <span className="text-rose-300">Not Found</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-3.5 h-3.5 text-slate-500" />
                      <span className="text-slate-400">Requires Auth</span>
                    </>
                  )}
                </div>
              </div>

              {/* 5. Browser Fallback Readiness */}
              <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800 flex flex-col gap-0.5">
                <span className="text-slate-400 text-[10px]">5. Browser Speech</span>
                <div className="flex items-center gap-1 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-blue-300">{forceBrowserMode ? 'Forced Active' : 'Ready (Fallback)'}</span>
                </div>
              </div>

              {/* Storage Persistence Status */}
              <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800 flex flex-col gap-0.5">
                <span className="text-slate-400 text-[10px]">Persistent Storage</span>
                <div className="flex items-center gap-1 font-medium">
                  {isPersisted ? (
                    <>
                      <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-300">Saved to .env</span>
                    </>
                  ) : (
                    <>
                      <HardDrive className="w-3.5 h-3.5 text-slate-500" />
                      <span className="text-slate-400">Not Saved</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {authMessage && (
              <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-800/80 flex items-start gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                <span className="leading-tight">{authMessage}</span>
              </div>
            )}
          </div>

          {/* Section 1: ElevenLabs Secret API Key */}
          <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Key className="w-4 h-4 text-blue-400" />
                <h3 className="text-xs font-bold text-slate-200">ElevenLabs Secret API Key</h3>
              </div>
              <div className="flex items-center gap-2">
                {authStatus === 'authenticated' && !isReplacingKey ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950 border border-emerald-500/40 text-emerald-300 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Credential Saved
                  </span>
                ) : authStatus === 'invalid_key' ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-950 border border-rose-500/40 text-rose-300 flex items-center gap-1">
                    <XCircle className="w-3 h-3" /> Invalid Key
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 border border-slate-700 text-slate-400 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Awaiting Configuration
                  </span>
                )}
              </div>
            </div>

            {authStatus === 'authenticated' && !isReplacingKey ? (
              <div className="flex items-center justify-between bg-slate-900/80 border border-slate-800 rounded-xl p-3 text-xs">
                <div className="flex items-center gap-2 text-slate-300">
                  <Lock className="w-4 h-4 text-emerald-400" />
                  <span>Valid secret key active and persisted in <code className="text-emerald-300 font-mono">.env</code></span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsReplacingKey(true);
                      setApiKeyInput('');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition"
                  >
                    Replace API Key
                  </button>
                  <button
                    type="button"
                    onClick={handleClearCredentials}
                    className="px-2 py-1 rounded-lg text-rose-400 hover:bg-rose-950/40 text-xs transition"
                    title="Remove credential"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSaveApiKey} className="space-y-2">
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="Enter new ElevenLabs secret key (sk_...)"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 pr-10 font-mono"
                    autoComplete="off"
                    spellCheck="false"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-200 transition"
                    title={showApiKey ? 'Hide key' : 'Show key'}
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-slate-400 leading-tight">
                    Must start with <span className="font-mono text-blue-300">sk_</span>. Persisted directly to <code className="text-slate-300">.env</code> on disk.
                  </p>
                  <div className="flex items-center gap-2">
                    {authStatus === 'authenticated' && isReplacingKey && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsReplacingKey(false);
                          setApiKeyInput('');
                        }}
                        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={isSavingKey || !apiKeyInput.trim()}
                      className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition shadow-md disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {isSavingKey ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          <span>Verifying & Saving...</span>
                        </>
                      ) : (
                        <span>Validate and Save</span>
                      )}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>

          {/* Section 2: ElevenLabs Voice ID */}
          <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Volume2 className="w-4 h-4 text-purple-400" />
                <h3 className="text-xs font-bold text-slate-200">ElevenLabs Voice ID</h3>
              </div>
              {voiceAccessible ? (
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950 border border-emerald-500/40 text-emerald-300 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Voice Verified
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 border border-slate-700 text-slate-400 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Unverified
                </span>
              )}
            </div>

            <form onSubmit={handleSaveVoiceId} className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={voiceIdInput}
                  onChange={(e) => setVoiceIdInput(e.target.value)}
                  placeholder="e.g. F8IvasoAdpDhOjLm5YBm"
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono"
                />
                <button
                  type="submit"
                  disabled={isSavingVoiceId || !voiceIdInput.trim()}
                  className="px-3.5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition shadow-md disabled:opacity-50 shrink-0 flex items-center gap-1.5"
                >
                  {isSavingVoiceId ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
                  <span>Save Voice ID</span>
                </button>
              </div>

              {/* Popular Voice Presets */}
              <div className="flex items-center gap-1.5 overflow-x-auto pt-0.5 no-scrollbar text-[10px]">
                <span className="text-slate-500 shrink-0 font-medium">Presets:</span>
                <button
                  type="button"
                  onClick={() => setVoiceIdInput('F8IvasoAdpDhOjLm5YBm')}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0 border border-slate-700 transition"
                  title="Configured Indian Multilingual Voice"
                >
                  F8IvasoAdpDhOjLm5YBm (Default)
                </button>
                <button
                  type="button"
                  onClick={() => setVoiceIdInput('21m00Tcm4TlvDq8ikWAM')}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0 border border-slate-700 transition"
                  title="Rachel Voice"
                >
                  Rachel (Multilingual)
                </button>
                <button
                  type="button"
                  onClick={() => setVoiceIdInput('pNInz6obpgDQGcFmaJgB')}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0 border border-slate-700 transition"
                  title="Adam Voice"
                >
                  Adam
                </button>
              </div>
            </form>
          </div>

          {/* Section 3: Audio Preview & Fallback Controls */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleTestVoice}
              disabled={isTestingVoice}
              className="flex-1 py-2.5 px-3 rounded-xl bg-purple-950/70 border border-purple-500/40 text-purple-200 hover:bg-purple-900/60 transition text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 active:scale-95 shadow-sm"
            >
              {isTestingVoice ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-purple-300" />}
              <span>{isTestingVoice ? 'Generating & Playing...' : 'Test Voice Audio'}</span>
            </button>

            <button
              type="button"
              onClick={handleToggleBrowserFallback}
              className={`flex-1 py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-95 shadow-sm ${
                forceBrowserMode
                  ? 'bg-amber-950/70 border-amber-500/50 text-amber-200 hover:bg-amber-900/60'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{forceBrowserMode ? 'Restore ElevenLabs' : 'Force Browser Fallback'}</span>
            </button>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-800 bg-slate-950/60">
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <HardDrive className="w-3.5 h-3.5 text-slate-500" />
            Config survives server reboots via <code className="text-slate-300">.env</code>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
