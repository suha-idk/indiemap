import { CommandInterpretation, AtomicAction } from '../types/navigation';

export async function interpretCommand(
  command: string,
  currentJourney: any
): Promise<CommandInterpretation> {
  const clean = command.trim();
  if (!clean) {
    return {
      detectedLanguage: 'en',
      intent: 'unknown',
      actions: [],
      requiresConfirmation: false,
      spokenResponse: 'I did not hear a command. Please speak again.',
      clarificationNeeded: null,
    };
  }

  try {
    const res = await fetch('/api/interpret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: clean,
        currentJourney,
      }),
    });

    if (res.ok) {
      const data: CommandInterpretation = await res.json();
      if (data && Array.isArray(data.actions) && data.actions.length > 0) {
        return data;
      }
    }
  } catch (err) {
    console.warn('Backend interpret failed, using local rule-based engine:', err);
  }

  // Fallback Rule-Based Multilingual Engine for Instant Resilience
  return fallbackRuleBasedParser(clean, currentJourney);
}

export function fallbackRuleBasedParser(text: string, currentJourney: any): CommandInterpretation {
  const clean = text.trim();
  const lower = clean.toLowerCase();
  const actions: AtomicAction[] = [];
  let requiresConfirmation = false;
  let detectedLanguage = 'hi';

  // Language detection
  if (/[a-zA-Z]/.test(text) && !/(hai|karo|jaana|hatao|pehle|stop|cheyyi|kar do|beech|paas|jodo|manzil|rasta)/i.test(text)) {
    detectedLanguage = 'en';
  } else if (/cheyyi|pettandi|velli/i.test(lower)) {
    detectedLanguage = 'te';
  } else if (/kar|zala|sang/i.test(lower)) {
    detectedLanguage = 'mr';
  }

  // 1. Tolls toggle
  if (lower.includes('avoid toll') || lower.includes('toll avoid') || lower.includes('toll mat dikhana') || lower.includes('bina toll')) {
    actions.push({ type: 'TOGGLE_TOLLS', avoidTolls: true });
  } else if (lower.includes('allow toll') || lower.includes('toll le lo') || lower.includes('toll allow')) {
    actions.push({ type: 'TOGGLE_TOLLS', avoidTolls: false });
  }

  // 2. Travel Mode Switch
  if (lower.includes('bike mode') || lower.includes('two wheeler') || lower.includes('motorcycle') || lower.includes('bike se')) {
    actions.push({ type: 'SET_TRAVEL_MODE', travelMode: 'TWO_WHEELER' });
  } else if (lower.includes('car mode') || lower.includes('gaadi se') || lower.includes('drive mode') || lower.includes('car se')) {
    actions.push({ type: 'SET_TRAVEL_MODE', travelMode: 'DRIVE' });
  }

  // 3. Clear journey detection (high-impact -> requires confirmation)
  if (lower.includes('clear journey') || lower.includes('reset journey') || lower.includes('sara rasta hata do') || lower.includes('shuru se shuru karo')) {
    actions.push({ type: 'CLEAR_JOURNEY' });
    requiresConfirmation = true;
  }

  // 4. Ordinal Stop Removals (e.g. "remove the second stop", "doosra stop hata do", "remove 1st stop")
  const ordinalMatches = lower.matchAll(/(?:remove|delete|drop|hata do|hatao|nikal do)\s+(?:the\s+)?(pehla|first|1st|1|doosra|second|2nd|2|teesra|third|3rd|3)(?:\s*(?:stop|waala|stoppage))?/gi);
  for (const match of ordinalMatches) {
    const word = match[1].toLowerCase();
    let num = 1;
    if (word.includes('doosra') || word.includes('second') || word.includes('2')) num = 2;
    if (word.includes('teesra') || word.includes('third') || word.includes('3')) num = 3;

    if (!actions.some(a => a.type === 'REMOVE_STOP' && a.targetStopIdentifier?.byOrdinal === num)) {
      actions.push({
        type: 'REMOVE_STOP',
        targetStopIdentifier: { byOrdinal: num },
      });
    }
  }

  const reverseOrdinalMatches = lower.matchAll(/(pehla|first|1st|1|doosra|second|2nd|2|teesra|third|3rd|3)\s*(?:stop|waala|stoppage)?\s*(?:hatao|hata do|remove|delete|drop)/gi);
  for (const match of reverseOrdinalMatches) {
    const word = match[1].toLowerCase();
    let num = 1;
    if (word.includes('doosra') || word.includes('second') || word.includes('2')) num = 2;
    if (word.includes('teesra') || word.includes('third') || word.includes('3')) num = 3;

    if (!actions.some(a => a.type === 'REMOVE_STOP' && a.targetStopIdentifier?.byOrdinal === num)) {
      actions.push({
        type: 'REMOVE_STOP',
        targetStopIdentifier: { byOrdinal: num },
      });
    }
  }

  // 5. Category Stop Removals
  if (lower.match(/(?:remove|delete|hata do|hatao)\s+(?:the\s+)?(?:petrol pump|fuel station|gas station)/i) ||
      lower.match(/(?:petrol pump|gas station)\s+(?:already in my route\s+)?(?:hata do|hatao|remove|delete)/i)) {
    if (!actions.some(a => a.type === 'REMOVE_STOP' && a.targetStopIdentifier?.byName?.toLowerCase() === 'petrol pump')) {
      actions.push({
        type: 'REMOVE_STOP',
        category: 'gas_station',
        targetStopIdentifier: { byName: 'petrol pump' },
      });
    }
  }

  if (lower.match(/(?:remove|delete|hata do|hatao)\s+(?:the\s+)?(?:cng pump|cng station)/i) ||
      lower.match(/(?:cng pump|cng station)\s+(?:hata do|hatao|remove|delete)/i)) {
    if (!actions.some(a => a.type === 'REMOVE_STOP' && a.targetStopIdentifier?.byName?.toLowerCase() === 'cng station')) {
      actions.push({
        type: 'REMOVE_STOP',
        category: 'cng_station',
        targetStopIdentifier: { byName: 'cng station' },
      });
    }
  }

  // 6. Devanagari Hindi Stop Removals (e.g. "मथुरा वाला स्टॉप हटा दो", "Cyber Hub हटाओ", "Dhaula Kuan हटा दो")
  const hindiRemMatch =
    clean.match(/(.+?)\s*(?:वाला\s+|का\s+)?स्टॉप\s*(?:हटा दो|हटाओ|हटाएं|निकाल दो|कम करो|डिलीट करो)/) ||
    clean.match(/(?:हटा दो|हटाओ|हटाएं|निकाल दो)\s*(?:स्टॉप)?\s*(.+)/);
  if (hindiRemMatch && !/(?:मंजिल|destination|origin|start)/.test(hindiRemMatch[1])) {
    const q = hindiRemMatch[1].replace(/स्टॉप|वाला|का|को/g, '').trim();
    if (q && q.length > 1 && !actions.some(a => a.type === 'REMOVE_STOP' && a.targetStopIdentifier?.byName === q)) {
      actions.push({
        type: 'REMOVE_STOP',
        targetStopIdentifier: { byName: q },
      });
    }
  }

  // 7. Named Stop Removals per clause
  const rawClauses = clean.split(/[,;]|(?:\s+(?:and|aur|but|lekin|fir|aur fir)\s+)/i);
  for (const rawClause of rawClauses) {
    const cClean = rawClause.trim();
    if (!cClean) continue;
    if (/(?:remove|delete|drop|hata do|hatao|nikal do|nikalo)/i.test(cClean)) {
      if (/(?:petrol|cng|toll|the second|the first|the third|2nd|1st|3rd|doosra|pehla|teesra)\b/i.test(cClean)) {
        continue;
      }
      const match =
        cClean.match(/(?:remove|delete|drop|hata do|hatao|nikal do)\s+([^,]+?)(?:\s+(?:from my stops|from stops|from route|stop)|$)/i) ||
        cClean.match(/([^,]+?)\s*(?:ko\s*)?(?:hata do|hatao|nikal do|nikalo)/i);

      if (match) {
        let candidate = match[1]
          .replace(/from my stops|from stops|my stops|from route|stop|ko|aur|and/gi, '')
          .trim();
        if (
          candidate &&
          candidate.length > 2 &&
          !/(?:petrol|cng|toll|destination|origin|start|the second|the first|the third|2nd|1st|3rd|unchanged|doosra|pehla|teesra)/i.test(candidate)
        ) {
          if (!actions.some(a => a.type === 'REMOVE_STOP' && a.targetStopIdentifier?.byName?.toLowerCase() === candidate.toLowerCase())) {
            actions.push({
              type: 'REMOVE_STOP',
              targetStopIdentifier: { byName: candidate },
            });
          }
        }
      }
    }
  }

  // 8. Devanagari Hindi Stop Additions
  // e.g. "बीच में मथुरा पर स्टॉप जोड़ दो", "मथुरा को रास्ते में जोड़ दो", "आगरा जाते समय मथुरा में रुकना है", "मथुरा को स्टॉप बनाओ, मंजिल मत बदलना"
  const hindiAddMatch =
    clean.match(/बीच में\s+(.+?)\s+(?:पर|को|में)?\s*(?:स्टॉप)?\s*(?:जोड़ दो|जोड़ो|लगाओ|बनाओ|डालो|रखो)/) ||
    clean.match(/(.+?)\s+(?:को|में)?\s*रास्ते में\s*(?:स्टॉप)?\s*(?:जोड़ दो|जोड़ो|लगाओ|बनाओ|डालो)/) ||
    clean.match(/(?:.+?\s+जाते\s+(?:समय|हुए)\s+)?(.+?)\s+(?:में|पर)\s+रुकना\s+है/) ||
    clean.match(/(.+?)\s+(?:को)?\s*स्टॉप\s+(?:बनाओ|जोड़ो|जोड़ दो|लगाओ)/);

  if (hindiAddMatch) {
    const q = hindiAddMatch[1].replace(/बीच में|रास्ते में|स्टॉप|को|में|पर/g, '').trim();
    if (q && q.length > 1 && !actions.some(a => a.type === 'ADD_STOP' && a.placeQuery === q)) {
      actions.push({
        type: 'ADD_STOP',
        placeQuery: q,
        searchAnchor: 'route',
        position: 'least_detour',
      });
    }
  }

  // 9. Stop Additions per clause (English / Hinglish / Compound multi-additions)
  const clauses = clean.split(/[,;]|(?:\s+(?:and|aur|but|lekin|fir|aur fir)\s+)/i);
  for (const clause of clauses) {
    const cClean = clause.trim();
    const cLower = cClean.toLowerCase();
    if (!cClean) continue;

    const isRemovalClause = /hata|remove|delete|drop|nikal/i.test(cLower);
    const isTollClause = /toll/i.test(cLower) && !/toll pump/i.test(cLower);
    const isDestOnly = (cLower.includes('jaana hai') || cLower.includes('navigate to') || cLower.includes('take me to') || cLower.includes('destination')) &&
                       !cLower.includes('add') && !cLower.includes('jodo') && !cLower.includes('pump') && !cLower.includes('stall') && !cLower.includes('stop');

    if (isRemovalClause || isTollClause || isDestOnly) continue;

    const hasAddWord = /add|jodo|lagao|include|put|shamil|rukna|stop/i.test(cLower);
    const hasPetrol = /petrol|fuel|gas station/i.test(cLower);
    const hasCng = /cng/i.test(cLower);
    const hasFood = /tea|chai|dhaba|food|restaurant|khana|coffee/i.test(cLower);
    const hasHospital = /hospital|medical|doctor/i.test(cLower);

    if (hasAddWord || hasPetrol || hasCng || hasFood || hasHospital) {
      let searchAnchor: any = 'route';
      let position: any = 'least_detour';
      let relativeTo: any = undefined;

      if (/origin|start|starting point|shuruat|pehle/i.test(cLower)) {
        searchAnchor = 'origin';
        position = 'start';
      } else if (/destination|end point|manzil|end/i.test(cLower)) {
        searchAnchor = 'destination';
        position = cLower.includes('before') ? 'before' : 'end';
        if (position === 'before') {
          relativeTo = 'destination';
        }
      } else if (/near me|mere paas|aas-paas|current location/i.test(cLower)) {
        searchAnchor = 'current_location';
        position = 'start';
      }

      if (hasCng) {
        if (!actions.some(a => a.type === 'ADD_STOP' && a.category === 'cng_station' && a.searchAnchor === searchAnchor)) {
          actions.push({
            type: 'ADD_STOP',
            placeQuery: 'CNG Station',
            category: 'cng_station',
            searchAnchor,
            position,
            relativeTo,
          });
        }
      } else if (hasPetrol) {
        if (!actions.some(a => a.type === 'ADD_STOP' && a.category === 'gas_station' && a.searchAnchor === searchAnchor)) {
          actions.push({
            type: 'ADD_STOP',
            placeQuery: 'Petrol Pump',
            category: 'gas_station',
            searchAnchor,
            position,
            relativeTo,
          });
        }
      } else if (hasFood) {
        const foodLabel = /tea|chai/i.test(cLower) ? 'Tea Stall' : 'Dhaba Restaurant';
        if (!actions.some(a => a.type === 'ADD_STOP' && a.category === 'restaurant' && a.searchAnchor === searchAnchor)) {
          actions.push({
            type: 'ADD_STOP',
            placeQuery: foodLabel,
            category: 'restaurant',
            searchAnchor,
            position,
            relativeTo,
          });
        }
      } else if (hasHospital) {
        if (!actions.some(a => a.type === 'ADD_STOP' && a.category === 'hospital')) {
          actions.push({
            type: 'ADD_STOP',
            placeQuery: 'Hospital',
            category: 'hospital',
            searchAnchor,
            position,
          });
        }
      } else {
        // Named place addition e.g. "Add a stop at DPS RK Puram", "Add Mathura as an intermediate stop"
        const placeMatch =
          cClean.match(/(?:add\s+(?:an?\s+)?(?:intermediate\s+)?stop\s+(?:at|in|near)?\s*|add\s+)(.+?)(?:\s+(?:as\s+(?:an?\s+)?(?:intermediate\s+)?stop|to\s+(?:my\s+)?route|in\s+(?:my\s+)?route|ko\s+route\s+mein\s+jod\s+do|par\s+stop\s+add\s+kar\s+do)|$)/i) ||
          cClean.match(/(?:add|jodo|lagao)\s+([^,]+?)(?:\s+(?:to my route|near|at|stop)|$)/i);

        if (placeMatch) {
          let q = placeMatch[1]
            .replace(/^(?:a\s+stop\s+(?:at|in|near)\s+|stop\s+(?:at|in|near)\s+|at\s+|in\s+)/i, '')
            .replace(/(?:\s+as\s+(?:an?\s+)?(?:intermediate\s+)?stop|\s+as\s+a\s+stop|\s+to\s+my\s+route|\s+to\s+route|\s+in\s+route|\s+stop)$/i, '')
            .replace(/[.,;!?]+$/, '')
            .trim();

          if (q && q.length > 1 && !actions.some(a => a.type === 'ADD_STOP' && a.placeQuery?.toLowerCase() === q.toLowerCase())) {
            actions.push({
              type: 'ADD_STOP',
              placeQuery: q,
              searchAnchor,
              position,
            });
          }
        }
      }
    }
  }

  // 10. Destination Changes (Protected against stop addition confusion)
  const destinationUnchanged = lower.includes('destination unchanged') ||
                               lower.includes('keep my final destination unchanged') ||
                               lower.includes('destination change mat karna') ||
                               lower.includes('destination wahi rahega') ||
                               lower.includes('मंजिल मत बदलना') ||
                               lower.includes('destination same rakhna');

  if (!destinationUnchanged) {
    const destMatch =
      clean.match(/(?:take me to|navigate to|going to)\s+([^,]+?)(?:\s+(?:and|but|with|pehle|aur)|$)/i) ||
      clean.match(/([^,]+?)\s+(?:jaana hai|chalo|जाना है|चलो)/i) ||
      clean.match(/(?:destination|manzil|मंजिल)\s+(?:change karke|to|ko|करके)?\s*([^,]+?)(?:\s+(?:kar do|karo|कर दो|करो)|$)/i) ||
      clean.match(/change (?:my )?destination to\s+([^,]+?)(?:\s+(?:and|but)|$)/i);

    if (destMatch) {
      const rawDest = destMatch[1]
        .replace(/mujhe|hamko|humko|destination|change karke|kar do|set cheyyi|to|ko|par|करके|कर दो/gi, '')
        .replace(/[.,;!?]+$/, '')
        .trim();

      const isIntermediateKeyword = /beech mein|बीच में|रास्ते में|stop|स्टॉप|rukna|रुकना|petrol|cng|toll|unchanged/i.test(rawDest);

      if (rawDest && rawDest.length > 2 && !isIntermediateKeyword) {
        actions.push({
          type: currentJourney?.destination ? 'CHANGE_DESTINATION' : 'SET_DESTINATION',
          placeQuery: rawDest,
        });
      }
    }
  }

  // 11. Origin Changes
  const originUnchanged = lower.includes('origin unchanged') || lower.includes('keep origin unchanged');
  if (!originUnchanged) {
    if (lower.includes('start from') || lower.includes('se start') || lower.includes('origin change') || clean.includes('से शुरू')) {
      const placeMatch = clean.match(/(?:start from|se start karo|origin change karke|से शुरू करो)\s*([^,]+?)(?:\s+(?:and|aur|instead)|$)/i);
      if (placeMatch) {
        const place = placeMatch[1].replace(/se start karo|origin change karke|instead|से शुरू करो/gi, '').replace(/[.,;!?]+$/, '').trim();
        if (place && !actions.some(a => a.type === 'CHANGE_ORIGIN' || a.type === 'SET_ORIGIN')) {
          actions.push({
            type: 'CHANGE_ORIGIN',
            placeQuery: place,
          });
        }
      }
    }
  }

  // 12. Safeguard: If no action was detected
  if (actions.length === 0) {
    if (/stop|स्टॉप|रुकना|halt/i.test(clean)) {
      // User requested an ambiguous stop; create ADD_STOP or ask clarification rather than changing destination!
      const cleanedQuery = clean.replace(/stop|स्टॉप|रुकना|जोड़ दो|add|करो/gi, '').replace(/[.,;!?]+$/, '').trim();
      if (cleanedQuery.length > 1) {
        actions.push({
          type: 'ADD_STOP',
          placeQuery: cleanedQuery,
          searchAnchor: 'route',
          position: 'least_detour',
        });
      }
    } else if (!currentJourney?.destination) {
      actions.push({
        type: 'SET_DESTINATION',
        placeQuery: clean.replace(/[.,;!?]+$/, '').trim(),
      });
    }
  }

  const intent = actions.length > 1 ? 'compound' : actions[0]?.type?.toLowerCase() || 'unknown';

  // Build spoken acknowledgement explaining every applied operation
  const descParts: string[] = [];
  for (const act of actions) {
    if (act.type === 'REMOVE_STOP') {
      const target = act.targetStopIdentifier?.byOrdinal
        ? `stop #${act.targetStopIdentifier.byOrdinal}`
        : act.targetStopIdentifier?.byName || 'stop';
      descParts.push(detectedLanguage === 'en' ? `removed ${target}` : `${target} हटा दिया`);
    } else if (act.type === 'ADD_STOP') {
      const anchorDesc =
        act.searchAnchor === 'origin'
          ? (detectedLanguage === 'en' ? 'near origin' : 'origin ke paas')
          : act.searchAnchor === 'destination'
          ? (detectedLanguage === 'en' ? 'near destination' : 'destination ke paas')
          : (detectedLanguage === 'en' ? 'along route' : 'रास्ते में');
      descParts.push(detectedLanguage === 'en' ? `added ${act.placeQuery} (${anchorDesc})` : `${anchorDesc} ${act.placeQuery} जोड़ दिया`);
    } else if (act.type === 'SET_DESTINATION' || act.type === 'CHANGE_DESTINATION') {
      descParts.push(detectedLanguage === 'en' ? `destination set to ${act.placeQuery}` : `destination ${act.placeQuery} set kar diya`);
    } else if (act.type === 'SET_ORIGIN' || act.type === 'CHANGE_ORIGIN') {
      descParts.push(detectedLanguage === 'en' ? `origin set to ${act.placeQuery}` : `origin ${act.placeQuery} set kar diya`);
    } else if (act.type === 'SET_TRAVEL_MODE') {
      descParts.push(detectedLanguage === 'en' ? `travel mode set to ${act.travelMode}` : `${act.travelMode} mode on kar diya`);
    } else if (act.type === 'TOGGLE_TOLLS') {
      descParts.push(detectedLanguage === 'en' ? (act.avoidTolls ? 'avoiding tolls' : 'allowing tolls') : (act.avoidTolls ? 'toll avoid kar diya' : 'toll allow kar diya'));
    }
  }

  const spokenResponse =
    detectedLanguage === 'en'
      ? `Updated route: ${descParts.join(', ')}.`
      : `रास्ता अपडेट हो गया है: ${descParts.join(', ')}.`;

  return {
    detectedLanguage,
    intent,
    actions,
    requiresConfirmation,
    spokenResponse,
    clarificationNeeded: null,
  };
}
