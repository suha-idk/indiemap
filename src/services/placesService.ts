import { LatLng, Waypoint, PlaceResolutionResult } from '../types/navigation';
import { generatePlaceSearchVariants, transliterateDevanagariToLatin, KNOWN_PLACE_DICTIONARY } from '../utils/transliteration';

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

function getEndpointUrl(path: string): string {
  if (typeof window !== 'undefined') return path;
  return `http://127.0.0.1:3000${path}`;
}

export async function searchPlaces(
  query: string,
  locationBias?: { center: LatLng; radius?: number }
): Promise<PlaceResult[]> {
  try {
    const res = await fetch(getEndpointUrl('/api/places/search'), {
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

    const res = await fetch(getEndpointUrl('/api/places/nearby'), {
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

export interface ExtractedPlaceContext {
  cleanPlaceName: string;
  localityContext?: string;
  categoryHint?: string;
  originalQuery: string;
}

/**
 * Separates place identity from geographic context and descriptive wording.
 * e.g. "Laxmi Narayan Mandir in Malviya Nagar" -> name: "Laxmi Narayan Mandir", locality: "Malviya Nagar"
 * e.g. "मुझे मालवीय नगर के लक्ष्मी नारायण मंदिर ले चलो" -> name: "लक्ष्मी नारायण मंदिर", locality: "मालवीय नगर"
 */
export function extractPlaceContext(rawQuery: string): ExtractedPlaceContext {
  const original = (rawQuery || '').trim();
  let clean = original;
  let prev = '';

  // Clean conversational prefixes & suffixes iteratively
  while (prev !== clean) {
    prev = clean;
    clean = clean
      .replace(/^(?:take\s+me\s+to|navigate\s+to|drive\s+to|go\s+to|set\s+destination\s+to|chalo|mujhe|humko|kripya|please|mala|aamhi|bhai|मुझे|हमको|कृपया|मला)\s+/gi, '')
      .replace(/\s+(?:le\s+chalo|le\s+jao|jaana\s+hai|chalo|chalein|jayache\s+aahe|lagu\s+karo|pahije|karo|chuno|banao|ले\s+चलो|ले\s+जाओ|जाना\s+है|चलो|पाहिजे)$/gi, '')
      .trim();
  }

  let localityContext: string | undefined = undefined;
  let categoryHint: string | undefined = undefined;

  // Infer category hint
  if (/mandir|temple|masjid|gurudwara|church|मंदिर/i.test(clean)) categoryHint = 'place_of_worship';
  else if (/school|vidyalaya|dps|college|university|institute|स्कूल/i.test(clean)) categoryHint = 'school';
  else if (/hospital|clinic|aiims|dispensary|अस्पताल/i.test(clean)) categoryHint = 'hospital';
  else if (/hotel|resort|radisson|marriott|hyatt|taj|oberoi|होटल/i.test(clean)) categoryHint = 'lodging';
  else if (/museum|sangrahalaya|म्यूजियम|संग्रहालय/i.test(clean)) categoryHint = 'museum';
  else if (/petrol|fuel|cng|gas\s*station|पेट्रोल/i.test(clean)) categoryHint = 'gas_station';
  else if (/restaurant|cafe|dhaba|रेस्टोरेंट|ढाबा/i.test(clean)) categoryHint = 'restaurant';

  // Extract locality or geographic context
  // Hindi/Marathi: "मालवीय नगर के लक्ष्मी नारायण मंदिर", "पुण्यातील लोणावळा"
  const regionalLocalityMatch = clean.match(/^([\u0900-\u097F\w\s]+?)\s+(?:के|में|का|की|तील|पाशी|मधील)\s+([\u0900-\u097F\w\s]+)$/i);
  if (regionalLocalityMatch) {
    localityContext = regionalLocalityMatch[1].trim();
    clean = regionalLocalityMatch[2].trim();
  } else {
    // English: "Laxmi Narayan Mandir in Malviya Nagar", "Radisson Blu near airport"
    const engLocalityMatch = clean.match(/^(.+?)\s+(?:in|near|at|around|close\s+to)\s+(.+)$/i);
    if (engLocalityMatch) {
      clean = engLocalityMatch[1].trim();
      localityContext = engLocalityMatch[2].trim();
    }
  }

  return {
    cleanPlaceName: clean,
    localityContext,
    categoryHint,
    originalQuery: original,
  };
}

/**
 * Normalizes and scores place relevance to prevent selecting unrelated apartments or gyms.
 * Cross-references transliterated variants and canonical names so Devanagari and regional queries
 * match valid English-script Google Places results.
 * Distinctly separates place identity similarity from locality/address evidence.
 */
export function scoreCandidatePlace(cleanQuery: string, candidate: PlaceResult): number {
  if (!candidate || !candidate.name) return 0;

  const { cleanPlaceName, localityContext, categoryHint } = extractPlaceContext(cleanQuery);
  const rawVariants = generatePlaceSearchVariants(cleanPlaceName);
  if (!rawVariants.includes(cleanPlaceName)) {
    rawVariants.unshift(cleanPlaceName);
  }
  // Include full query variant as well
  if (cleanQuery !== cleanPlaceName && !rawVariants.includes(cleanQuery)) {
    rawVariants.push(cleanQuery);
  }

  let bestVariantScore = 0;

  for (const variant of rawVariants) {
    const normQ = variant.toLowerCase().replace(/[^a-z0-9\u0900-\u097F\s]/g, ' ').replace(/\s+/g, ' ').trim();
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

    // Exact name match
    if (normName === normQ || expName === expQ) {
      bestVariantScore = Math.max(bestVariantScore, 1.0);
      continue;
    }

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
        bestVariantScore = Math.max(bestVariantScore, 0.98);
        continue;
      }
      if (isCommercialStoreOrGym && !normName.startsWith(normQ)) {
        bestVariantScore = Math.max(bestVariantScore, 0.20);
        continue;
      }
    }

    // School / Institution Protection: (e.g. "DPS RK Puram")
    // Do not select an apartment or shop that merely contains "RK Puram" in address
    if (queryMentionsSchool) {
      if (!isSchoolOrEducation && !expName.includes('school') && !expName.includes('institute') && !expName.includes('dps')) {
        bestVariantScore = Math.max(bestVariantScore, 0.15);
        continue;
      }
    }

    const qTokens = expQ.split(' ').filter((t) => t.length > 1);
    if (qTokens.length === 0) {
      bestVariantScore = Math.max(bestVariantScore, 0.5);
      continue;
    }

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

    // Locality context check (e.g. "Malviya Nagar" / "मालवीय नगर" matched in address)
    let localityScore = 0;
    if (localityContext) {
      const locLatin = transliterateDevanagariToLatin(localityContext) || '';
      const locNorm = `${localityContext} ${locLatin}`.toLowerCase().replace(/[^a-z0-9\u0900-\u097F\s]/g, ' ').trim();
      const locTokens = locNorm.split(' ').filter((t) => t.length > 2);
      let locMatches = 0;
      for (const tok of locTokens) {
        if (normAddr.includes(tok) || normName.includes(tok)) {
          locMatches++;
        }
      }
      if (locTokens.length > 0) {
        localityScore = Math.min(1.0, locMatches / (locTokens.length > 2 ? 2 : 1));
      }
    }

    let finalScore = localityContext
      ? nameScore * 0.65 + localityScore * 0.30 + addrScore * 0.05
      : nameScore * 0.80 + addrScore * 0.20;

    // Category type compatibility bonus
    if (categoryHint) {
      if (
        (categoryHint === 'place_of_worship' && (types.includes('hindu_temple') || types.includes('place_of_worship'))) ||
        (categoryHint === 'school' && isSchoolOrEducation) ||
        (categoryHint === 'hospital' && (types.includes('hospital') || types.includes('health'))) ||
        (categoryHint === 'lodging' && (types.includes('lodging') || types.includes('hotel'))) ||
        (categoryHint === 'gas_station' && types.includes('gas_station'))
      ) {
        finalScore += 0.10;
      }
    }

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

    bestVariantScore = Math.max(bestVariantScore, Math.max(0, Math.min(1.0, finalScore)));
  }

  return bestVariantScore;
}

/**
 * Detailed Place Resolution returning structured resolution status,
 * candidates, confidence scores, and diagnostic info.
 */
export async function resolvePlaceDetailed(
  query: string,
  biasCenter?: LatLng,
  category?: any
): Promise<PlaceResolutionResult> {
  const clean = query
    .replace(/^(?:add\s+(?:an?\s+)?(?:intermediate\s+)?stop\s+(?:at|in|near)?\s*|stop\s+(?:at|in|near)?\s*|at\s+|in\s+|near\s+|par\s+|pe\s+|ko\s+)/i, '')
    .replace(/(?:\s+as\s+(?:an?\s+)?(?:intermediate\s+)?stop|\s+as\s+a\s+stop|\s+to\s+my\s+route|\s+to\s+route|\s+in\s+route|\s+stop|\s+waala|\s+wala)$/i, '')
    .trim();

  if (!clean) {
    return {
      status: 'not_found',
      waypoint: null,
      candidates: [],
      confidenceScore: 0,
      clarificationMessage: 'No place name was provided.',
    };
  }

  const { cleanPlaceName, localityContext } = extractPlaceContext(clean);
  const variants = generatePlaceSearchVariants(cleanPlaceName);
  const allCandidates: PlaceResult[] = [];
  const seenIds = new Set<string>();

  // Search Places API with primary query (clean)
  const primaryResults = await searchPlaces(clean, biasCenter ? { center: biasCenter, radius: 25000 } : undefined);
  for (const c of primaryResults) {
    if (c.id && !seenIds.has(c.id)) {
      seenIds.add(c.id);
      allCandidates.push(c);
    }
  }

  // If cleanPlaceName differs from clean (e.g. locality separated), also search cleanPlaceName
  if (cleanPlaceName !== clean && allCandidates.length < 4) {
    const nameResults = await searchPlaces(cleanPlaceName, biasCenter ? { center: biasCenter, radius: 25000 } : undefined);
    for (const c of nameResults) {
      if (c.id && !seenIds.has(c.id)) {
        seenIds.add(c.id);
        allCandidates.push(c);
      }
    }
  }

  // If primary query yielded few or no results and we have an English/canonical variant, search variant
  if (allCandidates.length < 2 && variants.length > 1) {
    for (const v of variants.slice(1, 3)) {
      if (v === clean) continue;
      const variantQuery = localityContext ? `${v} in ${localityContext}` : v;
      const variantResults = await searchPlaces(variantQuery, biasCenter ? { center: biasCenter, radius: 25000 } : undefined);
      for (const c of variantResults) {
        if (c.id && !seenIds.has(c.id)) {
          seenIds.add(c.id);
          allCandidates.push(c);
        }
      }
    }
  }

  // Retry without bias if biased search found nothing
  if (allCandidates.length === 0 && biasCenter) {
    const globalResults = await searchPlaces(clean);
    for (const c of globalResults) {
      if (c.id && !seenIds.has(c.id)) {
        seenIds.add(c.id);
        allCandidates.push(c);
      }
    }
  }

  if (allCandidates.length === 0) {
    return {
      status: 'not_found',
      waypoint: null,
      candidates: [],
      confidenceScore: 0,
      clarificationMessage: `Could not find any location matching "${clean}".`,
    };
  }

  const scored = allCandidates
    .map((c) => ({
      candidate: c,
      score: scoreCandidatePlace(clean, c),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const secondBest = scored[1];

  // If top candidate is below confidence threshold (0.60), do NOT create a fake waypoint!
  if (!best || best.score < 0.60 || !best.candidate.latLng) {
    console.warn(`[PlacesService] No confident match for "${clean}". Top score was: ${best?.score || 0}`);
    return {
      status: 'not_found',
      waypoint: null,
      candidates: scored.map((s) => ({ ...s.candidate, confidenceScore: s.score })),
      confidenceScore: best?.score || 0,
      clarificationMessage: `No confident match found for "${clean}". Please specify a more detailed location.`,
    };
  }

  // Ambiguity check:
  // Detect if top multiple candidates represent genuinely distinct options of similar prominence
  // e.g. "Radisson Blu Delhi" -> Plaza Airport vs Paschim Vihar vs Dwarka
  const highConfidenceCandidates = scored.filter((s) => s.score >= 0.70);
  const isAmbiguousChainOrBrand =
    secondBest &&
    highConfidenceCandidates.length >= 2 &&
    (
      (secondBest.score > 0.75 && best.score - secondBest.score < 0.12 && best.candidate.name.toLowerCase() !== secondBest.candidate.name.toLowerCase()) ||
      (best.candidate.name.toLowerCase().includes('radisson') && secondBest.candidate.name.toLowerCase().includes('radisson'))
    );

  if (isAmbiguousChainOrBrand) {
    const topChoices = highConfidenceCandidates.slice(0, 3).map((s, idx) => ({
      index: idx + 1,
      id: s.candidate.id || `place-${idx}`,
      name: s.candidate.name,
      address: s.candidate.address,
      latLng: s.candidate.latLng,
      category: category || s.candidate.category || 'custom',
      confidenceScore: s.score,
    }));

    return {
      status: 'ambiguous',
      waypoint: {
        id: best.candidate.id || `place-${Date.now()}`,
        placeId: best.candidate.id,
        name: best.candidate.name,
        address: best.candidate.address,
        latLng: best.candidate.latLng,
        category: category || best.candidate.category || 'custom',
      },
      candidates: topChoices,
      confidenceScore: best.score,
      clarificationMessage: `Found multiple matching locations: ${topChoices.map((c) => `${c.index}) ${c.name} (${c.address})`).join(', ')}. Which one do you mean?`,
    };
  }

  return {
    status: 'resolved',
    waypoint: {
      id: best.candidate.id || `place-${Date.now()}`,
      placeId: best.candidate.id,
      name: best.candidate.name,
      address: best.candidate.address,
      latLng: best.candidate.latLng,
      category: category || best.candidate.category || 'custom',
    },
    candidates: scored.map((s) => ({ ...s.candidate, confidenceScore: s.score })),
    confidenceScore: best.score,
  };
}

export async function resolvePlaceToWaypoint(
  query: string,
  biasCenter?: LatLng,
  category?: any
): Promise<Waypoint | null> {
  const result = await resolvePlaceDetailed(query, biasCenter, category);
  return result.waypoint;
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
