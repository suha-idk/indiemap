import { ActiveRoute, JourneyState } from '../types/navigation';
import { decodePolyline, formatDistance, formatDuration, parseDurationToSeconds } from '../utils/polyline';

export async function computeRoute(
  journey: JourneyState,
  requestId: string
): Promise<{ route: ActiveRoute | null; error: string | null }> {
  if (!journey.origin || !journey.destination) {
    return { route: null, error: null };
  }

  try {
    const res = await fetch('/api/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: journey.origin,
        destination: journey.destination,
        intermediates: journey.stops,
        travelMode: journey.travelMode,
        routeModifiers: {
          avoidTolls: journey.avoidTolls,
          avoidHighways: journey.avoidHighways,
        },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      let errMsg = 'Failed to compute route';
      if (typeof data.error === 'string') {
        errMsg = data.error;
      } else if (data.error && typeof data.error.message === 'string') {
        errMsg = data.error.message;
      } else if (typeof data.message === 'string') {
        errMsg = data.message;
      } else if (data.error) {
        errMsg = JSON.stringify(data.error);
      }
      return { route: null, error: errMsg };
    }

    const firstRoute = data.routes?.[0];
    if (!firstRoute) {
      return { route: null, error: 'No route found between selected points' };
    }

    const durationSeconds = parseDurationToSeconds(firstRoute.duration);
    const distanceMeters = firstRoute.distanceMeters || 0;
    const polyline = firstRoute.polyline?.encodedPolyline || '';
    const path = polyline ? decodePolyline(polyline) : [];

    const activeRoute: ActiveRoute = {
      requestId,
      revision: journey.revision,
      travelMode: journey.travelMode,
      distanceMeters,
      distanceKm: formatDistance(distanceMeters),
      durationSeconds,
      durationFormatted: formatDuration(durationSeconds),
      description: firstRoute.description || 'Recommended route',
      polyline,
      path,
      viewport: firstRoute.viewport,
      legs: firstRoute.legs || [],
      isStale: false,
      calculatedAt: new Date().toISOString(),
    };

    return { route: activeRoute, error: null };
  } catch (err: any) {
    console.warn('computeRoute network error:', err);
    return { route: null, error: typeof err?.message === 'string' ? err.message : 'Network error calculating route' };
  }
}
