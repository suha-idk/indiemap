import { JourneyState, LatLng, SearchAnchor, Waypoint } from '../types/navigation';
import { searchPlaces } from './placesService';

export interface ResolvedAnchor {
  anchorType: SearchAnchor;
  coordinates: LatLng;
  name: string;
  source: 'origin' | 'destination' | 'current_location' | 'route' | 'stop';
  radiusMeters: number;
  insertionIndex: number; // Suggested index in stops array
}

/**
 * Explicit, deterministic location anchor resolver for Raahi.
 * Strictly guarantees that origin queries NEVER accidentally use destination coordinates.
 */
export function resolveSearchAnchor(
  journey: JourneyState,
  userLocation: LatLng | null,
  requestedAnchor?: SearchAnchor,
  stopIdentifier?: { byName?: string; byOrdinal?: number },
  routePath?: LatLng[]
): ResolvedAnchor | null {
  const originCoord = journey.origin?.latLng || (userLocation ? userLocation : null);
  const destCoord = journey.destination?.latLng || null;

  // 1. Explicit Origin Anchor ("near my origin", "near starting point", "start ke paas", "origin ke paas")
  if (requestedAnchor === 'origin' || (requestedAnchor as any) === 'start') {
    if (!originCoord) {
      console.warn('[AnchorResolver] Origin requested but origin coordinates unavailable. Refusing to substitute destination.');
      return null;
    }
    const resolved: ResolvedAnchor = {
      anchorType: 'origin',
      coordinates: originCoord,
      name: journey.origin?.name || 'Starting Point',
      source: 'origin',
      radiusMeters: 10000,
      insertionIndex: 0, // Add right after origin (first stop in itinerary)
    };
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[AnchorResolver] Resolved anchor: ORIGIN -> (${resolved.coordinates.lat}, ${resolved.coordinates.lng}) [${resolved.name}]`);
    }
    return resolved;
  }

  // 2. Explicit Destination Anchor ("near destination", "near end point", "manzil ke paas")
  if (requestedAnchor === 'destination' || (requestedAnchor as any) === 'end') {
    if (!destCoord) {
      console.warn('[AnchorResolver] Destination requested but destination coordinates unavailable');
      return null;
    }
    const resolved: ResolvedAnchor = {
      anchorType: 'destination',
      coordinates: destCoord,
      name: journey.destination?.name || 'Destination',
      source: 'destination',
      radiusMeters: 15000,
      insertionIndex: journey.stops.length, // Add at end before destination
    };
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[AnchorResolver] Resolved anchor: DESTINATION -> (${resolved.coordinates.lat}, ${resolved.coordinates.lng}) [${resolved.name}]`);
    }
    return resolved;
  }

  // 3. User Current Location Anchor ("near me", "mere paas", "aas-paas", "current location")
  if (requestedAnchor === 'current_location') {
    if (!userLocation) {
      // If GPS permission is not granted, DO NOT silently substitute destination!
      if (originCoord) {
        console.warn('[AnchorResolver] GPS not granted, falling back to journey origin coordinates instead of destination.');
        return {
          anchorType: 'current_location',
          coordinates: originCoord,
          name: journey.origin?.name || 'Starting Point',
          source: 'current_location',
          radiusMeters: 8000,
          insertionIndex: 0,
        };
      }
      console.warn('[AnchorResolver] Current location requested but GPS and origin coordinates unavailable');
      return null;
    }
    const resolved: ResolvedAnchor = {
      anchorType: 'current_location',
      coordinates: userLocation,
      name: 'My Current Location',
      source: 'current_location',
      radiusMeters: 8000,
      insertionIndex: 0,
    };
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[AnchorResolver] Resolved anchor: CURRENT_LOCATION -> (${userLocation.lat}, ${userLocation.lng})`);
    }
    return resolved;
  }

  // 4. Specific Stop Anchor ("near Cyber Hub", "near 2nd stop", "doosre stop ke paas")
  if (requestedAnchor === 'stop') {
    let targetStop: Waypoint | undefined;
    let targetIdx = 0;

    if (stopIdentifier?.byOrdinal) {
      targetIdx = stopIdentifier.byOrdinal - 1;
      targetStop = journey.stops[targetIdx];
    } else if (stopIdentifier?.byName) {
      const lower = stopIdentifier.byName.toLowerCase().trim();
      targetIdx = journey.stops.findIndex(
        (s) => s.name.toLowerCase().includes(lower) || (s.address && s.address.toLowerCase().includes(lower))
      );
      if (targetIdx !== -1) {
        targetStop = journey.stops[targetIdx];
      }
    }

    if (targetStop?.latLng) {
      const resolved: ResolvedAnchor = {
        anchorType: 'stop',
        coordinates: targetStop.latLng,
        name: targetStop.name,
        source: 'stop',
        radiusMeters: 10000,
        insertionIndex: targetIdx + 1, // Insert right after this stop
      };
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[AnchorResolver] Resolved anchor: STOP "${targetStop.name}" -> (${targetStop.latLng.lat}, ${targetStop.latLng.lng})`);
      }
      return resolved;
    }
  }

  // 5. Along Route ("on the way", "rasta par", "beech mein", "along my route", or default)
  if (requestedAnchor === 'route' || !requestedAnchor) {
    if (routePath && routePath.length > 0) {
      // Pick a corridor point at ~30% into the route or midpoint
      const midIdx = Math.floor(routePath.length * 0.35);
      const corridorPt = routePath[midIdx] || routePath[0];
      const resolved: ResolvedAnchor = {
        anchorType: 'route',
        coordinates: corridorPt,
        name: 'Along Active Route',
        source: 'route',
        radiusMeters: 25000,
        insertionIndex: Math.max(0, journey.stops.length),
      };
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[AnchorResolver] Resolved anchor: ROUTE CORRIDOR -> (${corridorPt.lat}, ${corridorPt.lng})`);
      }
      return resolved;
    }

    // If no route polyline exists yet, default strictly to origin rather than destination!
    if (originCoord) {
      return {
        anchorType: 'origin',
        coordinates: originCoord,
        name: journey.origin?.name || 'Starting Point',
        source: 'origin',
        radiusMeters: 15000,
        insertionIndex: 0,
      };
    }
  }

  return null;
}

/**
 * Asynchronously ensures the waypoint has valid latitude and longitude coordinates.
 * If only a textual name/address is present, resolves via Google Places API first.
 */
export async function ensureWaypointCoordinates(wp: Waypoint): Promise<Waypoint> {
  if (wp.latLng && typeof wp.latLng.lat === 'number' && typeof wp.latLng.lng === 'number') {
    return wp;
  }
  try {
    const places = await searchPlaces(wp.address || wp.name);
    if (places.length > 0 && places[0].latLng) {
      return {
        ...wp,
        placeId: places[0].id || wp.placeId,
        latLng: places[0].latLng,
        address: places[0].address || wp.address,
      };
    }
  } catch (err) {
    console.warn('[AnchorResolver] Could not resolve coordinates for waypoint:', wp.name, err);
  }
  return wp;
}
