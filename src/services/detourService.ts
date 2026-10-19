import { DetourCandidate, JourneyState, LatLng, SearchAnchor, Waypoint } from '../types/navigation';
import { resolveSearchAnchor } from './anchorService';

export async function findLowestDetourStop(
  journey: JourneyState,
  category: 'gas_station' | 'cng_station' | 'restaurant' | 'hospital' | 'pharmacy' | 'parking' | 'ev_charging' = 'gas_station',
  anchorType?: SearchAnchor,
  stopIdentifier?: { byName?: string; byOrdinal?: number },
  userLocation?: LatLng | null,
  routePath?: LatLng[]
): Promise<{ best: DetourCandidate | null; ranked: DetourCandidate[]; error?: string }> {
  if (!journey.origin || !journey.destination) {
    return { best: null, ranked: [], error: 'Both origin and destination are required to calculate detour' };
  }

  try {
    // 1. Explicitly resolve the anchor (strictly separates origin from destination)
    const resolvedAnchor = resolveSearchAnchor(
      journey,
      userLocation || null,
      anchorType,
      stopIdentifier,
      routePath
    );

    if (!resolvedAnchor) {
      return { best: null, ranked: [], error: 'Unable to resolve search location anchor' };
    }

    const categoryLabels: Record<string, string> = {
      gas_station: 'Petrol pump',
      cng_station: 'CNG pump',
      restaurant: 'Dhaba restaurant food',
      hospital: 'Hospital emergency',
      pharmacy: 'Pharmacy medical store',
      parking: 'Parking',
      ev_charging: 'EV charging station',
    };

    const label = categoryLabels[category] || 'Petrol pump';

    // Build context-grounded query matching the selected anchor
    const isGenericName = !resolvedAnchor.name || /^(?:starting point|current location|my current|my starting)/i.test(resolvedAnchor.name);
    let textQuery = label;
    if (!isGenericName) {
      if (resolvedAnchor.anchorType === 'stop' || resolvedAnchor.anchorType === 'destination') {
        textQuery = `${label} near ${resolvedAnchor.name}`;
      } else if (resolvedAnchor.anchorType === 'origin') {
        textQuery = `${label} in ${resolvedAnchor.name}`;
      }
    }

    // 2. Fetch real places biased to the resolved anchor
    const placesRes = await fetch('/api/places/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        textQuery,
        locationBias: {
          center: resolvedAnchor.coordinates,
          radius: resolvedAnchor.radiusMeters,
        },
        maxResultCount: 8,
      }),
    });

    const placesData = await placesRes.json();
    const candidates = placesData.places || [];

    if (candidates.length === 0) {
      return { best: null, ranked: [], error: `No ${label.toLowerCase()} found near ${resolvedAnchor.name}` };
    }

    // 3. Call /api/detour-rank with current travel mode and insertion hint
    const rankRes = await fetch('/api/detour-rank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: journey.origin,
        destination: journey.destination,
        currentStops: journey.stops,
        candidates,
        travelMode: journey.travelMode || 'DRIVE',
        anchorType: resolvedAnchor.anchorType,
        suggestedInsertIndex: resolvedAnchor.insertionIndex,
      }),
    });

    const rankData = await rankRes.json();
    if (!rankRes.ok) {
      return { best: null, ranked: [], error: rankData.error || 'Failed to score detour' };
    }

    // Tag candidates with anchor info
    const rankedWithAnchor = (rankData.rankedCandidates || []).map((c: any) => ({
      ...c,
      anchorType: resolvedAnchor.anchorType,
      bestInsertIndex: resolvedAnchor.insertionIndex,
    }));

    return {
      best: rankedWithAnchor[0] || null,
      ranked: rankedWithAnchor,
    };
  } catch (err: any) {
    console.warn('findLowestDetourStop warning:', err?.message || err);
    return { best: null, ranked: [], error: err?.message || 'Detour discovery failed' };
  }
}
