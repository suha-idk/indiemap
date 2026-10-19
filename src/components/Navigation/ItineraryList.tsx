import React, { useState } from 'react';
import { useJourney } from '../../context/JourneyContext';
import { Waypoint } from '../../types/navigation';
import { searchPlaces } from '../../services/placesService';
import { MapPin, ArrowUp, ArrowDown, Trash2, Plus, Flag, Search, X, Check } from 'lucide-react';

export const ItineraryList: React.FC = () => {
  const {
    journey,
    setOrigin,
    setDestination,
    clearDestination,
    addStop,
    removeStopByName,
    removeStopByOrdinal,
    reorderStops,
    clearAllStops,
  } = useJourney();

  const [isAddingStop, setIsAddingStop] = useState(false);
  const [stopInput, setStopInput] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [editingType, setEditingType] = useState<'origin' | 'destination' | 'stop' | null>(null);

  const handleSearch = async (val: string) => {
    setStopInput(val);
    if (val.trim().length > 2) {
      setIsSearching(true);
      const res = await searchPlaces(val.trim());
      setSearchResults(res);
      setIsSearching(false);
    } else {
      setSearchResults([]);
    }
  };

  const handleSelectPlace = (place: any) => {
    const wp: Waypoint = {
      id: place.id || `wp-${Date.now()}`,
      name: place.name,
      address: place.address,
      latLng: place.latLng,
      category: place.category,
      addedVia: 'manual',
    };

    if (editingType === 'origin') {
      setOrigin(wp);
    } else if (editingType === 'destination') {
      setDestination(wp);
    } else {
      addStop(wp);
    }

    setEditingType(null);
    setIsAddingStop(false);
    setStopInput('');
    setSearchResults([]);
  };

  return (
    <div className="bg-slate-900 border-t border-slate-800 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-200 tracking-wide uppercase flex items-center gap-1.5">
          <span>Itinerary</span>
          <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-mono">
            rev {journey.revision}
          </span>
        </h3>
        {journey.stops.length > 0 && (
          <button
            onClick={clearAllStops}
            className="text-xs text-rose-400 hover:text-rose-300 transition flex items-center gap-1"
          >
            Clear all stops
          </button>
        )}
      </div>

      {/* Itinerary Cards */}
      <div className="space-y-2">
        {/* Origin Item */}
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/80">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-7 h-7 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
              A
            </div>
            <div className="truncate">
              <div className="text-xs text-emerald-400 font-semibold uppercase">Origin</div>
              <div className="text-sm font-medium text-slate-100 truncate">
                {journey.origin?.name || 'Current GPS Location'}
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              setEditingType('origin');
              setIsAddingStop(true);
            }}
            className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 bg-slate-700/50 rounded-lg shrink-0"
          >
            Change
          </button>
        </div>

        {/* Intermediate Stops */}
        {journey.stops.map((stop, idx) => (
          <div
            key={stop.id || `stop-${idx}`}
            className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/50 border border-slate-700/60 ml-3 pl-3 border-l-2 border-l-amber-500"
          >
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-6 h-6 rounded-full bg-amber-500 flex items-center justify-center text-slate-950 font-black text-xs shrink-0">
                {idx + 1}
              </div>
              <div className="truncate">
                <div className="text-xs text-amber-400 font-medium">Stop #{idx + 1}</div>
                <div className="text-sm text-slate-100 font-medium truncate">{stop.name}</div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {/* Move Up */}
              <button
                disabled={idx === 0}
                onClick={() => reorderStops(idx, idx - 1)}
                className={`p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 ${idx === 0 ? 'opacity-30 cursor-not-allowed' : ''}`}
                title="Move earlier"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              {/* Move Down */}
              <button
                disabled={idx === journey.stops.length - 1}
                onClick={() => reorderStops(idx, idx + 1)}
                className={`p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 ${idx === journey.stops.length - 1 ? 'opacity-30 cursor-not-allowed' : ''}`}
                title="Move later"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              {/* Remove Stop */}
              <button
                onClick={() => removeStopByOrdinal(idx + 1)}
                className="p-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-950/40"
                title="Remove this stop"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}

        {/* Destination Item */}
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/80">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-7 h-7 rounded-full bg-rose-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
              <Flag className="w-3.5 h-3.5" />
            </div>
            <div className="truncate">
              <div className="text-xs text-rose-400 font-semibold uppercase">Destination</div>
              <div className="text-sm font-medium text-slate-100 truncate">
                {journey.destination?.name || 'No destination set'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => {
                setEditingType('destination');
                setIsAddingStop(true);
              }}
              className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 bg-slate-700/50 rounded-lg"
            >
              {journey.destination ? 'Change' : 'Set'}
            </button>
            {journey.destination && (
              <button
                onClick={clearDestination}
                className="p-1 text-slate-400 hover:text-rose-400"
                title="Clear destination"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Add Stop Button */}
      {!isAddingStop && (
        <button
          onClick={() => {
            setEditingType('stop');
            setIsAddingStop(true);
          }}
          className="w-full py-2.5 px-3 rounded-xl border border-dashed border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition text-xs font-medium flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>Add Stop Manually</span>
        </button>
      )}

      {/* Search & Add Stop Modal / Inline Panel */}
      {isAddingStop && (
        <div className="p-3 bg-slate-800 rounded-xl border border-slate-700 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300">
              {editingType === 'origin' ? 'Change Origin' : editingType === 'destination' ? 'Set Destination' : 'Add Stop'}
            </span>
            <button
              onClick={() => {
                setIsAddingStop(false);
                setStopInput('');
                setSearchResults([]);
              }}
              className="text-slate-400 hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={stopInput}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search place, e.g. Mathura, IndianOil petrol pump..."
              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
              autoFocus
            />
          </div>

          {searchResults.length > 0 && (
            <div className="max-h-48 overflow-y-auto space-y-1 divide-y divide-slate-700/50">
              {searchResults.map((place) => (
                <button
                  key={place.id}
                  onClick={() => handleSelectPlace(place)}
                  className="w-full text-left py-2 px-1 hover:bg-slate-700/50 rounded flex flex-col transition"
                >
                  <span className="text-xs font-medium text-slate-200 truncate">{place.name}</span>
                  <span className="text-[11px] text-slate-400 truncate">{place.address}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
