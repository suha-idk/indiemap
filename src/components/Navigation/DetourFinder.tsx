import React from 'react';
import { useJourney } from '../../context/JourneyContext';
import { Fuel, Plus, X, Star, Clock } from 'lucide-react';

export const DetourFinder: React.FC = () => {
  const { detourCandidates, detourLoading, selectDetourCandidate, dismissDetourCandidates } = useJourney();

  if (detourCandidates.length === 0 && !detourLoading) return null;

  return (
    <div className="bg-slate-900 border-t border-slate-800 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
            <Fuel className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-100">Recommended Stations Along Route</h4>
            <p className="text-[11px] text-slate-400">Ranked by lowest detour distance & time</p>
          </div>
        </div>
        <button
          onClick={dismissDetourCandidates}
          className="text-slate-400 hover:text-slate-200 p-1"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {detourLoading && (
        <div className="py-6 flex items-center justify-center gap-2 text-xs text-amber-400 animate-pulse">
          <Fuel className="w-4 h-4 animate-bounce" />
          <span>Calculating route impact for nearby stations...</span>
        </div>
      )}

      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
        {detourCandidates.map((cand, idx) => (
          <div
            key={cand.id || `cand-${idx}`}
            className="flex items-center justify-between p-3 rounded-xl bg-slate-800/80 border border-slate-700 hover:border-amber-500/50 transition group"
          >
            <div className="space-y-1 overflow-hidden pr-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-xs text-slate-100 truncate">
                  {cand.displayName?.text || cand.name || 'Petrol Station'}
                </span>
                {cand.rating && (
                  <span className="flex items-center text-[10px] text-amber-400 font-bold bg-amber-950/60 px-1.5 py-0.2 rounded border border-amber-800/50 shrink-0">
                    <Star className="w-2.5 h-2.5 fill-amber-400 mr-0.5" />
                    {cand.rating}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 truncate">{cand.formattedAddress}</div>
              <div className="flex items-center gap-2 text-[10px] text-slate-400">
                <span className="text-emerald-400 font-semibold">+{cand.detourKm} km</span>
                <span>•</span>
                <span className="text-emerald-400 font-semibold">+{cand.detourMinutes} min detour</span>
                {cand.currentOpeningHours?.openNow !== undefined && (
                  <>
                    <span>•</span>
                    <span className={cand.currentOpeningHours.openNow ? 'text-emerald-400' : 'text-rose-400'}>
                      {cand.currentOpeningHours.openNow ? 'Open Now' : 'Closed'}
                    </span>
                  </>
                )}
              </div>
            </div>

            <button
              onClick={() => selectDetourCandidate(cand)}
              className="py-1.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shrink-0 transition flex items-center gap-1 shadow-md active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Stop</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
