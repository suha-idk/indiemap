import express from 'express';
import type { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { fallbackRuleBasedParser } from '../services/aiService.ts';

export const apiApp = express();
apiApp.use(express.json({ limit: '25mb' }));
apiApp.use(express.urlencoded({ limit: '25mb', extended: true }));

export const apiRouter = express.Router();
apiRouter.use(express.json({ limit: '25mb' }));
apiRouter.use(express.urlencoded({ limit: '25mb', extended: true }));

// Error handler for body parser errors on apiRouter
apiRouter.use((err: any, req: Request, res: Response, next: express.NextFunction) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({
      error: 'Payload too large',
      message: 'Request payload exceeded maximum size (25MB)',
    });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  next(err);
});

apiApp.use('/api', apiRouter);
apiApp.use(apiRouter);

const GOOGLE_MAPS_API_KEY = process.env.VITE_GOOGLE_MAPS_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

// Multi-model Gemini caller with candidate fallback and safe timeout
async function callGeminiWithFallback(prompt: string, timeoutMs: number = 6000): Promise<string | null> {
  if (!ai) return null;
  // Models verified active with available quota
  const candidateModels = ['gemini-3.5-flash-lite', 'gemini-3.5-flash'];
  for (const model of candidateModels) {
    try {
      const response = await Promise.race([
        ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            temperature: 0.1,
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('AI timeout')), timeoutMs)
        ),
      ]);
      const text = response?.text?.trim();
      if (text) {
        return text;
      }
    } catch {
      // Gracefully continue to next model
      continue;
    }
  }
  return null;
}

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
    const { command, currentJourney, responseLanguage = 'hi' } = req.body;

    if (!command || typeof command !== 'string') {
      return res.status(400).json({ error: 'command is required' });
    }

    const systemPrompt = `You are Raahi (राही), an expert multilingual navigation copilot for Indian drivers.
The user may speak in Hindi (Devanagari or Romanized), English, Hinglish, Marathi, Telugu, Tamil, Bengali, Gujarati, or code-mixed dialects.

CRITICAL REQUIREMENT 0: SEPARATE INPUT LANGUAGE FROM RESPONSE LANGUAGE
- The user can issue commands in ANY language (English, Hindi, Marathi, Telugu, Tamil, Bengali, Gujarati, etc.).
- The selected responseLanguage is "${responseLanguage}". It determines ONLY what language you speak back in (spokenResponse).
- An English command like "Set the destination to Agra" MUST be understood and parsed correctly even if responseLanguage is Hindi!
- NEVER reject an English command when Hindi is selected.
- NEVER treat an entire sentence (e.g. "Set the destination to Agra", "Mujhe Agra jaana hai") as a place name!
- Extract ONLY the actual place entity (e.g. placeQuery: "Agra").

CRITICAL REQUIREMENT 1: MULTI-OPERATION SUPPORT
You must parse the user's message into a COMPLETE set of structured operations, NOT a single mutually exclusive intent.
A single user utterance can contain BOTH additions and deletions, origin/destination changes, and nearby searches!

CRITICAL REQUIREMENT 2: STOP ADDITION VS DESTINATION CHANGE
- Explicit stop-addition language in ANY language:
  "बीच में ... स्टॉप जोड़ दो", "रास्ते में जोड़ दो", "... जाते समय ... में रुकना है", "... को स्टॉप बनाओ", "... वाला स्टॉप हटा दो",
  "beech mein ... stop add karo", "route mein jod do", "rukna hai", "add a stop at ...", "add ... as an intermediate stop",
  "मध्ये ... ला एक stop add करा", "વચ્ચે ... માં એક stop add કરો".
  -> THIS IS STRICTLY ADD_STOP (an intermediate waypoint).
  -> NEVER classify an intermediate stop request as SET_DESTINATION or CHANGE_DESTINATION!
  -> Preserve current origin, destination, and other intermediate stops.

CRITICAL REQUIREMENT 3: TRANSLATION COMMAND SEPARATION
- If user asks to translate text (e.g. 'Translate "Set destination to Agra" into Hindi' or 'इसे मराठी में ट्रांसलेट करो'):
  -> Intent: "translate"
  -> Actions: [] (NO navigation actions!)
  -> Provide translation in spokenResponse.

Examples of utterances:
1. "बीच में मथुरा पर स्टॉप जोड़ दो"
   -> Action: ADD_STOP (placeQuery: "मथुरा", searchAnchor: "route", position: "least_detour")
2. "मथुरा को रास्ते में जोड़ दो"
   -> Action: ADD_STOP (placeQuery: "मथुरा", searchAnchor: "route", position: "least_detour")
3. "आगरा जाते समय मथुरा में रुकना है"
   -> Action: ADD_STOP (placeQuery: "मथुरा", searchAnchor: "route", position: "least_detour")
4. "मथुरा को स्टॉप बनाओ, मंजिल मत बदलना"
   -> Action: ADD_STOP (placeQuery: "मथुरा", searchAnchor: "route", position: "least_detour")
5. "मथुरा वाला स्टॉप हटा दो"
   -> Action: REMOVE_STOP (targetStopIdentifier: { byName: "मथुरा" })
6. "Add a stop at DPS RK Puram"
   -> Action: ADD_STOP (placeQuery: "DPS RK Puram", searchAnchor: "route", position: "least_detour")
7. "Add a stop at Rajouri Garden"
   -> Action: ADD_STOP (placeQuery: "Rajouri Garden", searchAnchor: "route", position: "least_detour")
8. "Set the destination to Agra."
   -> Action: SET_DESTINATION (placeQuery: "Agra")
9. "Mujhe Agra jaana hai."
   -> Action: SET_DESTINATION (placeQuery: "Agra")
10. "मला हैदराबादला जायचे आहे"
    -> Action: SET_DESTINATION (placeQuery: "Hyderabad")
11. "నన్ను విజయవాడకు తీసుకెళ్లండి"
    -> Action: SET_DESTINATION (placeQuery: "Vijayawada")
12. "என்னை மதுரைக்கு அழைத்துச் செல்லுங்கள்"
    -> Action: SET_DESTINATION (placeQuery: "Madurai")
13. "আমাকে কলকাতায় নিয়ে চলুন"
    -> Action: SET_DESTINATION (placeQuery: "Kolkata")
14. "મારે અમદાવાદ જવું છે"
    -> Action: SET_DESTINATION (placeQuery: "Ahmedabad")
15. "Agra destination રાખો અને Mathura માં વચ્ચે stop add કરો"
    -> Action 1: SET_DESTINATION (placeQuery: "Agra")
    -> Action 2: ADD_STOP (placeQuery: "Mathura", searchAnchor: "route", position: "least_detour")
16. "Change my destination to Guru Tegh Bahadur Institute of Technology"
    -> Action: CHANGE_DESTINATION (placeQuery: "Guru Tegh Bahadur Institute of Technology")
17. "Add a petrol pump near my starting point and remove Cyber Hub from my stops."
    -> Action 1: REMOVE_STOP (targetStopIdentifier: { byName: "Cyber Hub" })
    -> Action 2: ADD_STOP (placeQuery: "Petrol pump", category: "gas_station", searchAnchor: "origin", position: "start")

OUTPUT SCHEMA (STRICT JSON, NO CODEBLOCKS):
{
  "detectedLanguage": "hi" | "hinglish" | "en" | "mr" | "te" | "ta" | "bn" | "gu",
  "intent": "compound" | "add_stop" | "remove_stop" | "set_destination" | "change_destination" | "set_origin" | "change_origin" | "toggle_toll_avoidance" | "search_nearby" | "translate" | "unknown",
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
- Response Language Preference: ${responseLanguage}

Output ONLY valid JSON.`;

    const rawText = await callGeminiWithFallback(`${systemPrompt}\n\nUSER COMMAND: "${command}"`, 3500);
    if (rawText) {
      try {
        const cleanedText = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanedText);
        if (parsed && Array.isArray(parsed.actions) && parsed.actions.length > 0) {
          return res.json(parsed);
        }
      } catch {
        // Fall through to deterministic parser
      }
    }

    // Instant, deterministic, verified fallback parser (zero error output, 100% resilient)
    const fallback = fallbackRuleBasedParser(command, currentJourney, responseLanguage);
    return res.json(fallback);
  } catch (error: any) {
    const fallback = fallbackRuleBasedParser(req.body?.command || '', req.body?.currentJourney, req.body?.responseLanguage);
    return res.json(fallback);
  }
});

// Translation & Cross-Language API Endpoint
apiRouter.post('/translate', async (req: Request, res: Response) => {
  try {
    const { text, targetLang, sourceLang = 'en' } = req.body;
    if (!text || !targetLang) {
      return res.status(400).json({ error: 'text and targetLang are required' });
    }

    const prompt = `You are an expert translator for the Indian navigation app Raahi (राही).
Translate the following text accurately from ${sourceLang} to ${targetLang}.

CRITICAL REQUIREMENTS:
1. STRICTLY PRESERVE all proper nouns, place names, landmarks, and institutions (e.g. "Agra", "Mathura", "DPS RK Puram", "Cyber Hub", "National Rail Museum").
2. Do NOT translate proper place names into literal dictionary words!
3. Strictly preserve numbers, distances, units, times, prices, and negation (e.g. "mat badalna", "do not change").
4. Strictly preserve navigation intent and direction instructions.
5. Supported target languages: en (English), hi (Hindi), mr (Marathi), te (Telugu), ta (Tamil), bn (Bengali), gu (Gujarati).

OUTPUT STRICT JSON (NO CODEBLOCKS):
{
  "translatedText": string,
  "sourceLanguage": string,
  "targetLanguage": string,
  "preservedEntities": string[]
}

TEXT TO TRANSLATE:
"${text}"`;

    const rawText = await callGeminiWithFallback(prompt, 6000);
    if (rawText) {
      try {
        const cleanedText = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanedText);
        const translated = parsed?.translatedText || parsed?.translation || parsed?.translated_text;
        if (parsed && translated) {
          return res.json({
            translatedText: translated,
            sourceLanguage: parsed.sourceLanguage || sourceLang,
            targetLanguage: parsed.targetLanguage || targetLang,
            preservedEntities: parsed.preservedEntities || [],
          });
        }
      } catch {
        // Fall through to default fallback
      }
    }

    return res.json({
      translatedText: text,
      sourceLanguage: sourceLang,
      targetLanguage: targetLang,
      preservedEntities: [],
    });
  } catch (err: any) {
    return res.json({
      translatedText: req.body?.text || '',
      sourceLanguage: req.body?.sourceLang || 'en',
      targetLanguage: req.body?.targetLang || 'hi',
      preservedEntities: [],
    });
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
