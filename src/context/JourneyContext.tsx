import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  ActiveRoute,
  DetourCandidate,
  JourneyHistoryItem,
  JourneyState,
  LatLng,
  NavigationTripState,
  PendingProposal,
  ThemeMode,
  TimingMetrics,
  Waypoint,
  AtomicAction,
} from '../types/navigation';
import { computeRoute } from '../services/routesService';
import { resolvePlaceToWaypoint, searchPlaces, searchNearbyPlaces } from '../services/placesService';
import { interpretCommand } from '../services/aiService';
import { findLowestDetourStop } from '../services/detourService';
import { resolveSearchAnchor } from '../services/anchorService';
import { speechService } from '../services/speechService';

interface JourneyContextType {
  journey: JourneyState;
  activeRoute: ActiveRoute | null;
  routeLoading: boolean;
  routeError: string | null;
  userLocation: LatLng | null;
  locationStatus: 'prompt' | 'granted' | 'denied' | 'locating';
  pendingProposal: PendingProposal | null;
  detourCandidates: DetourCandidate[];
  detourLoading: boolean;
  canUndo: boolean;
  lastMessage: string | null;
  isProcessingCommand: boolean;
  theme: ThemeMode;
  toggleTheme: () => void;
  navigationState: NavigationTripState;
  startNavigation: () => void;
  endNavigation: () => void;
  timings: TimingMetrics;
  lastFramedRouteId: string | null;
  setLastFramedRouteId: (id: string | null) => void;
  requestUserLocation: () => Promise<LatLng | null>;
  setOrigin: (origin: Waypoint) => void;
  setDestination: (destination: Waypoint) => void;
  clearDestination: () => void;
  clearJourney: () => void;
  addStop: (stop: Waypoint, index?: number) => void;
  removeStopByName: (name: string) => boolean;
  removeStopByOrdinal: (ordinal: number) => boolean;
  reorderStops: (fromIndex: number, toIndex: number) => void;
  insertStopRelative: (stop: Waypoint, relativeTo: string | number, position: 'before' | 'after') => boolean;
  clearAllStops: () => void;
  toggleAvoidTolls: () => void;
  setTravelMode: (mode: 'DRIVE' | 'TWO_WHEELER') => void;
  executeCommand: (commandText: string) => Promise<{ success: boolean; message: string }>;
  confirmProposal: () => void;
  cancelProposal: () => void;
  undo: () => void;
  dismissDetourCandidates: () => void;
  selectDetourCandidate: (candidate: DetourCandidate) => void;
  findSmartStop: (category?: any, anchor?: any) => Promise<void>;
}

const defaultJourney: JourneyState = {
  revision: 1,
  origin: null,
  destination: null,
  stops: [],
  travelMode: 'DRIVE',
  avoidTolls: false,
  avoidHighways: false,
};

const initialNavState: NavigationTripState = {
  isActive: false,
  currentLocation: null,
  heading: null,
  speed: null,
  currentStepIndex: 0,
  nextInstruction: 'Follow route path',
  distanceToNextTurn: '--',
  remainingDistance: '--',
  remainingDuration: '--',
  isOffRoute: false,
};

const JourneyContext = createContext<JourneyContextType | undefined>(undefined);

export const JourneyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [journey, setJourney] = useState<JourneyState>(defaultJourney);
  const [activeRoute, setActiveRoute] = useState<ActiveRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [locationStatus, setLocationStatus] = useState<'prompt' | 'granted' | 'denied' | 'locating'>('prompt');
  const [pendingProposal, setPendingProposal] = useState<PendingProposal | null>(null);
  const [detourCandidates, setDetourCandidates] = useState<DetourCandidate[]>([]);
  const [detourLoading, setDetourLoading] = useState<boolean>(false);
  const [history, setHistory] = useState<JourneyHistoryItem[]>([]);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [isProcessingCommand, setIsProcessingCommand] = useState<boolean>(false);
  const [lastFramedRouteId, setLastFramedRouteId] = useState<string | null>(null);
  const [timings, setTimings] = useState<TimingMetrics>({});
  const [navigationState, setNavigationState] = useState<NavigationTripState>(initialNavState);

  // Theme Management
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('raahi_theme');
      if (saved === 'light' || saved === 'dark') return saved;
    }
    return 'dark';
  });

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      if (typeof window !== 'undefined') {
        localStorage.setItem('raahi_theme', next);
      }
      return next;
    });
  }, []);

  // Sync dark class on root document
  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  }, [theme]);

  // Request ID and Concurrency Guard
  const latestRequestIdRef = useRef<string>('');
  const journeyRef = useRef<JourneyState>(journey);
  journeyRef.current = journey;
  const navWatchIdRef = useRef<number | null>(null);

  const pushHistory = (current: JourneyState, route: ActiveRoute | null, description: string) => {
    setHistory((prev) => [...prev.slice(-9), { journey: JSON.parse(JSON.stringify(current)), route, description }]);
  };

  // Recalculates route whenever origin, destination, stops, travelMode, or avoidTolls changes
  const triggerRouting = useCallback(async (stateToRoute: JourneyState) => {
    if (!stateToRoute.origin || !stateToRoute.destination) {
      setActiveRoute(null);
      setRouteLoading(false);
      setRouteError(null);
      return;
    }

    const tStart = performance.now();
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    latestRequestIdRef.current = requestId;
    const currentRevision = stateToRoute.revision;

    setRouteLoading(true);
    setRouteError(null);

    const { route, error } = await computeRoute(stateToRoute, requestId);

    // Stale Response Check: discard if user updated state while request was running
    if (latestRequestIdRef.current !== requestId || journeyRef.current.revision !== currentRevision) {
      console.log(`[Raahi Guard] Discarding stale route response for revision ${currentRevision}`);
      return;
    }

    const tEnd = performance.now();
    setTimings((prev) => ({ ...prev, routeCalculationMs: Math.round(tEnd - tStart) }));
    setRouteLoading(false);

    if (error) {
      const safeError = typeof error === 'string' ? error : JSON.stringify(error);
      setRouteError(safeError);
      setActiveRoute((prev) => (prev ? { ...prev, isStale: true } : null));
    } else if (route) {
      setActiveRoute(route);
      setLastFramedRouteId(route.requestId); // Auto-fit map on initial or updated route
    }
  }, []);

  // Request Device Location
  const requestUserLocation = useCallback(async (): Promise<LatLng | null> => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setLocationStatus('denied');
      return null;
    }

    setLocationStatus('locating');

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          };
          setUserLocation(coords);
          setLocationStatus('granted');

          setJourney((prev) => {
            if (!prev.origin) {
              const next: JourneyState = {
                ...prev,
                revision: prev.revision + 1,
                origin: {
                  id: 'curr-loc',
                  name: 'Current Location',
                  address: 'My Current GPS Location',
                  latLng: coords,
                  isCurrentLocation: true,
                },
              };
              triggerRouting(next);
              return next;
            }
            return prev;
          });

          resolve(coords);
        },
        (err) => {
          console.warn('Geolocation status:', err?.message || 'Permission not granted, using manual origin fallback');
          setLocationStatus('denied');
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
      );
    });
  }, [triggerRouting]);

  // Initial location request on mount
  useEffect(() => {
    requestUserLocation();
  }, [requestUserLocation]);

  // Start Navigation Mode
  const startNavigation = useCallback(() => {
    if (!activeRoute || !journey.destination) {
      const msg = 'Please calculate a valid route before starting navigation.';
      setLastMessage(msg);
      speechService.speak(msg);
      return;
    }

    const firstInstruction =
      activeRoute.legs?.[0]?.steps?.[0]?.instructions ||
      `Head towards ${journey.destination.name}`;

    setNavigationState({
      isActive: true,
      startedAt: new Date().toISOString(),
      currentLocation: userLocation || journey.origin?.latLng || null,
      heading: null,
      speed: null,
      currentStepIndex: 0,
      nextInstruction: firstInstruction,
      distanceToNextTurn: activeRoute.legs?.[0]?.steps?.[0]?.distanceMeters ? `${activeRoute.legs[0].steps[0].distanceMeters} m` : '500 m',
      remainingDistance: activeRoute.distanceKm,
      remainingDuration: activeRoute.durationFormatted,
      isOffRoute: false,
    });

    const startSpeech = `Starting navigation to ${journey.destination.name}. Distance: ${activeRoute.distanceKm}, ETA: ${activeRoute.durationFormatted}.`;
    setLastMessage(startSpeech);
    speechService.speak(startSpeech);

    // Start live position tracking if available
    if (typeof window !== 'undefined' && navigator.geolocation) {
      try {
        if (navWatchIdRef.current !== null) {
          navigator.geolocation.clearWatch(navWatchIdRef.current);
        }
        navWatchIdRef.current = navigator.geolocation.watchPosition(
          (pos) => {
            setNavigationState((prev) => ({
              ...prev,
              currentLocation: { lat: pos.coords.latitude, lng: pos.coords.longitude },
              heading: pos.coords.heading,
              speed: pos.coords.speed,
            }));
          },
          (err) => console.warn('Nav watch warning:', err.message),
          { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
        );
      } catch (e) {
        console.warn('Geolocation watchPosition not available:', e);
      }
    }
  }, [activeRoute, journey.destination, journey.origin?.latLng, userLocation]);

  // End Navigation Mode
  const endNavigation = useCallback(() => {
    if (navWatchIdRef.current !== null && typeof window !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(navWatchIdRef.current);
      navWatchIdRef.current = null;
    }
    setNavigationState(initialNavState);
    const endMsg = 'Navigation ended.';
    setLastMessage(endMsg);
    speechService.speak(endMsg);
  }, []);

  // Cleanup nav watch on unmount
  useEffect(() => {
    return () => {
      if (navWatchIdRef.current !== null && typeof window !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(navWatchIdRef.current);
      }
    };
  }, []);

  // Set Origin
  const setOrigin = useCallback(
    (origin: Waypoint) => {
      pushHistory(journeyRef.current, activeRoute, `Changed origin to ${origin.name}`);
      const next: JourneyState = {
        ...journeyRef.current,
        revision: journeyRef.current.revision + 1,
        origin,
      };
      setJourney(next);
      triggerRouting(next);
    },
    [activeRoute, triggerRouting]
  );

  // Set / Change Destination
  const setDestination = useCallback(
    (dest: Waypoint) => {
      pushHistory(journeyRef.current, activeRoute, `Set destination to ${dest.name}`);
      const next: JourneyState = {
        ...journeyRef.current,
        revision: journeyRef.current.revision + 1,
        destination: dest,
      };
      setJourney(next);
      triggerRouting(next);
    },
    [activeRoute, triggerRouting]
  );

  // Clear Destination
  const clearDestination = useCallback(() => {
    pushHistory(journeyRef.current, activeRoute, 'Removed destination');
    const next: JourneyState = {
      ...journeyRef.current,
      revision: journeyRef.current.revision + 1,
      destination: null,
    };
    setJourney(next);
    setActiveRoute(null);
    setRouteError(null);
    endNavigation();
  }, [activeRoute, endNavigation]);

  // Clear Entire Journey
  const clearJourney = useCallback(() => {
    pushHistory(journeyRef.current, activeRoute, 'Cleared entire journey');
    const next: JourneyState = {
      revision: journeyRef.current.revision + 1,
      origin: userLocation
        ? {
            id: 'curr-loc',
            name: 'Current Location',
            address: 'My Current GPS Location',
            latLng: userLocation,
            isCurrentLocation: true,
          }
        : null,
      destination: null,
      stops: [],
      travelMode: journeyRef.current.travelMode,
      avoidTolls: journeyRef.current.avoidTolls,
      avoidHighways: journeyRef.current.avoidHighways,
    };
    setJourney(next);
    setActiveRoute(null);
    setRouteError(null);
    endNavigation();
  }, [activeRoute, endNavigation, userLocation]);

  // Add Stop
  const addStop = useCallback(
    (stop: Waypoint, index?: number) => {
      pushHistory(journeyRef.current, activeRoute, `Added stop: ${stop.name}`);
      const updatedStops = [...journeyRef.current.stops];
      if (typeof index === 'number' && index >= 0 && index <= updatedStops.length) {
        updatedStops.splice(index, 0, stop);
      } else {
        updatedStops.push(stop);
      }

      const next: JourneyState = {
        ...journeyRef.current,
        revision: journeyRef.current.revision + 1,
        stops: updatedStops,
      };
      setJourney(next);
      triggerRouting(next);
    },
    [activeRoute, triggerRouting]
  );

  // Remove Stop By Name
  const removeStopByName = useCallback(
    (name: string): boolean => {
      const lower = name.toLowerCase().trim();
      const current = journeyRef.current;
      const index = current.stops.findIndex(
        (s) => s.name.toLowerCase().includes(lower) || (s.address && s.address.toLowerCase().includes(lower))
      );

      if (index === -1) {
        return false;
      }

      pushHistory(current, activeRoute, `Removed stop: ${current.stops[index].name}`);
      const updatedStops = current.stops.filter((_, i) => i !== index);
      const next: JourneyState = {
        ...current,
        revision: current.revision + 1,
        stops: updatedStops,
      };
      setJourney(next);
      triggerRouting(next);
      return true;
    },
    [activeRoute, triggerRouting]
  );

  // Remove Stop By Ordinal
  const removeStopByOrdinal = useCallback(
    (ordinal: number): boolean => {
      const current = journeyRef.current;
      const zeroIdx = ordinal - 1;

      if (zeroIdx < 0 || zeroIdx >= current.stops.length) {
        return false;
      }

      const removed = current.stops[zeroIdx];
      pushHistory(current, activeRoute, `Removed stop #${ordinal}: ${removed.name}`);
      const updatedStops = current.stops.filter((_, i) => i !== zeroIdx);
      const next: JourneyState = {
        ...current,
        revision: current.revision + 1,
        stops: updatedStops,
      };
      setJourney(next);
      triggerRouting(next);
      return true;
    },
    [activeRoute, triggerRouting]
  );

  // Reorder Stops
  const reorderStops = useCallback(
    (fromIndex: number, toIndex: number) => {
      const current = journeyRef.current;
      if (
        fromIndex < 0 ||
        fromIndex >= current.stops.length ||
        toIndex < 0 ||
        toIndex >= current.stops.length ||
        fromIndex === toIndex
      ) {
        return;
      }

      pushHistory(current, activeRoute, `Reordered stops`);
      const updatedStops = [...current.stops];
      const [moved] = updatedStops.splice(fromIndex, 1);
      updatedStops.splice(toIndex, 0, moved);

      const next: JourneyState = {
        ...current,
        revision: current.revision + 1,
        stops: updatedStops,
      };
      setJourney(next);
      triggerRouting(next);
    },
    [activeRoute, triggerRouting]
  );

  // Insert Stop Relative to another stop
  const insertStopRelative = useCallback(
    (stop: Waypoint, relativeTo: string | number, position: 'before' | 'after'): boolean => {
      const current = journeyRef.current;
      let targetIndex = -1;

      if (typeof relativeTo === 'number') {
        targetIndex = relativeTo - 1;
      } else {
        const lower = relativeTo.toLowerCase();
        targetIndex = current.stops.findIndex(
          (s) => s.name.toLowerCase().includes(lower) || (s.address && s.address.toLowerCase().includes(lower))
        );
      }

      if (targetIndex < 0 || targetIndex >= current.stops.length) {
        addStop(stop);
        return false;
      }

      const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
      addStop(stop, insertIndex);
      return true;
    },
    [addStop]
  );

  // Clear all intermediate stops
  const clearAllStops = useCallback(() => {
    const current = journeyRef.current;
    if (current.stops.length === 0) return;

    pushHistory(current, activeRoute, 'Cleared all intermediate stops');
    const next: JourneyState = {
      ...current,
      revision: current.revision + 1,
      stops: [],
    };
    setJourney(next);
    triggerRouting(next);
  }, [activeRoute, triggerRouting]);

  // Toggle Avoid Tolls
  const toggleAvoidTolls = useCallback(() => {
    const next: JourneyState = {
      ...journeyRef.current,
      revision: journeyRef.current.revision + 1,
      avoidTolls: !journeyRef.current.avoidTolls,
    };
    setJourney(next);
    triggerRouting(next);
  }, [triggerRouting]);

  // Set Travel Mode
  const setTravelMode = useCallback(
    (mode: 'DRIVE' | 'TWO_WHEELER') => {
      const next: JourneyState = {
        ...journeyRef.current,
        revision: journeyRef.current.revision + 1,
        travelMode: mode,
      };
      setJourney(next);
      triggerRouting(next);
    },
    [triggerRouting]
  );

  // Undo Last Committed Action
  const undo = useCallback(() => {
    if (history.length === 0) return;
    const lastItem = history[history.length - 1];
    setHistory((prev) => prev.slice(0, -1));

    const restoredJourney: JourneyState = {
      ...lastItem.journey,
      revision: journeyRef.current.revision + 1,
    };

    setJourney(restoredJourney);
    triggerRouting(restoredJourney);

    const undoMsg = `Undone: ${lastItem.description}`;
    setLastMessage(undoMsg);
    speechService.speak(undoMsg);
  }, [history, triggerRouting]);

  // Find smart low-detour pump and display candidates or auto-add
  const findSmartStop = useCallback(
    async (category: any = 'gas_station', anchor?: any) => {
      setDetourLoading(true);
      const { best, ranked, error } = await findLowestDetourStop(
        journeyRef.current,
        category,
        anchor || 'route',
        undefined,
        userLocation,
        activeRoute?.path
      );
      setDetourLoading(false);

      if (error || ranked.length === 0) {
        const msg = error || 'Could not find stations along this route';
        setLastMessage(msg);
        speechService.speak(msg);
        return;
      }

      setDetourCandidates(ranked);

      if (best) {
        const msg = `Found ${best.displayName?.text || 'station'} with only +${best.detourKm} km detour (+${best.detourMinutes} min).`;
        setLastMessage(msg);
        speechService.speak(msg);
      }
    },
    [activeRoute?.path, userLocation]
  );

  const selectDetourCandidate = useCallback(
    (candidate: DetourCandidate) => {
      const stopWp: Waypoint = {
        id: candidate.id || `stop-${Date.now()}`,
        placeId: candidate.id,
        name: candidate.displayName?.text || candidate.name || 'Petrol Station',
        address: candidate.formattedAddress || 'Along Route',
        latLng: candidate.location ? { lat: candidate.location.latitude, lng: candidate.location.longitude } : undefined,
        category: 'gas_station',
        addedVia: 'detour_optimizer',
      };
      const insertAt = typeof candidate.bestInsertIndex === 'number' ? candidate.bestInsertIndex : undefined;
      addStop(stopWp, insertAt);
      setDetourCandidates([]);
      const msg = `Added ${stopWp.name} (+${candidate.detourKm} km detour)`;
      setLastMessage(msg);
      speechService.speak(msg);
    },
    [addStop]
  );

  const dismissDetourCandidates = useCallback(() => {
    setDetourCandidates([]);
  }, []);

  // Main Validated Execution Pipeline: Single Unified Transaction for Combined Edits
  const executeCommand = useCallback(
    async (commandText: string): Promise<{ success: boolean; message: string }> => {
      const tStart = performance.now();
      setIsProcessingCommand(true);
      const current = journeyRef.current;

      try {
        const interpretation = await interpretCommand(commandText, current);
        const tIntent = performance.now();
        const intentMs = Math.round(tIntent - tStart);

        if (!interpretation.actions || interpretation.actions.length === 0) {
          const fallbackMsg = interpretation.spokenResponse || 'Could not understand command. Please try again.';
          setLastMessage(fallbackMsg);
          speechService.speak(fallbackMsg);
          setIsProcessingCommand(false);
          return { success: false, message: fallbackMsg };
        }

        // If command requires explicit confirmation (ONLY for high-impact complete journey clears)
        if (interpretation.requiresConfirmation && interpretation.actions.some((a) => a.type === 'CLEAR_JOURNEY')) {
          const proposal: PendingProposal = {
            id: `prop-${Date.now()}`,
            targetRevision: current.revision,
            summary: interpretation.spokenResponse || 'Confirm clearing entire journey?',
            spokenResponse: interpretation.spokenResponse,
            actions: interpretation.actions,
            proposedJourney: defaultJourney,
            explanation: 'Resetting journey to start',
          };

          setPendingProposal(proposal);
          speechService.speak('Please confirm resetting your journey.');
          setIsProcessingCommand(false);
          return { success: true, message: 'Confirmation required' };
        }

        pushHistory(current, activeRoute, commandText);

        // TRANSACTION EXECUTION:
        // Execute compatible operations in a single logical transaction:
        // 1. Process REMOVALS first using snapshot identifiers
        // 2. Resolve place entities in parallel
        // 3. Process ADDITIONS with correct search anchor
        // 4. Process DESTINATION / ORIGIN changes
        // 5. Update state ONCE and recalculate route ONCE!

        let updatedStops = [...current.stops];
        let updatedDestination = current.destination;
        let updatedOrigin = current.origin;
        let updatedTravelMode = current.travelMode;
        let updatedAvoidTolls = current.avoidTolls;
        const appliedDescriptions: string[] = [];

        // Step 1: Execute all REMOVAL operations safely
        // Process ordinals in descending order so earlier stop indices do not shift
        const removalActions = interpretation.actions.filter((a) => a.type === 'REMOVE_STOP');
        const ordinalRemovals = removalActions
          .filter((r) => r.targetStopIdentifier?.byOrdinal)
          .sort((a, b) => b.targetStopIdentifier!.byOrdinal! - a.targetStopIdentifier!.byOrdinal!);

        for (const rem of ordinalRemovals) {
          const ordIdx = rem.targetStopIdentifier!.byOrdinal! - 1;
          if (ordIdx >= 0 && ordIdx < updatedStops.length) {
            const removedName = updatedStops[ordIdx].name;
            updatedStops = updatedStops.filter((_, i) => i !== ordIdx);
            appliedDescriptions.push(`removed stop #${ordIdx + 1} (${removedName})`);
          }
        }

        // Process named or category removals
        const namedRemovals = removalActions.filter((r) => !r.targetStopIdentifier?.byOrdinal);
        for (const rem of namedRemovals) {
          const targetName = rem.targetStopIdentifier?.byName?.toLowerCase().trim();
          const targetCategory = rem.category;

          const matchIdx = updatedStops.findIndex((s) => {
            if (targetCategory && s.category === targetCategory) return true;
            if (targetName) {
              const sName = s.name.toLowerCase();
              const sAddr = (s.address || '').toLowerCase();
              if (sName.includes(targetName) || sAddr.includes(targetName)) {
                return true;
              }
              // Category semantic matching
              if (targetName.includes('petrol') || targetName.includes('gas station') || targetName.includes('fuel')) {
                return s.category === 'gas_station' || /petrol|fuel|indianoil|hp|bharat|shell/i.test(sName);
              }
              if (targetName.includes('cng')) {
                return s.category === 'cng_station' || /cng/i.test(sName);
              }
              if (targetName.includes('tea') || targetName.includes('chai') || targetName.includes('food') || targetName.includes('dhaba')) {
                return s.category === 'restaurant' || /tea|chai|dhaba|restaurant|cafe/i.test(sName);
              }
            }
            return false;
          });

          if (matchIdx !== -1) {
            const removedName = updatedStops[matchIdx].name;
            updatedStops = updatedStops.filter((_, i) => i !== matchIdx);
            appliedDescriptions.push(`removed ${removedName}`);
          }
        }

        // Step 2: Handle Travel Mode and Toll Avoidance
        const modeAction = interpretation.actions.find((a) => a.type === 'SET_TRAVEL_MODE');
        if (modeAction?.travelMode) {
          updatedTravelMode = modeAction.travelMode;
          appliedDescriptions.push(`travel mode set to ${updatedTravelMode}`);
        }

        const tollAction = interpretation.actions.find((a) => a.type === 'TOGGLE_TOLLS');
        if (tollAction) {
          updatedAvoidTolls = tollAction.avoidTolls !== undefined ? tollAction.avoidTolls : !updatedAvoidTolls;
          appliedDescriptions.push(updatedAvoidTolls ? 'avoiding tolls' : 'allowing tolls');
        }

        // Step 3: Destination and Origin updates
        const destAction = interpretation.actions.find((a) => a.type === 'SET_DESTINATION' || a.type === 'CHANGE_DESTINATION');
        const origAction = interpretation.actions.find((a) => a.type === 'SET_ORIGIN' || a.type === 'CHANGE_ORIGIN');

        if (destAction?.placeQuery) {
          const bias = updatedOrigin?.latLng || userLocation || undefined;
          const resolvedDest = await resolvePlaceToWaypoint(destAction.placeQuery, bias);
          if (resolvedDest) {
            updatedDestination = resolvedDest;
            appliedDescriptions.push(`destination set to ${resolvedDest.name}`);
          } else {
            appliedDescriptions.push(`could not verify destination "${destAction.placeQuery}"`);
          }
        }

        if (origAction?.placeQuery) {
          if (origAction.placeQuery.toLowerCase().includes('current') || origAction.placeQuery.toLowerCase().includes('meri location')) {
            const coords = userLocation || { lat: 28.6139, lng: 77.209 };
            updatedOrigin = {
              id: 'curr-loc',
              name: 'Current Location',
              address: userLocation ? 'My Current GPS Location' : 'Delhi (Current Location)',
              latLng: coords,
              isCurrentLocation: true,
            };
            appliedDescriptions.push('origin set to current location');
          } else {
            const resolvedOrig = await resolvePlaceToWaypoint(origAction.placeQuery);
            if (resolvedOrig) {
              updatedOrigin = resolvedOrig;
              appliedDescriptions.push(`origin set to ${resolvedOrig.name}`);
            } else {
              appliedDescriptions.push(`could not verify origin "${origAction.placeQuery}"`);
            }
          }
        }

        // Ensure origin exists if destination is set
        if (updatedDestination && !updatedOrigin) {
          updatedOrigin = {
            id: 'curr-loc',
            name: 'Current Location',
            address: userLocation ? 'My Current GPS Location' : 'Delhi, India',
            latLng: userLocation || { lat: 28.6139, lng: 77.209 },
            isCurrentLocation: true,
          };
        }

        // Step 4: Resolve and insert ADD_STOP actions with deterministic anchor
        const addActions = interpretation.actions.filter((a) => a.type === 'ADD_STOP' || a.type === 'ADD_SMART_STOP');
        for (const add of addActions) {
          if (!add.placeQuery) continue;

          // Deterministic anchor resolution: strictly separates origin from destination
          const resolvedAnchor = resolveSearchAnchor(
            { ...current, origin: updatedOrigin, destination: updatedDestination, stops: updatedStops },
            userLocation,
            add.searchAnchor,
            undefined,
            activeRoute?.path
          );

          // Clean query without corrupting it with "near Current Location" or "near Starting Point"
          const cleanQuery = add.placeQuery;
          const biasCenter = resolvedAnchor?.coordinates || updatedOrigin?.latLng || userLocation || undefined;

          const resolvedWp = await resolvePlaceToWaypoint(cleanQuery, biasCenter, add.category);

          if (resolvedWp) {
            // Duplicate stop prevention: don't add if identical name or placeId already in route
            const isDuplicate = updatedStops.some(
              (s) =>
                (resolvedWp.placeId && s.placeId === resolvedWp.placeId) ||
                s.name.toLowerCase() === resolvedWp.name.toLowerCase()
            );

            if (!isDuplicate) {
              const anchorDesc =
                add.searchAnchor === 'origin'
                  ? ' near origin'
                  : add.searchAnchor === 'destination'
                  ? ' near destination'
                  : '';

              if (add.position === 'start' || add.searchAnchor === 'origin') {
                updatedStops.unshift(resolvedWp);
                appliedDescriptions.push(`added ${resolvedWp.name}${anchorDesc}`);
              } else if (add.position === 'end' || add.searchAnchor === 'destination') {
                updatedStops.push(resolvedWp);
                appliedDescriptions.push(`added ${resolvedWp.name}${anchorDesc}`);
              } else if (add.position === 'before') {
                if (add.relativeTo === 'destination' || !add.relativeTo) {
                  // Before destination = at end of intermediate stops list
                  updatedStops.push(resolvedWp);
                } else {
                  const relIdx =
                    typeof add.relativeTo === 'number'
                      ? add.relativeTo - 1
                      : updatedStops.findIndex((s) => s.name.toLowerCase().includes(String(add.relativeTo).toLowerCase()));
                  if (relIdx >= 0) updatedStops.splice(relIdx, 0, resolvedWp);
                  else updatedStops.push(resolvedWp);
                }
                appliedDescriptions.push(`added ${resolvedWp.name}`);
              } else if (add.position === 'after' && add.relativeTo) {
                const relIdx =
                  typeof add.relativeTo === 'number'
                    ? add.relativeTo - 1
                    : updatedStops.findIndex((s) => s.name.toLowerCase().includes(String(add.relativeTo).toLowerCase()));
                if (relIdx >= 0) updatedStops.splice(relIdx + 1, 0, resolvedWp);
                else updatedStops.push(resolvedWp);
                appliedDescriptions.push(`added ${resolvedWp.name}`);
              } else {
                updatedStops.push(resolvedWp);
                appliedDescriptions.push(`added ${resolvedWp.name}`);
              }
            }
          } else {
            console.warn(`[JourneyContext] Could not resolve waypoint for "${cleanQuery}"`);
            appliedDescriptions.push(`could not identify confident location for "${cleanQuery}"`);
          }
        }

        const tPlaces = performance.now();
        const placeSearchMs = Math.round(tPlaces - tIntent);

        // Step 5: Commit single consolidated state mutation
        const nextJourney: JourneyState = {
          ...current,
          revision: current.revision + 1,
          origin: updatedOrigin,
          destination: updatedDestination,
          stops: updatedStops,
          travelMode: updatedTravelMode,
          avoidTolls: updatedAvoidTolls,
        };

        setJourney(nextJourney);

        // Step 6: Recalculate route ONCE for the entire combined batch
        await triggerRouting(nextJourney);

        const totalExecutionMs = Math.round(performance.now() - tStart);
        const recordedTimings: TimingMetrics = {
          intentExtractionMs: intentMs,
          placeResolutionMs: placeSearchMs,
          totalExecutionMs,
        };
        setTimings(recordedTimings);
        if (typeof window !== 'undefined') {
          (window as any).raahiTimings = recordedTimings;
        }

        const isHindi = interpretation.detectedLanguage === 'hi' || /[\u0900-\u097F]/.test(commandText);
        const responseMsg =
          appliedDescriptions.length > 0
            ? (isHindi
                ? `रास्ता अपडेट हो गया है: ${appliedDescriptions.join(', ')}.`
                : `Updated route: ${appliedDescriptions.join(', ')}.`)
            : (interpretation.spokenResponse || 'No changes applied.');

        setLastMessage(responseMsg);
        speechService.speak(responseMsg);
        setIsProcessingCommand(false);
        return { success: true, message: responseMsg };
      } catch (err: any) {
        console.warn('executeCommand warning:', err?.message || err);
        const errMsg = 'Failed to process command. Please check network.';
        setLastMessage(errMsg);
        speechService.speak(errMsg);
        setIsProcessingCommand(false);
        return { success: false, message: errMsg };
      }
    },
    [activeRoute, triggerRouting, userLocation]
  );

  // Confirm Pending Proposal
  const confirmProposal = useCallback(() => {
    if (!pendingProposal) return;
    const current = journeyRef.current;

    if (pendingProposal.targetRevision !== current.revision) {
      setPendingProposal(null);
      const staleMsg = 'Journey changed since proposal was generated. Discarded.';
      setLastMessage(staleMsg);
      speechService.speak(staleMsg);
      return;
    }

    pushHistory(current, activeRoute, pendingProposal.summary);
    const newJourney: JourneyState = {
      ...pendingProposal.proposedJourney,
      revision: current.revision + 1,
    };

    setJourney(newJourney);
    triggerRouting(newJourney);
    setPendingProposal(null);

    const msg = `Changes applied successfully!`;
    setLastMessage(msg);
    speechService.speak(msg);
  }, [activeRoute, pendingProposal, triggerRouting]);

  // Cancel Pending Proposal
  const cancelProposal = useCallback(() => {
    setPendingProposal(null);
    const msg = 'Pending changes cancelled.';
    setLastMessage(msg);
    speechService.speak(msg);
  }, []);

  return (
    <JourneyContext.Provider
      value={{
        journey,
        activeRoute,
        routeLoading,
        routeError,
        userLocation,
        locationStatus,
        pendingProposal,
        detourCandidates,
        detourLoading,
        canUndo: history.length > 0,
        lastMessage,
        isProcessingCommand,
        theme,
        toggleTheme,
        navigationState,
        startNavigation,
        endNavigation,
        timings,
        lastFramedRouteId,
        setLastFramedRouteId,
        requestUserLocation,
        setOrigin,
        setDestination,
        clearDestination,
        clearJourney,
        addStop,
        removeStopByName,
        removeStopByOrdinal,
        reorderStops,
        insertStopRelative,
        clearAllStops,
        toggleAvoidTolls,
        setTravelMode,
        executeCommand,
        confirmProposal,
        cancelProposal,
        undo,
        dismissDetourCandidates,
        selectDetourCandidate,
        findSmartStop,
      }}
    >
      {children}
    </JourneyContext.Provider>
  );
};

export const useJourney = () => {
  const context = useContext(JourneyContext);
  if (!context) {
    throw new Error('useJourney must be used within a JourneyProvider');
  }
  return context;
};
