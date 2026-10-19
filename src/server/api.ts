import express from 'express';
import type { Request, Response } from 'express';

export const apiApp = express();
apiApp.use(express.json());

export const apiRouter = express.Router();
apiRouter.use(express.json());
apiApp.use('/api', apiRouter);
apiApp.use(apiRouter);

const GOOGLE_MAPS_API_KEY = process.env.VITE_GOOGLE_MAPS_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// In-memory route cache: key -> { data, timestamp }
const routeCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getRouteCacheKey(
  origin: any,
  destination: any,
  intermediates: any[],
  travelMode: string,
  avoidTolls: boolean,
  avoidHighways: boolean
): string {
  const getWpKey = (wp: any) => {
    if (!wp) return 'null';
    if (wp.latLng && typeof wp.latLng.lat === 'number') {
      return `${wp.latLng.lat.toFixed(4)},${wp.latLng.lng.toFixed(4)}`;
    }
    return wp.placeId || wp.address || wp.name || '';
  };

  const org = getWpKey(origin);
  const dest = getWpKey(destination);
  const stops = (intermediates || []).map(getWpKey).join('|');
  return `${travelMode}_tolls${avoidTolls}_hwy${avoidHighways}_${org}->${stops}->${dest}`;
}

export const formatWaypointForRoute = (wp: any) => {
  if (wp.latLng && typeof wp.latLng.lat === 'number' && typeof wp.latLng.lng === 'number') {
    return {
      location: {
        latLng: {
          latitude: wp.latLng.lat,
          longitude: wp.latLng.lng,
        },
      },
    };
  }
  if (wp.placeId) {
    return { placeId: wp.placeId };
  }
  return { address: wp.address || wp.name };
};

// 1. Google Routes API v2
apiRouter.post('/routes', async (req: Request, res: Response) => {
  try {
    const { origin, destination, intermediates = [], travelMode = 'DRIVE', routeModifiers = {} } = req.body;

    if (!origin || !destination) {
      return res.status(400).json({ error: 'Origin and destination are required' });
    }

    const mode = travelMode === 'TWO_WHEELER' ? 'TWO_WHEELER' : 'DRIVE';
    const avoidTolls = Boolean(routeModifiers.avoidTolls);
    const avoidHighways = Boolean(routeModifiers.avoidHighways);

    // Check cache
    const cacheKey = getRouteCacheKey(origin, destination, intermediates, mode, avoidTolls, avoidHighways);
    const cached = routeCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return res.json(cached.data);
    }

    // Build payload preserving exact driver waypoint sequence (NEVER optimize waypoint order)
    const buildPayload = (useTrafficPreference: boolean) => {
      const payload: any = {
        origin: formatWaypointForRoute(origin),
        destination: formatWaypointForRoute(destination),
        travelMode: mode,
        routeModifiers: {
          avoidTolls,
          avoidHighways,
        },
      };

      if (useTrafficPreference) {
        payload.routingPreference = 'TRAFFIC_AWARE';
      }

      if (intermediates && intermediates.length > 0) {
        payload.intermediates = intermediates.map((wp: any) => formatWaypointForRoute(wp));
      }
      return payload;
    };

    const callRoutesAPI = async (payload: any) => {
      return fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
          'X-Goog-FieldMask':
            'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.description,routes.viewport,routes.legs',
          'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
        },
        body: JSON.stringify(payload),
      });
    };

    // Primary attempt with traffic aware
    let response = await callRoutesAPI(buildPayload(true));
    let data = await response.json();

    // If TWO_WHEELER or specific region rejects TRAFFIC_AWARE, fallback without routingPreference
    if (!response.ok && data.error?.message?.includes('routingPreference')) {
      response = await callRoutesAPI(buildPayload(false));
      data = await response.json();
    }

    // If placeId coordinate snapping fails, fallback with address format
    if (response.ok && (!data.routes || data.routes.length === 0)) {
      const fallbackPayload: any = {
        origin: { address: origin.address || origin.name },
        destination: { address: destination.address || destination.name },
        travelMode: mode,
        routeModifiers: { avoidTolls, avoidHighways },
      };
      if (mode === 'DRIVE') {
        fallbackPayload.routingPreference = 'TRAFFIC_AWARE';
      }
      if (intermediates && intermediates.length > 0) {
        fallbackPayload.intermediates = intermediates.map((s: any) => ({ address: s.address || s.name }));
      }
      const fallbackRes = await callRoutesAPI(fallbackPayload);
      const fallbackData = await fallbackRes.json();
      if (fallbackRes.ok && fallbackData.routes && fallbackData.routes.length > 0) {
        response = fallbackRes;
        data = fallbackData;
      }
    }

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    if (data.routes && data.routes.length > 0) {
      routeCache.set(cacheKey, { data, timestamp: Date.now() });
    }

    return res.json(data);
  } catch (error: any) {
    console.warn('Routes API compute error:', error?.message || 'Unknown error');
    return res.status(500).json({ error: error.message || 'Failed to compute route' });
  }
});

// 2. Google Places API (New) - Text Search
apiRouter.post('/places/search', async (req: Request, res: Response) => {
  try {
    const { textQuery, locationBias, maxResultCount = 8 } = req.body;

    if (!textQuery) {
      return res.status(400).json({ error: 'textQuery is required' });
    }

    const payload: any = {
      textQuery,
      maxResultCount: Math.min(maxResultCount, 15),
      languageCode: 'en-IN',
    };

    if (locationBias?.center) {
      payload.locationBias = {
        circle: {
          center: {
            latitude: locationBias.center.lat,
            longitude: locationBias.center.lng,
          },
          radius: locationBias.radius || 15000,
        },
      };
    }

    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.currentOpeningHours,places.primaryType,places.types',
        'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error: any) {
    console.warn('Places API search error:', error?.message || 'Unknown error');
    return res.status(500).json({ error: error.message || 'Places search failed' });
  }
});

// 3. Google Places API (New) - Nearby Search
apiRouter.post('/places/nearby', async (req: Request, res: Response) => {
  try {
    const { center, radius = 10000, includedTypes = ['gas_station'], maxResultCount = 10 } = req.body;

    if (!center || typeof center.lat !== 'number' || typeof center.lng !== 'number') {
      return res.status(400).json({ error: 'center { lat, lng } is required' });
    }

    const payload = {
      includedTypes,
      maxResultCount: Math.min(maxResultCount, 15),
      locationRestriction: {
        circle: {
          center: {
            latitude: center.lat,
            longitude: center.lng,
          },
          radius,
        },
      },
      languageCode: 'en-IN',
    };

    const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.currentOpeningHours,places.primaryType,places.types',
        'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error: any) {
    console.warn('Places API nearby error:', error?.message || 'Unknown error');
    return res.status(500).json({ error: error.message || 'Nearby search failed' });
  }
});

// 4. Gemini Multilingual Voice / Text Command Interpretation
apiRouter.post('/interpret', async (req: Request, res: Response) => {
  try {
    const { command, currentJourney } = req.body;

    if (!command || typeof command !== 'string') {
      return res.status(400).json({ error: 'command is required' });
    }

    const systemPrompt = `You are Raahi (राही), an expert voice navigation assistant for Indian drivers, cabbies, and delivery partners.
The user may speak in Hindi (Devanagari or Romanized), English, Hinglish, Marathi, Telugu, Tamil, Bengali, Kannada, or mixed Indian dialects.

CRITICAL REQUIREMENT 1: MULTI-OPERATION SUPPORT
You must parse the user's message into a COMPLETE set of structured operations, NOT a single mutually exclusive intent.
A single user utterance can contain BOTH additions and deletions, origin/destination changes, and nearby searches!

CRITICAL REQUIREMENT 2: STOP ADDITION VS DESTINATION CHANGE
- Explicit stop-addition language in Hindi/Hinglish/English:
  "बीच में ... स्टॉप जोड़ दो", "रास्ते में जोड़ दो", "... जाते समय ... में रुकना है", "... को स्टॉप बनाओ", "... वाला स्टॉप हटा दो",
  "beech mein ... stop add karo", "route mein jod do", "rukna hai", "add a stop at ...", "add ... as an intermediate stop".
  -> THIS IS STRICTLY ADD_STOP (an intermediate waypoint).
  -> NEVER classify an intermediate stop request as SET_DESTINATION or CHANGE_DESTINATION!
  -> Do NOT infer a destination change from a place name alone when the user is clearly requesting an intermediate stop.
  -> Preserve current origin, destination, and other intermediate stops.

Examples of utterances:
1. "बीच में मथुरा पर स्टॉप जोड़ दो"
   -> Action: ADD_STOP (placeQuery: "मथुरा", searchAnchor: "route", position: "least_detour")
2. "मथुरा को रास्ते में जोड़ दो"
   -> Action: ADD_STOP (placeQuery: "मथुरा", searchAnchor: "route", position: "least_detour")
3. "आगरा जाते समय मथुरा में रुकना है"
   -> Action: ADD_STOP (placeQuery: "मथुरा", searchAnchor: "route", position: "least_detour")
4. "मथुरा को स्टॉप बनाओ, मंजिल मत बदलना"
   -> Action: ADD_STOP (placeQuery: "मथुरा", searchAnchor: "route", position: "least_detour")
   (NO destination change!)
5. "मथुरा वाला स्टॉप हटा दो"
   -> Action: REMOVE_STOP (targetStopIdentifier: { byName: "मथुरा" })
6. "Add a stop at DPS RK Puram"
   -> Action: ADD_STOP (placeQuery: "DPS RK Puram", searchAnchor: "route", position: "least_detour")
7. "Add a stop at Rajouri Garden"
   -> Action: ADD_STOP (placeQuery: "Rajouri Garden", searchAnchor: "route", position: "least_detour")
8. "Keep my destination unchanged and add Rajouri Garden as a stop"
   -> Action: ADD_STOP (placeQuery: "Rajouri Garden", searchAnchor: "route", position: "least_detour")
9. "Change my destination to Mathura"
   -> Action: CHANGE_DESTINATION (placeQuery: "Mathura")
10. "Add a petrol pump near my starting point and remove Cyber Hub from my stops."
    -> Action 1: REMOVE_STOP (targetStopIdentifier: { byName: "Cyber Hub" })
    -> Action 2: ADD_STOP (placeQuery: "Petrol pump", category: "gas_station", searchAnchor: "origin", position: "start")
11. "Jim Corbett jaana hai, beech mein ek CNG station add karo aur Dhaula Kuan hata do."
    -> Action 1: REMOVE_STOP (targetStopIdentifier: { byName: "Dhaula Kuan" })
    -> Action 2: ADD_STOP (placeQuery: "CNG station", category: "cng_station", searchAnchor: "route", position: "least_detour")
    -> Action 3: SET_DESTINATION (placeQuery: "Jim Corbett")
12. "Remove the second stop, add a tea stall near the origin, and keep my final destination unchanged."
    -> Action 1: REMOVE_STOP (targetStopIdentifier: { byOrdinal: 2 })
    -> Action 2: ADD_STOP (placeQuery: "Tea stall", category: "restaurant", searchAnchor: "origin", position: "start")
13. "Cyber Hub hatao aur origin ke paas petrol pump add karo."
    -> Action 1: REMOVE_STOP (targetStopIdentifier: { byName: "Cyber Hub" })
    -> Action 2: ADD_STOP (placeQuery: "Petrol pump", category: "gas_station", searchAnchor: "origin", position: "start")
14. "Add a CNG station near the start, remove the petrol pump already in my route, and add a tea stop before my destination."
    -> Action 1: REMOVE_STOP (category: "gas_station", targetStopIdentifier: { byName: "petrol pump" })
    -> Action 2: ADD_STOP (placeQuery: "CNG station", category: "cng_station", searchAnchor: "origin", position: "start")
    -> Action 3: ADD_STOP (placeQuery: "Tea stall", category: "restaurant", searchAnchor: "destination", position: "before", relativeTo: "destination")

RULES:
- When the user asks to remove a stop (e.g. "Cyber Hub hata do"), NEVER delete or change the destination. Intermediate stops and destination are separate!
- If the user specifies "keep destination unchanged" or "मंजिल मत बदलना", DO NOT output any SET_DESTINATION action.
- Routine additions and deletions must have requiresConfirmation: false so they execute immediately without frustrating the driver.
- Set requiresConfirmation: true ONLY if user explicitly asks to clear the entire journey ("clear journey", "reset journey").
- Ensure placeQuery is clean: strip boilerplate like "a stop at" or "stop at" or "intermediate stop".

OUTPUT SCHEMA (STRICT JSON, NO CODEBLOCKS):
{
  "detectedLanguage": "hi" | "hinglish" | "en" | "mr" | "te" | "ta" | "bn",
  "intent": "compound" | "add_stop" | "remove_stop" | "set_destination" | "change_destination" | "set_origin" | "change_origin" | "toggle_toll_avoidance" | "search_nearby" | "unknown",
  "actions": [
    {
      "type": "REMOVE_STOP" | "ADD_STOP" | "SET_DESTINATION" | "CHANGE_DESTINATION" | "SET_ORIGIN" | "CHANGE_ORIGIN" | "CLEAR_STOPS" | "CLEAR_JOURNEY" | "TOGGLE_TOLLS" | "SET_TRAVEL_MODE",
      "placeQuery": string,
      "category": "gas_station" | "cng_station" | "restaurant" | "hospital" | "pharmacy" | "parking" | "ev_charging",
      "searchAnchor": "origin" | "destination" | "current_location" | "route" | "stop",
      "anchorStopName": string,
      "position": "start" | "end" | "before" | "after" | "least_detour",
      "relativeTo": string | number,
      "targetStopIdentifier": {
        "byOrdinal": number,
        "byName": string
      },
      "avoidTolls": boolean,
      "travelMode": "DRIVE" | "TWO_WHEELER"
    }
  ],
  "requiresConfirmation": false,
  "spokenResponse": string
}

CURRENT JOURNEY CONTEXT:
- Origin: ${JSON.stringify(currentJourney?.origin || 'None')}
- Destination: ${JSON.stringify(currentJourney?.destination || 'None')}
- Current Stops: ${JSON.stringify(currentJourney?.stops?.map((s: any, idx: number) => ({ ordinal: idx + 1, name: s.name, address: s.address, category: s.category })) || [])}
- Travel Mode: ${currentJourney?.travelMode || 'DRIVE'}

Output ONLY valid JSON.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);

    let aiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: `${systemPrompt}\n\nUSER COMMAND: "${command}"` }],
            },
          ],
        }),
      }
    ).finally(() => clearTimeout(timeout));

    if (!aiRes.ok) {
      // Fallback model
      aiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: `${systemPrompt}\n\nUSER COMMAND: "${command}"` }],
              },
            ],
          }),
        }
      );
    }

    const aiData = await aiRes.json();
    if (!aiRes.ok) {
      console.warn('Gemini returned non-ok, falling back to rule-based parser:', aiData);
      return res.status(aiRes.status).json(aiData);
    }

    const rawText = aiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const cleanedText = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanedText);

    return res.json(parsed);
  } catch (error: any) {
    console.warn('Interpret API error (falling back to local engine):', error?.message || 'Unknown error');
    return res.status(500).json({ error: error.message || 'Interpretation failed' });
  }
});

// 5. Route-Aware Detour Ranking
apiRouter.post('/detour-rank', async (req: Request, res: Response) => {
  try {
    const {
      origin,
      destination,
      currentStops = [],
      candidates = [],
      travelMode = 'DRIVE',
      anchorType = 'route',
      suggestedInsertIndex,
    } = req.body;

    if (!origin || !destination || candidates.length === 0) {
      return res.status(400).json({ error: 'Origin, destination, and candidates are required' });
    }

    const mode = travelMode === 'TWO_WHEELER' ? 'TWO_WHEELER' : 'DRIVE';

    // Step A: Calculate baseline route distance & duration
    const baselineRes = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
        'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
      },
      body: JSON.stringify({
        origin: formatWaypointForRoute(origin),
        destination: formatWaypointForRoute(destination),
        intermediates: currentStops.map((s: any) => formatWaypointForRoute(s)),
        travelMode: mode,
      }),
    });

    const baselineData = await baselineRes.json();
    const baselineRoute = baselineData.routes?.[0];
    const baseDistanceMeters = baselineRoute?.distanceMeters || 0;
    const baseDurationSeconds = parseInt(baselineRoute?.duration?.replace('s', '') || '0', 10);

    // Step B: Evaluate candidates
    const candidatesToScore = candidates.slice(0, 6);
    const scoredCandidates = await Promise.all(
      candidatesToScore.map(async (candidate: any) => {
        try {
          const candWp = candidate.location
            ? { location: { latLng: { latitude: candidate.location.latitude, longitude: candidate.location.longitude } } }
            : candidate.placeId
            ? { placeId: candidate.placeId }
            : { address: candidate.formattedAddress || candidate.displayName?.text };

          // Determine insertion index based on anchor:
          let insertIdx = currentStops.length;
          if (anchorType === 'origin') {
            insertIdx = 0;
          } else if (anchorType === 'destination') {
            insertIdx = currentStops.length;
          } else if (typeof suggestedInsertIndex === 'number' && suggestedInsertIndex >= 0) {
            insertIdx = Math.min(suggestedInsertIndex, currentStops.length);
          }

          const newIntermediates = [...currentStops.map((s: any) => formatWaypointForRoute(s))];
          newIntermediates.splice(insertIdx, 0, candWp);

          const candRes = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
              'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
              'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
            },
            body: JSON.stringify({
              origin: formatWaypointForRoute(origin),
              destination: formatWaypointForRoute(destination),
              intermediates: newIntermediates,
              travelMode: mode,
            }),
          });

          const candData = await candRes.json();
          const candRoute = candData.routes?.[0];
          const candDistanceMeters = candRoute?.distanceMeters || baseDistanceMeters;
          const candDurationSeconds = parseInt(candRoute?.duration?.replace('s', '') || `${baseDurationSeconds}`, 10);

          const detourMeters = Math.max(0, candDistanceMeters - baseDistanceMeters);
          const detourSeconds = Math.max(0, candDurationSeconds - baseDurationSeconds);

          // Calculate proximity penalty to anchor
          let anchorProximityPenalty = 0;
          if (anchorType === 'origin' && origin.latLng && candidate.location) {
            const dLat = (candidate.location.latitude - origin.latLng.lat) * 111000;
            const dLng = (candidate.location.longitude - origin.latLng.lng) * 111000 * Math.cos(origin.latLng.lat * (Math.PI / 180));
            anchorProximityPenalty = Math.sqrt(dLat * dLat + dLng * dLng) * 0.8;
          }

          return {
            ...candidate,
            detourMeters,
            detourKm: (detourMeters / 1000).toFixed(1),
            detourMinutes: Math.round(detourSeconds / 60),
            totalDurationMinutes: Math.round(candDurationSeconds / 60),
            score: detourMeters + detourSeconds * 5 + anchorProximityPenalty,
            bestInsertIndex: insertIdx,
          };
        } catch {
          return {
            ...candidate,
            detourMeters: 999999,
            detourKm: 'unknown',
            detourMinutes: 99,
            score: 9999999,
            bestInsertIndex: currentStops.length,
          };
        }
      })
    );

    scoredCandidates.sort((a, b) => a.score - b.score);

    return res.json({
      baseline: {
        distanceMeters: baseDistanceMeters,
        durationSeconds: baseDurationSeconds,
      },
      rankedCandidates: scoredCandidates,
      bestCandidate: scoredCandidates[0] || null,
    });
  } catch (error: any) {
    console.warn('Detour ranking error:', error?.message || 'Unknown error');
    return res.status(500).json({ error: error.message || 'Detour ranking failed' });
  }
});
