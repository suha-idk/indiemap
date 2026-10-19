import React from 'react';
import { useJourney } from '../../context/JourneyContext';
import {
  Navigation,
  Car,
  Bike,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  Play,
  Square,
  Sun,
  Moon,
} from 'lucide-react';

interface RouteSummaryProps {
  onOpenTestModal: () => void;
}

export const RouteSummary: React.FC<RouteSummaryProps> = ({ onOpenTestModal }) => {
  const {
    journey,
    activeRoute,
    routeLoading,
    toggleAvoidTolls,
    setTravelMode,
    theme,
    toggleTheme,
    navigationState,
    startNavigation,
    endNavigation,
  } = useJourney();

  const isNavReady = Boolean(activeRoute && !activeRoute.isStale && journey.origin && journey.destination);

  return (
    <div
      className={`border-b p-3 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-md backdrop-blur transition-colors ${
        theme === 'dark'
          ? 'bg-slate-900/95 border-slate-800 text-slate-100'
          : 'bg-white/95 border-slate-200 text-slate-900'
      }`}
    >
      {/* Brand & App Info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-blue-600 flex items-center justify-center text-white font-black text-sm shadow-md">
            रा
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-base tracking-tight">Raahi</span>
              <span className="text-xs font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.2 rounded border border-amber-500/20">
                राही
              </span>
            </div>
            <p className="text-[10px] text-slate-400">Voice Navigation Copilot for India</p>
          </div>
        </div>

        {/* Mobile Action Controls */}
        <div className="flex items-center gap-1.5 md:hidden">
          {/* Start / End Navigation Button for Mobile */}
          {navigationState.isActive ? (
            <button
              onClick={endNavigation}
              className="flex items-center gap-1 text-xs font-bold bg-rose-600 text-white px-3 py-1.5 rounded-lg active:scale-95 shadow transition"
            >
              <Square className="w-3.5 h-3.5 fill-white" />
              <span>End</span>
            </button>
          ) : (
            <button
              onClick={startNavigation}
              disabled={!isNavReady}
              className={`flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg active:scale-95 shadow transition ${
                isNavReady
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
                  : 'bg-slate-700/50 text-slate-400 cursor-not-allowed'
              }`}
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Start</span>
            </button>
          )}

          {/* Theme Toggle Mobile */}
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"
            title="Toggle Dark/Light Mode"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
          </button>

          {/* QA Suite Mobile */}
          <button
            onClick={onOpenTestModal}
            className="p-1.5 rounded-lg bg-blue-950/70 border border-blue-600/50 text-blue-300"
            title="Run QA Suite"
          >
            <CheckCircle2 className="w-4 h-4 text-blue-400" />
          </button>
        </div>
      </div>

      {/* Active Route Metrics (Real ETA, Distance & Via Road) */}
      {activeRoute ? (
        <div
          className={`flex items-center gap-4 px-3.5 py-1.5 rounded-xl border transition ${
            theme === 'dark' ? 'bg-slate-800/80 border-slate-700' : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-400">ETA / Time</div>
            <div className="text-sm font-extrabold text-emerald-500">{activeRoute.durationFormatted}</div>
          </div>
          <div className="w-px h-6 bg-slate-700/50" />
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-400">Distance</div>
            <div className="text-sm font-extrabold">{activeRoute.distanceKm}</div>
          </div>
          {activeRoute.description && (
            <>
              <div className="w-px h-6 bg-slate-700/50" />
              <div className="hidden sm:block">
                <div className="text-[10px] uppercase font-bold text-slate-400">Via</div>
                <div className="text-xs font-semibold text-slate-300 truncate max-w-[140px]">
                  {activeRoute.description}
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="text-xs text-slate-400 flex items-center gap-1.5 py-1">
          <Navigation className="w-3.5 h-3.5 text-blue-500" />
          <span>Speak destination or origin to compute live route</span>
        </div>
      )}

      {/* Desktop Controls: Start Nav, Mode, Avoid Tolls, Theme, QA Test Runner */}
      <div className="hidden md:flex items-center gap-2">
        {/* START / END TRIP NAVIGATION BUTTON (Desktop) */}
        {navigationState.isActive ? (
          <button
            onClick={endNavigation}
            className="flex items-center gap-1.5 text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white px-3.5 py-2 rounded-xl shadow-lg transition active:scale-95"
            title="End active navigation trip"
          >
            <Square className="w-3.5 h-3.5 fill-white" />
            <span>End Navigation</span>
          </button>
        ) : (
          <button
            onClick={startNavigation}
            disabled={!isNavReady}
            className={`flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-xl shadow-lg transition active:scale-95 ${
              isNavReady
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
                : 'bg-slate-800 text-slate-500 border border-slate-700/60 cursor-not-allowed opacity-60'
            }`}
            title={isNavReady ? 'Start active navigation guidance' : 'Calculate a valid route first to start navigation'}
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Start Navigation</span>
          </button>
        )}

        {/* Car / Two-Wheeler Toggle */}
        <div
          className={`flex items-center p-0.5 rounded-lg border ${
            theme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-300'
          }`}
        >
          <button
            onClick={() => setTravelMode('DRIVE')}
            className={`p-1.5 rounded-md text-xs font-medium transition ${
              journey.travelMode === 'DRIVE'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Car Navigation (Routes via major highways)"
          >
            <Car className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setTravelMode('TWO_WHEELER')}
            className={`p-1.5 rounded-md text-xs font-medium transition ${
              journey.travelMode === 'TWO_WHEELER'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Two-Wheeler Navigation (Routes avoiding restricted expressways)"
          >
            <Bike className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Toll Avoidance Button */}
        <button
          onClick={toggleAvoidTolls}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition ${
            journey.avoidTolls
              ? 'bg-amber-950/60 border-amber-600/70 text-amber-300'
              : theme === 'dark'
              ? 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
              : 'bg-slate-100 border-slate-300 text-slate-600 hover:text-slate-900'
          }`}
          title="Toggle avoid tolls"
        >
          {journey.avoidTolls ? <ShieldAlert className="w-3.5 h-3.5 text-amber-400" /> : <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />}
          <span>Avoid Tolls</span>
        </button>

        {/* Theme Toggle Button (Dark/Bright) */}
        <button
          onClick={toggleTheme}
          className={`p-2 rounded-xl border transition ${
            theme === 'dark'
              ? 'bg-slate-800 border-slate-700 text-amber-400 hover:bg-slate-700'
              : 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'
          }`}
          title={theme === 'dark' ? 'Switch to Bright / Light Mode' : 'Switch to Dark Mode'}
          aria-label="Toggle dark/bright theme"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* Desktop QA Suite Button */}
        <button
          onClick={onOpenTestModal}
          className="flex items-center gap-1.5 text-xs font-semibold bg-blue-900/60 hover:bg-blue-800/80 border border-blue-600/60 text-blue-200 px-3 py-1.5 rounded-lg transition active:scale-95"
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
          <span>40 QA Tests</span>
        </button>
      </div>
    </div>
  );
};
