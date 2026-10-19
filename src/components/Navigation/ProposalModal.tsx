import React from 'react';
import { useJourney } from '../../context/JourneyContext';
import { Check, X, AlertTriangle, ArrowRight } from 'lucide-react';

export const ProposalModal: React.FC = () => {
  const { pendingProposal, confirmProposal, cancelProposal, journey } = useJourney();

  if (!pendingProposal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4">
        {/* Modal Header */}
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100">Confirm Route Changes</h3>
            <p className="text-xs text-slate-400 mt-0.5">{pendingProposal.explanation}</p>
          </div>
        </div>

        {/* Spoken summary */}
        <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700/80 text-sm text-slate-200 italic">
          "{pendingProposal.summary}"
        </div>

        {/* Comparison Details */}
        <div className="space-y-2 text-xs">
          <div className="text-slate-400 font-semibold uppercase text-[11px]">Proposed Updates:</div>
          <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Destination:</span>
              <span className="font-semibold text-rose-400">
                {pendingProposal.proposedJourney.destination?.name || 'None'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Intermediate Stops:</span>
              <span className="font-semibold text-amber-400">
                {pendingProposal.proposedJourney.stops.length > 0
                  ? pendingProposal.proposedJourney.stops.map((s) => s.name).join(' ➔ ')
                  : 'No stops'}
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={cancelProposal}
            className="flex-1 py-3 px-4 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 font-medium text-xs transition flex items-center justify-center gap-1.5"
          >
            <X className="w-4 h-4" />
            <span>Cancel</span>
          </button>
          <button
            onClick={confirmProposal}
            className="flex-1 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition shadow-lg flex items-center justify-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            <span>Confirm & Apply</span>
          </button>
        </div>
      </div>
    </div>
  );
};
