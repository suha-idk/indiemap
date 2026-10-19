import { LatLng, Waypoint } from '../types/navigation';

export interface PlaceResult {
  id: string;
  name: string;
  address: string;
  latLng?: LatLng;
  rating?: number;
  userRatingCount?: number;
  openNow?: boolean;
  category?: 'gas_station' | 'cng_station' | 'restaurant' | 'hospital' | 'pharmacy' | 'parking' | 'ev_charging' | 'custom';
  types?: string[];
  primaryType?: string;
}

export async function searchPlaces(
  query: string,
  locationBias?: { center: LatLng; radius?: number }
): Promise<PlaceResult[]> {
  try {
    const res = await fetch('/api/places/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        textQuery: query,
        locationBias,
        maxResultCount: 8,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.places) {
      return [];
    }

    return data.places.map((p: any) => ({
      id: p.id,
      name: p.displayName?.text || query,
      address: p.formattedAddress || '',
      latLng: p.location ? { lat: p.location.latitude, lng: p.location.longitude } : undefined,
      rating: p.rating,
      userRatingCount: p.userRatingCount,
      openNow: p.currentOpeningHours?.openNow,
      category: mapPlaceCategory(p.types || []),
      types: p.types || [],
      primaryType: p.primaryType || '',
    }));
  } catch (err: any) {
    console.warn('searchPlaces warning:', err?.message || err);
    return [];
  }
}

export async function searchNearbyPlaces(
  center: LatLng,
  category: 'gas_station' | 'cng_station' | 'restaurant' | 'hospital' | 'pharmacy' | 'parking' | 'ev_charging',
  radius: number = 8000
): Promise<PlaceResult[]> {
  try {
    const typeMapping: Record<string, string[]> = {
      gas_station: ['gas_station'],
      cng_station: ['gas_station'],
      restaurant: ['restaurant', 'cafe', 'fast_food_restaurant'],
      hospital: ['hospital'],
      pharmacy: ['pharmacy'],
      parking: ['parking'],
      ev_charging: ['electric_vehicle_charging_station'],
    };

    const includedTypes = typeMapping[category] || ['gas_station'];

    const res = await fetch('/api/places/nearby', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        center,
        includedTypes,
        radius,
        maxResultCount: 10,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.places) {
      return [];
    }

    return data.places.map((p: any) => ({
      id: p.id,
      name: p.displayName?.text || 'Nearby Place',
      address: p.formattedAddress || '',
      latLng: p.location ? { lat: p.location.latitude, lng: p.location.longitude } : undefined,
      rating: p.rating,
      userRatingCount: p.userRatingCount,
      openNow: p.currentOpeningHours?.openNow,
      category,
      types: p.types || [],
      primaryType: p.primaryType || '',
    }));
  } catch (err: any) {
    console.warn('searchNearbyPlaces warning:', err?.message || err);
    return [];
  }
}

/**
 * Normalizes and scores place relevance to prevent selecting unrelated apartments or gyms.
 */
export function scoreCandidatePlace(cleanQuery: string, candidate: PlaceResult): number {
  if (!candidate || !candidate.name) return 0;

  const normQ = cleanQuery.toLowerCase().replace(/[^a-z0-9\u0900-\u097F\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const normName = candidate.name.toLowerCase().replace(/[^a-z0-9\u0900-\u097F\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const normAddr = (candidate.address || '').toLowerCase().replace(/[^a-z0-9\u0900-\u097F\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const types = candidate.types || [];
  const primaryType = (candidate.primaryType || '').toLowerCase();

  const expand = (str: string) =>
    str
      .replace(/\bdps\b/gi, 'delhi public school dps')
      .replace(/\brk\b/gi, 'rama krishna r k rk')
      .replace(/\biit\b/gi, 'indian institute of technology iit')
      .replace(/\bgtbit\b/gi, 'guru tegh bahadur institute of technology gtbit')
      .replace(/\baiims\b/gi, 'all india institute of medical sciences aiims');

  const expQ = expand(normQ);
  const expName = expand(normName);

  if (normName === normQ || expName === expQ) return 1.0;

  const isLocalityType = types.some((t) =>
    ['sublocality', 'sublocality_level_1', 'sublocality_level_2', 'locality', 'neighborhood', 'political', 'administrative_area_level_2'].includes(t)
  );
  const isCommercialStoreOrGym = types.some((t) =>
    ['gym', 'fitness_center', 'spa', 'beauty_salon', 'hair_care', 'store', 'clothing_store', 'car_repair', 'department_store'].includes(t)
  );
  const isSchoolOrEducation = types.some((t) =>
    ['school', 'educational_institution', 'university', 'college', 'primary_school', 'secondary_school'].includes(t)
  );

  const queryMentionsCommercial = /gym|fitness|salon|spa|bakery|store|shop|repair|mall|market/i.test(normQ);
  const queryMentionsSchool = /school|dps|public school|vidyalaya|college|university|institute/i.test(expQ);

  // Locality Query Protection: (e.g. "Rajouri Garden")
  // Prefer the actual locality result over a gym or store located in that area
  if (!queryMentionsCommercial && !queryMentionsSchool) {
    if (isLocalityType && (normName.includes(normQ) || normQ.includes(normName))) {
      return 0.98;
    }
    if (isCommercialStoreOrGym && !normName.startsWith(normQ)) {
      return 0.20;
    }
  }

  // School / Institution Protection: (e.g. "DPS RK Puram")
  // Do not select an apartment or shop that merely contains "RK Puram" in address
  if (queryMentionsSchool) {
    if (isSchoolOrEducation || expName.includes('school') || expName.includes('institute') || expName.includes('dps')) {
      // Good candidate
    } else {
      return 0.15;
    }
  }

  const qTokens = expQ.split(' ').filter((t) => t.length > 1);
  if (qTokens.length === 0) return 0.5;

  let nameMatchCount = 0;
  for (const token of qTokens) {
    if (expName.includes(token)) {
      nameMatchCount++;
    }
  }
  const nameScore = nameMatchCount / qTokens.length;

  let addrMatchCount = 0;
  for (const token of qTokens) {
    if (normAddr.includes(token)) {
      addrMatchCount++;
    }
  }
  const addrScore = addrMatchCount / qTokens.length;

  let finalScore = nameScore * 0.8 + addrScore * 0.2;

  // Preferences: prioritize main institution campus over gates/parking
  if (queryMentionsSchool && isSchoolOrEducation) {
    finalScore += 0.15;
    if (primaryType === 'school' && !normName.includes('parking') && !normName.includes('gate')) {
      finalScore += 0.1;
    }
  }
  if (isLocalityType && normName.includes(normQ)) {
    finalScore += 0.15;
  }

  return Math.max(0, Math.min(1.0, finalScore));
}

export async function resolvePlaceToWaypoint(
  query: string,
  biasCenter?: LatLng,
  category?: any
): Promise<Waypoint | null> {
  const clean = query
    .replace(/^(?:add\s+(?:an?\s+)?(?:intermediate\s+)?stop\s+(?:at|in|near)?\s*|stop\s+(?:at|in|near)?\s*|at\s+|in\s+|near\s+|par\s+|pe\s+|ko\s+)/i, '')
    .replace(/(?:\s+as\s+(?:an?\s+)?(?:intermediate\s+)?stop|\s+as\s+a\s+stop|\s+to\s+my\s+route|\s+to\s+route|\s+in\s+route|\s+stop|\s+waala|\s+wala)$/i, '')
    .trim();

  if (!clean) return null;

  // Search Places API
  const results = await searchPlaces(clean, biasCenter ? { center: biasCenter, radius: 25000 } : undefined);

  if (results.length === 0) {
    // If biased search found nothing (e.g. place is outside 25km circle), retry without bias
    if (biasCenter) {
      const globalResults = await searchPlaces(clean);
      if (globalResults.length > 0) {
        return selectBestCandidate(clean, globalResults, category);
      }
    }
    return null;
  }

  const bestBiased = selectBestCandidate(clean, results, category);
  if (bestBiased) return bestBiased;

  // If biased candidates didn't yield a confident match, try unbiased global search
  if (biasCenter) {
    const globalResults = await searchPlaces(clean);
    return selectBestCandidate(clean, globalResults, category);
  }

  return null;
}

function selectBestCandidate(
  cleanQuery: string,
  candidates: PlaceResult[],
  category?: any
): Waypoint | null {
  const scored = candidates
    .map((c) => ({
      candidate: c,
      score: scoreCandidatePlace(cleanQuery, c),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  // Strict confidence threshold (0.60): prevents selecting an unrelated apartment or gym!
  if (!best || best.score < 0.60 || !best.candidate.latLng) {
    console.warn(`[PlacesService] No confident match for "${cleanQuery}". Top score was: ${best?.score || 0}`);
    return null;
  }

  return {
    id: best.candidate.id || `place-${Date.now()}`,
    placeId: best.candidate.id,
    name: best.candidate.name,
    address: best.candidate.address,
    latLng: best.candidate.latLng,
    category: category || best.candidate.category || 'custom',
  };
}

function mapPlaceCategory(types: string[]): any {
  if (types.includes('gas_station')) return 'gas_station';
  if (types.includes('restaurant') || types.includes('cafe')) return 'restaurant';
  if (types.includes('hospital')) return 'hospital';
  if (types.includes('pharmacy')) return 'pharmacy';
  if (types.includes('parking')) return 'parking';
  if (types.includes('electric_vehicle_charging_station')) return 'ev_charging';
  return 'custom';
}
