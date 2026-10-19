import React, { useState } from 'react';
import { Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import { useJourney } from '../../context/JourneyContext';
import { RoutePolyline } from './RoutePolyline';
import {
  Crosshair,
  Fuel,
  Utensils,
  Zap,
  RefreshCw,
  AlertCircle,
  Navigation,
  CornerUpRight,
  Square,
  Compass,
} from 'lucide-react';

export const RaahiMap: React.FC = () => {
  const {
    journey,
    activeRoute,
    routeLoading,
    routeError,
    userLocation,
    locationStatus,
    requestUserLocation,
    detourCandidates,
    selectDetourCandidate,
    findSmartStop,
    navigationState,
    endNavigation,
    theme,
  } = useJourney();

  const map = useMap();
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);

  // Default Center: live location or New Delhi (28.6139, 77.2090)
  const defaultCenter = userLocation || journey.origin?.latLng || { lat: 28.6139, lng: 77.209 };

  // Recenter to user's live position
  const handleRecenter = async () => {
    const loc = await requestUserLocation();
    if (loc && map) {
      map.panTo(loc);
      map.setZoom(16);
    }
  };

  return (
    <div
      className={`relative w-full h-full flex-1 min-h-[350px] overflow-hidden ${
        theme === 'dark' ? 'bg-slate-950' : 'bg-slate-100'
      }`}
    >
      <Map
        style={{ width: '100%', height: '100%' }}
        defaultCenter={defaultCenter}
        defaultZoom={12}
        mapId="DEMO_MAP_ID"
        gestureHandling="greedy"
        disableDefaultUI={false}
        zoomControl={false}
        mapTypeControl={false}
        streetViewControl={false}
        fullscreenControl={false}
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
      >
        {/* Active Route Polyline */}
        {activeRoute?.path && activeRoute.path.length > 0 && (
          <RoutePolyline
            path={activeRoute.path}
            requestId={activeRoute.requestId}
            isStale={activeRoute.isStale}
          />
        )}

        {/* Origin Marker */}
        {journey.origin?.latLng && (
          <AdvancedMarker position={journey.origin.latLng} title={journey.origin.name}>
            <div className="relative flex items-center justify-center">
              <div className="w-8 h-8 rounded-full bg-emerald-600 border-2 border-white shadow-lg flex items-center justify-center text-white font-bold text-xs">
                A
              </div>
              <div className="absolute -bottom-6 bg-slate-900/90 text-white text-[10px] px-1.5 py-0.5 rounded shadow whitespace-nowrap border border-slate-700">
                {journey.origin.name}
              </div>
            </div>
          </AdvancedMarker>
        )}

        {/* User Location Radar Marker / Vehicle in Navigation */}
        {userLocation && (
          <AdvancedMarker position={userLocation} title="My Current Location">
            <div className="relative flex items-center justify-center">
              {navigationState.isActive ? (
                <div className="w-8 h-8 rounded-full bg-blue-600 border-3 border-white shadow-2xl flex items-center justify-center text-white">
                  <Navigation
                    className="w-4 h-4 fill-white"
                    style={{
                      transform: `rotate(${navigationState.heading || 0}deg)`,
                    }}
                  />
                </div>
              ) : (
                <>
                  <span className="animate-ping absolute inline-flex h-8 w-8 rounded-full bg-blue-400 opacity-60"></span>
                  <div className="w-4 h-4 rounded-full bg-blue-600 border-2 border-white shadow-md"></div>
                </>
              )}
            </div>
          </AdvancedMarker>
        )}

        {/* Intermediate Stops Markers */}
        {journey.stops.map((stop, idx) => {
          if (!stop.latLng) return null;
          return (
            <AdvancedMarker key={stop.id || `stop-${idx}`} position={stop.latLng} title={stop.name}>
              <div className="relative flex items-center justify-center">
                <div className="w-7 h-7 rounded-full bg-amber-500 border-2 border-white shadow-lg flex items-center justify-center text-slate-950 font-black text-xs">
                  {idx + 1}
                </div>
                <div className="absolute -bottom-6 bg-slate-900/90 text-amber-300 text-[10px] px-1.5 py-0.5 rounded shadow whitespace-nowrap border border-slate-700">
                  {stop.name}
                </div>
              </div>
            </AdvancedMarker>
          );
        })}

        {/* Destination Marker */}
        {journey.destination?.latLng && (
          <AdvancedMarker position={journey.destination.latLng} title={journey.destination.name}>
            <div className="relative flex items-center justify-center">
              <div className="w-9 h-9 rounded-full bg-rose-600 border-2 border-white shadow-xl flex items-center justify-center text-white font-bold">
                <Navigation className="w-4 h-4 fill-white rotate-45" />
              </div>
              <div className="absolute -bottom-6 bg-slate-900/90 text-rose-300 text-[10px] font-semibold px-2 py-0.5 rounded shadow whitespace-nowrap border border-slate-700">
                {journey.destination.name}
              </div>
            </div>
          </AdvancedMarker>
        )}

        {/* Detour Candidate Markers */}
        {detourCandidates.map((cand, idx) => {
          if (!cand.location) return null;
          return (
            <AdvancedMarker
              key={cand.id || `cand-${idx}`}
              position={{ lat: cand.location.latitude, lng: cand.location.longitude }}
              title={cand.displayName?.text || 'Station candidate'}
              onClick={() => setSelectedCandidateId(cand.id)}
            >
              <div className="relative group cursor-pointer">
                <div className="px-2 py-1 rounded-full bg-amber-500 text-slate-950 font-bold text-xs flex items-center gap-1 shadow-md border border-white hover:scale-110 transition-transform">
                  <Fuel className="w-3.5 h-3.5" />
                  <span>+{cand.detourKm} km</span>
                </div>
              </div>
            </AdvancedMarker>
          );
        })}
      </Map>

      {/* ACTIVE NAVIGATION HUD OVERLAY */}
      {navigationState.isActive && (
        <div className="absolute top-3 left-3 right-3 z-30 flex flex-col gap-2">
          {/* Top Maneuver Instruction Card */}
          <div className="p-3.5 rounded-2xl bg-emerald-900/95 border border-emerald-500/50 shadow-2xl backdrop-blur flex items-center justify-between text-white">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0 shadow">
                <CornerUpRight className="w-6 h-6 stroke-[2.5]" />
              </div>
              <div className="truncate">
                <div className="text-[11px] font-semibold text-emerald-300 uppercase tracking-wide">
                  In {navigationState.distanceToNextTurn}
                </div>
                <div className="text-sm font-bold text-white truncate">
                  {navigationState.nextInstruction}
                </div>
              </div>
            </div>
            <button
              onClick={endNavigation}
              className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 shrink-0 shadow transition active:scale-95"
            >
              <Square className="w-3.5 h-3.5 fill-white" />
              <span>End Trip</span>
            </button>
          </div>

          {/* Quick HUD Metrics */}
          <div className="flex items-center gap-2 self-start bg-slate-900/90 border border-slate-700/80 px-3 py-1 rounded-xl text-xs shadow backdrop-blur">
            <span className="text-slate-400">Remaining:</span>
            <span className="font-extrabold text-emerald-400">{navigationState.remainingDuration}</span>
            <span className="text-slate-500">•</span>
            <span className="font-bold text-slate-200">{navigationState.remainingDistance}</span>
          </div>
        </div>
      )}

      {/* Floating GPS and Corridor Discovery Controls (When not navigating) */}
      {!navigationState.isActive && (
        <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
          <button
            onClick={handleRecenter}
            className={`p-3 rounded-full shadow-xl transition active:scale-95 flex items-center justify-center ${
              theme === 'dark'
                ? 'bg-slate-800/95 border border-slate-700 text-slate-200 hover:bg-slate-700'
                : 'bg-white/95 border border-slate-300 text-slate-800 hover:bg-slate-50'
            }`}
            title="Recenter to my location"
          >
            <Crosshair
              className={`w-5 h-5 ${locationStatus === 'locating' ? 'animate-spin text-blue-500' : ''}`}
            />
          </button>

          {journey.destination && (
            <button
              onClick={() => findSmartStop('gas_station', 'route')}
              className="p-3 rounded-full bg-amber-600 text-white shadow-xl hover:bg-amber-500 transition active:scale-95 flex items-center justify-center"
              title="Find minimal detour petrol pump along route"
            >
              <Fuel className="w-5 h-5" />
            </button>
          )}
        </div>
      )}

      {/* Quick Search Chips directly on top of map (When not navigating) */}
      {!navigationState.isActive && (
        <div className="absolute top-4 left-4 right-16 flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar z-10">
          <button
            onClick={() => findSmartStop('gas_station', 'origin')}
            className={`px-3 py-1.5 rounded-full backdrop-blur text-xs font-semibold flex items-center gap-1.5 shadow-md shrink-0 transition ${
              theme === 'dark'
                ? 'bg-slate-900/90 border border-slate-700 text-amber-300 hover:bg-slate-800'
                : 'bg-white/95 border border-slate-300 text-amber-800 hover:bg-slate-100'
            }`}
          >
            <Fuel className="w-3.5 h-3.5 text-amber-500" />
            <span>Petrol Near Origin</span>
          </button>
          <button
            onClick={() => findSmartStop('gas_station', 'route')}
            className={`px-3 py-1.5 rounded-full backdrop-blur text-xs font-semibold flex items-center gap-1.5 shadow-md shrink-0 transition ${
              theme === 'dark'
                ? 'bg-slate-900/90 border border-slate-700 text-blue-300 hover:bg-slate-800'
                : 'bg-white/95 border border-slate-300 text-blue-800 hover:bg-slate-100'
            }`}
          >
            <Fuel className="w-3.5 h-3.5 text-blue-500" />
            <span>On Route Pump</span>
          </button>
          <button
            onClick={() => findSmartStop('cng_station', 'route')}
            className={`px-3 py-1.5 rounded-full backdrop-blur text-xs font-semibold flex items-center gap-1.5 shadow-md shrink-0 transition ${
              theme === 'dark'
                ? 'bg-slate-900/90 border border-slate-700 text-emerald-300 hover:bg-slate-800'
                : 'bg-white/95 border border-slate-300 text-emerald-800 hover:bg-slate-100'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-emerald-500" />
            <span>CNG Station</span>
          </button>
          <button
            onClick={() => findSmartStop('restaurant', 'route')}
            className={`px-3 py-1.5 rounded-full backdrop-blur text-xs font-semibold flex items-center gap-1.5 shadow-md shrink-0 transition ${
              theme === 'dark'
                ? 'bg-slate-900/90 border border-slate-700 text-orange-300 hover:bg-slate-800'
                : 'bg-white/95 border border-slate-300 text-orange-800 hover:bg-slate-100'
            }`}
          >
            <Utensils className="w-3.5 h-3.5 text-orange-500" />
            <span>Dhaba / Food</span>
          </button>
        </div>
      )}

      {/* Route Calculation Loading Overlay */}
      {routeLoading && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-blue-600/90 text-white text-xs px-3.5 py-1.5 rounded-full shadow-lg backdrop-blur flex items-center gap-2 z-20 animate-pulse">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span>Calculating Google Route...</span>
        </div>
      )}

      {/* Route Error Notification */}
      {routeError && (
        <div className="absolute top-16 left-4 right-4 bg-rose-900/90 border border-rose-700 text-rose-100 text-xs p-2.5 rounded-lg shadow-xl backdrop-blur flex items-center justify-between z-20">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{typeof routeError === 'string' ? routeError : JSON.stringify(routeError)}</span>
          </div>
        </div>
      )}
    </div>
  );
};
