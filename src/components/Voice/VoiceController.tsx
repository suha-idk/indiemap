import React, { useState, useEffect } from 'react';
import { useJourney } from '../../context/JourneyContext';
import { speechService, SupportedSpeechLang } from '../../services/speechService';
import { Mic, MicOff, Send, Volume2, Undo2, RotateCcw, Sparkles } from 'lucide-react';

export const VoiceController: React.FC = () => {
  const {
    executeCommand,
    isProcessingCommand,
    lastMessage,
    canUndo,
    undo,
  } = useJourney();

  const [micState, setMicState] = useState(speechService.getMicState());
  const [transcript, setTranscript] = useState('');
  const [typedInput, setTypedInput] = useState('');
  const [selectedLang, setSelectedLang] = useState<SupportedSpeechLang>('hi-IN');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsub = speechService.onMicStateChange((state) => {
      setMicState(state);
    });
    return () => unsub();
  }, []);

  const startVoice = () => {
    setErrorMessage(null);
    setTranscript('');

    speechService.setLanguage(selectedLang);
    speechService.startListening({
      onStart: () => {
        setErrorMessage(null);
      },
      onInterimResult: (text) => {
        setTranscript(text);
      },
      onFinalResult: (finalText) => {
        setTranscript(finalText);
        if (finalText.trim()) {
          const respLang = selectedLang.split('-')[0] || 'hi';
          executeCommand(finalText.trim(), respLang);
        }
      },
      onError: (err) => {
        setErrorMessage(err);
      },
      onEnd: () => {
        // Microphone auto-off or manual off completed
      },
    });
  };

  const stopVoice = () => {
    speechService.stopListening();
  };

  const toggleVoice = () => {
    if (micState === 'STARTING' || micState === 'STOPPING') return;
    if (micState === 'LISTENING') {
      stopVoice();
    } else {
      startVoice();
    }
  };

  const handleManualSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cmd = (typedInput || transcript).trim();
    if (!cmd) return;
    const respLang = selectedLang.split('-')[0] || 'hi';
    executeCommand(cmd, respLang);
    setTypedInput('');
    setTranscript('');
  };

  const handlePresetClick = (preset: string) => {
    setTypedInput(preset);
    executeCommand(preset);
  };

  return (
    <div className="bg-slate-900 border-t border-slate-800 p-4 space-y-3">
      {/* Spoken Response or Error Banner */}
      {(lastMessage || errorMessage) && (
        <div className="flex items-center justify-between bg-slate-800/90 border border-slate-700 p-2.5 rounded-xl text-xs text-slate-200">
          <div className="flex items-center gap-2 overflow-hidden">
            <Volume2 className="w-4 h-4 text-blue-400 shrink-0" />
            <span className="truncate">{errorMessage || lastMessage}</span>
          </div>
          {lastMessage && (
            <button
              onClick={() => speechService.speak(lastMessage)}
              className="text-blue-400 hover:text-blue-300 p-1 shrink-0"
              title="Repeat audio"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Live Listening Transcript Bar */}
      {micState === 'LISTENING' && (
        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-blue-950/60 border border-blue-600/60 animate-pulse text-xs text-blue-200">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-ping shrink-0" />
          <span className="font-semibold text-blue-300">Listening ({selectedLang}) [Auto-off 6.5s]:</span>
          <span className="italic truncate">{transcript || 'Say destination, stop, or route change...'}</span>
        </div>
      )}

      {/* Main Command Input & Controls */}
      <form onSubmit={handleManualSubmit} className="flex items-center gap-2">
        {/* Big Large Voice Microphone Button */}
        <button
          type="button"
          onClick={toggleVoice}
          disabled={micState === 'STARTING' || micState === 'STOPPING'}
          className={`relative p-3.5 rounded-2xl shadow-xl transition active:scale-95 flex items-center justify-center shrink-0 ${
            micState === 'LISTENING'
              ? 'bg-rose-600 text-white animate-pulse ring-4 ring-rose-500/30'
              : micState === 'STARTING'
              ? 'bg-amber-600 text-white animate-pulse cursor-wait'
              : 'bg-blue-600 hover:bg-blue-500 text-white'
          }`}
          title={
            micState === 'LISTENING'
              ? 'Tap to stop listening (Auto-off after 6.5s silence)'
              : micState === 'STARTING'
              ? 'Connecting microphone...'
              : 'Tap to speak'
          }
        >
          {micState === 'LISTENING' ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>

        {/* Text Command Input Bar */}
        <div className="relative flex-1">
          <input
            type="text"
            value={typedInput || transcript}
            onChange={(e) => {
              setTypedInput(e.target.value);
              setTranscript('');
            }}
            placeholder="Speak or type command, e.g. 'Take me to Agra'..."
            className="w-full bg-slate-800/90 border border-slate-700/80 rounded-2xl px-4 py-3 text-sm text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isProcessingCommand || (!typedInput && !transcript)}
          className={`p-3.5 rounded-2xl bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 transition active:scale-95 shrink-0 ${
            isProcessingCommand || (!typedInput && !transcript) ? 'opacity-40 cursor-not-allowed' : ''
          }`}
          title="Send command"
        >
          <Send className="w-5 h-5 text-blue-400" />
        </button>

        {/* Undo Button */}
        {canUndo && (
          <button
            type="button"
            onClick={undo}
            className="p-3.5 rounded-2xl bg-slate-800 border border-slate-700 text-amber-400 hover:bg-slate-700 transition active:scale-95 shrink-0"
            title="Undo last change"
          >
            <Undo2 className="w-5 h-5" />
          </button>
        )}
      </form>

      {/* Language Selector & Sample Voice Prompts */}
      <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          <span className="text-[11px] text-slate-500 shrink-0 font-medium">Try:</span>
          <button
            onClick={() => handlePresetClick('From my current location, take me to Agra')}
            className="px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0 transition"
          >
            Agra jaana hai
          </button>
          <button
            onClick={() => handlePresetClick('Destination change karke Mathura kar do')}
            className="px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0 transition"
          >
            Destination Mathura kar do
          </button>
          <button
            onClick={() => handlePresetClick('Route ke sabse close petrol pump pe stop add kar do')}
            className="px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0 transition"
          >
            Min-detour petrol pump
          </button>
          <button
            onClick={() => handlePresetClick('Doosra stop hata do')}
            className="px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0 transition"
          >
            Doosra stop hatao
          </button>
        </div>

        {/* Speech Language Dropdown */}
        <select
          value={selectedLang}
          onChange={(e) => setSelectedLang(e.target.value as SupportedSpeechLang)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-300 focus:outline-none shrink-0 ml-2"
        >
          <option value="hi-IN">हिन्दी (Hindi)</option>
          <option value="en-IN">English (India)</option>
          <option value="mr-IN">मराठी (Marathi)</option>
          <option value="te-IN">తెలుగు (Telugu)</option>
          <option value="ta-IN">தமிழ் (Tamil)</option>
          <option value="bn-IN">বাংলা (Bengali)</option>
        </select>
      </div>
    </div>
  );
};
