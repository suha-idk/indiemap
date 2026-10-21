import { CommandInterpretation, AtomicAction } from '../types/navigation';
import { parseTranslationIntent, translateText, SupportedLanguage } from './translationService';

export async function interpretCommand(
  command: string,
  currentJourney: any,
  responseLanguage: string = 'hi'
): Promise<CommandInterpretation> {
  const clean = command.trim();
  if (!clean) {
    return {
      detectedLanguage: 'en',
      intent: 'unknown',
      actions: [],
      requiresConfirmation: false,
      spokenResponse: responseLanguage === 'hi' ? 'कोई कमांड सुनाई नहीं दी। कृपया फिर से बोलें।' : 'I did not hear a command. Please speak again.',
      clarificationNeeded: null,
    };
  }

  // Check if this is an explicit translation request
  const transIntent = parseTranslationIntent(clean);
  if (transIntent.isTranslationOnly && transIntent.textToTranslate && transIntent.targetLang) {
    try {
      const transResult = await translateText(transIntent.textToTranslate, transIntent.targetLang);
      return {
        detectedLanguage: transResult.sourceLanguage,
        intent: 'translate',
        actions: [],
        requiresConfirmation: false,
        spokenResponse: transResult.translatedText,
        clarificationNeeded: null,
      };
    } catch {
      // Fall through if translation fails
    }
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch('/api/interpret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: clean,
        currentJourney,
        responseLanguage,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const data: CommandInterpretation = await res.json();
      if (data && Array.isArray(data.actions) && data.actions.length > 0) {
        return data;
      }
    }
  } catch {
    // Graceful fallback to verified local multilingual rule engine
  }

  // Fallback Rule-Based Multilingual Engine for Instant Resilience
  return fallbackRuleBasedParser(clean, currentJourney, responseLanguage);
}

export function fallbackRuleBasedParser(
  text: string,
  currentJourney: any,
  responseLanguage: string = 'hi'
): CommandInterpretation {
  const clean = text.trim();
  const lower = clean.toLowerCase();
  const actions: AtomicAction[] = [];
  let requiresConfirmation = false;
  let detectedLanguage = 'hi';

  // Language detection across regional scripts and keywords
  if (/[\u0C00-\u0C7F]/.test(text) || /cheyyi|pettandi|velli|teesukellandi/i.test(lower)) {
    detectedLanguage = 'te';
  } else if (/[\u0B80-\u0BFF]/.test(text) || /azhaithu|sellungal|amaikkavum|vaanga/i.test(lower)) {
    detectedLanguage = 'ta';
  } else if (/[\u0980-\u09FF]/.test(text) || /cholun|niye|set korun/i.test(lower)) {
    detectedLanguage = 'bn';
  } else if (/[\u0A80-\u0AFF]/.test(text) || /javu che|set karo|rakho|ane pachhi/i.test(lower)) {
    detectedLanguage = 'gu';
  } else if (/जायचे|करा|मध्ये|दादर|आहे/i.test(text) || /jayache|kara|madhye|aahe/i.test(lower)) {
    detectedLanguage = 'mr';
  } else if (/[a-zA-Z]/.test(text) && !/(hai|karo|jaana|hatao|pehle|stop|cheyyi|kar do|beech|paas|jodo|manzil|rasta|chalo|rukna|wala|waala)/i.test(text)) {
    detectedLanguage = 'en';
  } else {
    detectedLanguage = 'hi';
  }

  // Check if translation request
  const transIntent = parseTranslationIntent(clean);
  if (transIntent.isTranslationOnly && transIntent.textToTranslate) {
    return {
      detectedLanguage,
      intent: 'translate',
      actions: [],
      requiresConfirmation: false,
      spokenResponse: `Translation: ${transIntent.textToTranslate}`,
      clarificationNeeded: null,
    };
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

  // 7. Named Stop Removals per clause (e.g. "remove Cyber Hub", "remove the stop at Mathura", "Dhaula Kuan hata do")
  const rawClauses = clean.split(/[,;]|(?:\s+(?:and|aur|but|lekin|fir|aur fir|और|तथा|लेकिन|फिर)\s+)/i);
  for (const rawClause of rawClauses) {
    const cClean = rawClause.trim();
    if (!cClean) continue;
    if (/(?:remove|delete|drop|hata do|hatao|nikal do|nikalo|हटाओ|हटा दो|हटाएं|निकालो|निकाल दो)/i.test(cClean)) {
      if (/(?:petrol|cng|toll|the second|the first|the third|2nd|1st|3rd|doosra|pehla|teesra)\b/i.test(cClean)) {
        continue;
      }
      const match =
        cClean.match(/(?:remove|delete|drop|hata do|hatao|nikal do|हटाओ|हटा दो|हटाएं|निकालो|निकाल दो)\s+(?:the\s+)?(?:stop\s+at\s+)?([^,]+?)(?:\s+(?:from my stops|from stops|from route|stop|स्टॉप)|$)/i) ||
        cClean.match(/([^,]+?)\s*(?:ko|को\s*)?(?:hata do|hatao|nikal do|nikalo|हटाओ|हटा दो|हटाएं|निकालो|निकाल दो)/i);

      if (match) {
        let candidate = match[1]
          .replace(/from my stops|from stops|my stops|from route|the stop at|stop at|stop|स्टॉप|वाला|का|को|ko|aur|and|और/gi, '')
          .trim();
        if (
          candidate &&
          candidate.length > 2 &&
          !/(?:petrol|cng|toll|destination|origin|start|the second|the first|the third|2nd|1st|3rd|unchanged|doosra|pehla|teesra|मंजिल)/i.test(candidate)
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

  // 8. Origin + Destination Multi-Action: e.g. "Mujhe Delhi se Agra jaana hai", "Delhi to Agra", "Start from Delhi and go to Agra"
  const multiOdMatch =
    clean.match(/(?:mujhe\s+)?([^,]+?)\s+se\s+([^,]+?)\s+(?:jaana hai|navigate karo|chalo|जाना है|चलो)/i) ||
    clean.match(/(?:start from|from)\s+([^,]+?)\s+(?:to|and go to)\s+([^,]+)/i);

  if (multiOdMatch) {
    const orig = multiOdMatch[1].replace(/mujhe|hamko|humko|start from|from/gi, '').trim();
    const dest = multiOdMatch[2].replace(/jaana hai|navigate karo|chalo|जाना है|चलो/gi, '').trim();
    if (orig) {
      actions.push({
        type: 'SET_ORIGIN',
        placeQuery: orig,
      });
    }
    if (dest) {
      actions.push({
        type: currentJourney?.destination ? 'CHANGE_DESTINATION' : 'SET_DESTINATION',
        placeQuery: dest,
      });
    }
  }

  // 9. Sequential Destination + Multi-Stop Pattern: e.g. "Agra jaana hai, pehle Mathura, phir Vrindavan"
  const seqMatch = clean.match(/([^,]+?)\s+(?:jaana hai|chalo|जाना है|चलो)[,\s]+(?:pehle|first|पहले)\s+([^,]+?)[,\s]+(?:phir|fir|then|फिर|उसके बाद|uske baad)\s+([^,]+)/i);
  if (seqMatch) {
    const dest = seqMatch[1].replace(/mujhe|hamko|humko|to|ko/gi, '').trim();
    const stop1 = seqMatch[2].replace(/mein|par|pe|stop|ko/gi, '').trim();
    const stop2 = seqMatch[3].replace(/mein|par|pe|stop|ko/gi, '').trim();

    if (dest) {
      actions.push({
        type: currentJourney?.destination ? 'CHANGE_DESTINATION' : 'SET_DESTINATION',
        placeQuery: dest,
      });
    }
    if (stop1) {
      actions.push({
        type: 'ADD_STOP',
        placeQuery: stop1,
        searchAnchor: 'route',
        position: 'start',
      });
    }
    if (stop2) {
      actions.push({
        type: 'ADD_STOP',
        placeQuery: stop2,
        searchAnchor: 'route',
        position: 'end',
      });
    }
  }

  // 10. Multi-Stop Compound Expressions:
  // e.g. "Take me to Agra and add Mathura and Bharatpur as stops"
  // e.g. "आगरा चलो, रास्ते में मथुरा और भरतपुर दोनों जगह रुकना है", "वाटेत लोणावळा आणि खंडाळा थांबायचे आहे"
  // e.g. "एक पेट्रोल पंप और एक अच्छा रेस्टोरेंट जोड़ दो", "add a coffee shop and a petrol pump on the way"
  let matchedMultiStops = false;
  const multiStopMatch =
    clean.match(/add\s+(.+?)\s+as\s+(?:intermediate\s+)?stops?/i) ||
    clean.match(/रास्ते में\s+(.+?)\s+(?:दोनों जगह|दो जगह)?\s*रुकना है/i) ||
    clean.match(/वाटेत\s+(.+?)\s+थांबायचे आहे/i) ||
    clean.match(/(?:and\s+add|aur\s+add)\s+(.+?)\s+on\s+the\s+way/i) ||
    clean.match(/रास्ते में\s+(.+?)\s+जोड़ दो/i);

  if (multiStopMatch && !seqMatch) {
    const rawEntitiesStr = multiStopMatch[1].trim();
    const parts = rawEntitiesStr.split(/\s+(?:and|aur|और|आणि|तथा|&)\s+/i);
    if (parts.length >= 2) {
      matchedMultiStops = true;
      for (const p of parts) {
        const pClean = p.replace(/^(?:a\s+stop\s+(?:at|in)?|ek\s+|एक\s+|an?\s+)?/i, '').replace(/[\s,;]+$/, '').trim();
        if (pClean && pClean.length > 1 && !/(?:take|navigate|go to|chalo|jaana|agreed)/i.test(pClean)) {
          let cat: any = undefined;
          let q = pClean;
          if (/petrol|fuel|gas/i.test(pClean)) { cat = 'gas_station'; q = 'Petrol Pump'; }
          else if (/cng/i.test(pClean)) { cat = 'cng_station'; q = 'CNG Station'; }
          else if (/coffee|cafe|कैफे/i.test(pClean)) { cat = 'restaurant'; q = 'Coffee Shop'; }
          else if (/restaurant|dhaba|khana|रेस्टोरेंट|रेस्टॉरंट/i.test(pClean)) { cat = 'restaurant'; q = 'Restaurant'; }

          if (!actions.some(a => a.type === 'ADD_STOP' && a.placeQuery?.toLowerCase() === q.toLowerCase())) {
            actions.push({
              type: 'ADD_STOP',
              placeQuery: q,
              category: cat,
              searchAnchor: 'route',
              position: 'least_detour',
            });
          }
        }
      }
    }
  }

  // 11. Devanagari Hindi & Regional Stop Additions
  // e.g. "बीच में मथुरा पर स्टॉप जोड़ दो", "मथुरा को रास्ते में जोड़ दो", "आगरा जाते समय मथुरा में रुकना है", "मथुरा को स्टॉप बनाओ, मंजिल मत बदलना", "मध्ये नाशिकला एक stop add करा", "વચ્ચે વડોદરામાં એક stop add કરો", "फक्त एक पेट्रोल पंप जोड", "बस एक पेट्रोल पंप जोड़ दो"
  const regionalStopAddMatch =
    clean.match(/(?:बीच में|beech mein)\s+(.+?)\s+(?:पर|को|में|pe|par)?\s*(?:स्टॉप|stop)?\s*(?:जोड़ दो|जोड़ो|लगाओ|बनाओ|डालो|रखो|add\s*(?:karo|kar\s*do|kardo)|jod\s*do|jodo)/i) ||
    clean.match(/(.+?)\s+(?:को|में|ko|mein)?\s*(?:रास्ते में|route mein)\s*(?:स्टॉप|stop)?\s*(?:जोड़ दो|जोड़ो|लगाओ|बनाओ|डालो|jod\s*do|jodo|add\s*(?:karo|kar\s*do|kardo))/i) ||
    clean.match(/(?:.+?\s+(?:जाते|jaate)\s+(?:समय|हुए|samay|hue)\s+)?(.+?)\s+(?:में|पर|pe|mein|par)?\s*(?:रुकना है|rukna hai)/i) ||
    clean.match(/(?:destination same rakhna|मंजिल मत बदलना)[,\s]+(.+?)\s*(?:stop\s+add\s*(?:karo|kar\s*do|kardo)|स्टॉप\s+जोड़\s+दो|ko\s+stop\s+banao)/i) ||
    clean.match(/(.+?)\s+(?:को|ko)?\s*(?:स्टॉप|stop)\s+(?:बनाओ|जोड़ो|जोड़ दो|लगाओ|add\s*(?:karo|kar\s*do|kardo)|banao)/i) ||
    clean.match(/मध्ये\s+(.+?)(?:ला)?\s+(?:एक\s+)?stop\s+add\s+करा/i) ||
    clean.match(/पुण्याला\s+जाताना\s+(.+?)(?:त|मध्ये|ला)?\s+थांबायचे\s+आहे/i) ||
    clean.match(/(?:फक्त|बस|मात्र)\s+(?:एक\s+)?(पेट्रोल पंप|petrol pump|cng station|रेस्टोरेंट|रेस्टॉरंट)\s+(?:जोड|जोड़ दो|add करा|add karo)/i) ||
    clean.match(/(?:रस्त्यात|रास्ते में)\s+(?:एक\s+)?(?:चांगले\s+|अच्छा\s+)?(रेस्टॉरंट|रेस्टोरेंट|restaurant|cafe|ढाबा)\s+(?:शोधून द्या|ढूँढकर दो|जोड़ दो|add करा)/i) ||
    clean.match(/(?:વચ્ચે\s+(.+?)(?:માં)?|(.+?)\s*(?:માં)?\s*વચ્ચે)\s*(?:એક\s+)?stop\s+add\s+કરો/i);

  if (regionalStopAddMatch && !seqMatch && !matchedMultiStops) {
    const rawStopGroup = regionalStopAddMatch[1] || regionalStopAddMatch[2] || '';
    let cat: any = undefined;
    let q = rawStopGroup.replace(/बीच में|beech mein|रास्ते में|route mein|स्टॉप|stop|को|में|पर|ko|mein|par|pe|add\s*(?:karo|kar\s*do|kardo)|jod\s*do|मध्ये|વચ્ચે|એક|एक|करा|કરો|માં|पुण्याला जाताना|फक्त|बस|जोड|जोड़ दो|शोधून द्या|ढूँढकर दो/gi, '').trim();

    if (/पेट्रोल|petrol|fuel/i.test(rawStopGroup)) { cat = 'gas_station'; q = 'Petrol Pump'; }
    else if (/cng/i.test(rawStopGroup)) { cat = 'cng_station'; q = 'CNG Station'; }
    else if (/रेस्टॉरंट|रेस्टोरेंट|restaurant|cafe|dhaba/i.test(rawStopGroup)) { cat = 'restaurant'; q = /cafe/i.test(rawStopGroup) ? 'Cafe' : 'Restaurant'; }

    if (q && q.length > 1 && !actions.some(a => a.type === 'ADD_STOP' && a.placeQuery?.toLowerCase() === q.toLowerCase())) {
      actions.push({
        type: 'ADD_STOP',
        placeQuery: q,
        category: cat,
        searchAnchor: 'route',
        position: 'least_detour',
      });
    }
  }

  // 12. Stop Additions per clause (English / Hinglish / Compound multi-additions)
  if (!seqMatch) {
    const clauses = clean.split(/[,;]|(?:\s+(?:and|aur|but|lekin|fir|aur fir|अने પછી|પછી|आणि|अब)\s+)/i);
    for (const clause of clauses) {
      const cClean = clause.trim();
      const cLower = cClean.toLowerCase();
      if (!cClean) continue;

      const isRemovalClause = /hata|remove|delete|drop|nikal/i.test(cLower);
      const isTollClause = /toll/i.test(cLower) && !/toll pump/i.test(cLower);
      const isDestOnly = (cLower.includes('jaana hai') || cLower.includes('navigate to') || cLower.includes('take me to') || cLower.includes('destination') || cLower.includes('गंतव्य') || cLower.includes('જવું છે') || cLower.includes('జాయచే ఆహే') || cLower.includes('తీసుకెళ్లండి') || cLower.includes('செல்லுங்கள்') || cLower.includes('চলুন') || cLower.includes('जायचे आहे')) &&
                         !cLower.includes('add') && !cLower.includes('jodo') && !cLower.includes('pump') && !cLower.includes('stall') && !cLower.includes('stop') && !cLower.includes('same') && !cLower.includes('વચ્ચે') && !cLower.includes('मध्ये') && !cLower.includes('फक्त') && !cLower.includes('बस');

      if (isRemovalClause || isTollClause || isDestOnly) continue;

      const hasAddWord = /add|jodo|lagao|include|put|shamil|rukna|stop|કરો|करा|जोड/i.test(cLower);
      const hasPetrol = /petrol|fuel|gas station|पेट्रोल/i.test(cLower);
      const hasCng = /cng/i.test(cLower);
      const hasFood = /tea|chai|dhaba|food|restaurant|khana|coffee|cafe|रेस्टोरेंट|रेस्टॉरंट|कैफे/i.test(cLower);
      const hasHospital = /hospital|medical|doctor/i.test(cLower);

      if (hasAddWord || hasPetrol || hasCng || hasFood || hasHospital) {
        let searchAnchor: any = 'route';
        let position: any = 'least_detour';
        let relativeTo: any = undefined;

        if (/origin|start|starting point|shuruat|pehle|माझे सुरुवातीचे/i.test(cLower)) {
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
          const foodLabel = /tea|chai/i.test(cLower) ? 'Tea Stall' : /coffee|cafe|कैफे/i.test(cLower) ? 'Cafe' : 'Restaurant';
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
          // Named place addition e.g. "Add a stop at DPS RK Puram", "DPS RK Puram par ek stop add kar do", "Add Mathura as an intermediate stop"
          const placeMatch =
            cClean.match(/(?:add\s+(?:an?\s+)?(?:intermediate\s+)?stop\s+(?:at|in|near)?\s*|add\s+)(.+?)(?:\s+(?:as\s+(?:an?\s+)?(?:intermediate\s+)?stop|to\s+(?:my\s+)?route|in\s+(?:my\s+)?route|ko\s+route\s+mein\s+jod\s+do|par\s+stop\s+add\s+kar\s+do)|$)/i) ||
            cClean.match(/(?:add|jodo|lagao)\s+([^,]+?)(?:\s+(?:to my route|near|at|stop)|$)/i) ||
            cClean.match(/(.+?)\s+par\s+ek\s+stop\s+add\s+kar\s+do/i);

          if (placeMatch) {
            let q = placeMatch[1]
              .replace(/^(?:a\s+stop\s+(?:at|in|near)\s+|stop\s+(?:at|in|near)\s+|at\s+|in\s+)/i, '')
              .replace(/(?:\s+as\s+(?:an?\s+)?(?:intermediate\s+)?stop|\s+as\s+a\s+stop|\s+to\s+my\s+route|\s+to\s+route|\s+in\s+route|\s+stop|\s+par\s+ek\s+stop)$/i, '')
              .replace(/[.,;!?]+$/, '')
              .trim();

            if (q && q.length > 1 && !actions.some(a => a.type === 'ADD_STOP' && a.placeQuery?.toLowerCase() === q.toLowerCase())) {
              actions.push({
                type: 'ADD_STOP',
                placeQuery: q,
                searchAnchor,
                position,
                relativeTo,
              });
            }
          }
        }
      }
    }
  }

  // 13. Destination Changes (Across English, Hindi, Marathi, Telugu, Tamil, Bengali, Gujarati)
  const destinationUnchanged = lower.includes('destination unchanged') ||
                               lower.includes('keep my destination unchanged') ||
                               lower.includes('keep destination unchanged') ||
                               lower.includes('keep my final destination unchanged') ||
                               lower.includes('destination change mat karna') ||
                               lower.includes('destination wahi rahega') ||
                               lower.includes('मंजिल मत बदलना') ||
                               lower.includes('destination mat badalna') ||
                               lower.includes('destination mat badlo') ||
                               lower.includes('destination same rakhna') ||
                               lower.includes("don't change my destination") ||
                               lower.includes("dont change my destination") ||
                               lower.includes("keep the destination the same") ||
                               lower.includes("keep destination same") ||
                               lower.includes("माझे ठिकाण बदलू नको") ||
                               lower.includes("ठिकाण बदलू नको");

  if (!destinationUnchanged && !seqMatch && !multiOdMatch) {
    // Check regional language destination statements
    let regionalDest: string | null = null;

    if (/मला\s+(.+?)(?:ला)?\s+जायचे\s+आहे/i.test(clean)) {
      regionalDest = clean.match(/मला\s+(.+?)(?:ला)?\s+जायचे\s+आहे/i)?.[1] || null;
    } else if (/(.+?)ला\s+destination\s+set\s+करा/i.test(clean)) {
      regionalDest = clean.match(/(.+?)ला\s+destination\s+set\s+करा/i)?.[1] || null;
    } else if (/पुण्याला\s+जाताना/i.test(clean)) {
      regionalDest = 'Pune';
    } else if (/నన్ను\s+(.+?)కు\s+తీసుకెళ్లండి/i.test(clean)) {
      regionalDest = clean.match(/నన్ను\s+(.+?)కు\s+తీసుకెళ్లండి/i)?.[1] || null;
    } else if (/(.+?)(?:ను|ni)\s+destination\s+(?:గా|ga)\s+పెట్టండి/i.test(clean)) {
      regionalDest = clean.match(/(.+?)(?:ను|ni)\s+destination\s+(?:గా|ga)\s+పెట్టండి/i)?.[1] || null;
    } else if (/என்னை\s+(.+?)க்கு\s+அழைத்துச்\s+செல்லுங்கள்/i.test(clean)) {
      regionalDest = clean.match(/என்னை\s+(.+?)க்கு\s+அழைத்துச்\s+செல்லுங்கள்/i)?.[1] || null;
    } else if (/(.+?)ஐ\s+destination\s+ஆக\s+அமைக்கவும்/i.test(clean)) {
      regionalDest = clean.match(/(.+?)ஐ\s+destination\s+ஆக\s+அமைக்கவும்/i)?.[1] || null;
    } else if (/আমাকে\s+(.+?)\s+নিয়ে\s+চলুন/i.test(clean)) {
      regionalDest = clean.match(/আমাকে\s+(.+?)\s+নিয়ে\s+চলুন/i)?.[1] || null;
    } else if (/(.+?)কে\s+destination\s+হিসেবে\s+সেট\s+করুন/i.test(clean)) {
      regionalDest = clean.match(/(.+?)কে\s+destination\s+হিসেবে\s+সেট\s+করুন/i)?.[1] || null;
    } else if (/મારે\s+(.+?)\s+જવું\s+છે/i.test(clean)) {
      regionalDest = clean.match(/મારે\s+(.+?)\s+જવું\s+છે/i)?.[1] || null;
    } else if (/(.+?)ને\s+destination\s+તરીકે\s+સેટ\s+કરો/i.test(clean)) {
      regionalDest = clean.match(/(.+?)ને\s+destination\s+તરીકે\s+સેટ\s+કરો/i)?.[1] || null;
    } else if (/(.+?)\s+destination\s+રાખો/i.test(clean)) {
      regionalDest = clean.match(/(.+?)\s+destination\s+રાખો/i)?.[1] || null;
    }

    if (regionalDest) {
      const q = regionalDest.replace(/[.,;!?]+$/, '').trim();
      if (q && q.length > 1) {
        actions.push({
          type: currentJourney?.destination ? 'CHANGE_DESTINATION' : 'SET_DESTINATION',
          placeQuery: q,
        });
      }
    } else {
      // English, Hindi & Hinglish destination extraction
      const destMatch =
        clean.match(/(?:set|change)\s+(?:the\s+|my\s+)?destination\s+to\s+([^,.;]+?)(?:[,.;]|(?:\s+(?:and|but|with|pehle|aur|aur\s+add|अब))|$)/i) ||
        clean.match(/(?:take me to|navigate to|going to)\s+([^,.;]+?)(?:[,.;]|(?:\s+(?:and|but|with|pehle|aur|aur\s+add|अब))|$)/i) ||
        clean.match(/([^,.;]+?)\s+(?:jaana hai|chalo|जाना है|चलो)/i) ||
        clean.match(/(?:गंतव्य बदलकर|गंतव्य बदलो)\s*([^,.;]+?)(?:\s+(?:करो|कर दो)|$)/i) ||
        clean.match(/(?:destination|manzil|मंजिल|गंतव्य)\s+(?:change karke|to|ko|करके|बदलकर)?\s*([^,.;]+?)(?:\s+(?:kar do|karo|कर दो|करो|set kar do|set karo)|$)/i) ||
        clean.match(/(?:destination)\s+([^,.;]+?)\s+(?:set kar do|set karo|bana do)/i);

      if (destMatch) {
        const rawDest = destMatch[1]
          .replace(/^(?:the\s+|my\s+)?destination\s+to\s+/i, '')
          .replace(/mujhe|hamko|humko|destination|change karke|kar do|set cheyyi|to|ko|par|करके|कर दो|बदलकर|करो|मुझे|मुझको|हमको|हम/gi, '')
          .replace(/[.,;!?]+$/, '')
          .trim();

        const isIntermediateKeyword = /beech mein|बीच में|रास्ते में|stop|स्टॉप|rukna|रुकना|petrol|cng|toll|unchanged|add\s+a\s+stop/i.test(rawDest);

        if (rawDest && rawDest.length > 2 && !isIntermediateKeyword) {
          actions.push({
            type: currentJourney?.destination ? 'CHANGE_DESTINATION' : 'SET_DESTINATION',
            placeQuery: rawDest,
          });
        }
      }
    }
  }

  // 13. Origin Changes
  const originUnchanged = lower.includes('origin unchanged') || lower.includes('keep origin unchanged');
  if (!originUnchanged && !multiOdMatch) {
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

  // 14. Safeguard: If no action was detected
  if (actions.length === 0) {
    if (/stop|स्टॉप|रुकना|halt/i.test(clean)) {
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
      // Extract place safely without leading command noise
      const cleanPlace = clean
        .replace(/^(?:set\s+(?:the\s+|my\s+)?destination\s+to|change\s+destination\s+to|take\s+me\s+to|navigate\s+to|going\s+to|mujhe)\s+/i, '')
        .replace(/\s+(?:jaana hai|chalo|जाना है|चलो)$/i, '')
        .replace(/[.,;!?]+$/, '')
        .trim();

      if (cleanPlace.length > 1) {
        actions.push({
          type: 'SET_DESTINATION',
          placeQuery: cleanPlace,
        });
      }
    }
  }

  const intent = actions.length > 1 ? 'compound' : actions[0]?.type?.toLowerCase() || 'unknown';

  // Build spoken acknowledgement in responseLanguage
  const isEnResp = responseLanguage === 'en';
  const descParts: string[] = [];
  for (const act of actions) {
    if (act.type === 'REMOVE_STOP') {
      const target = act.targetStopIdentifier?.byOrdinal
        ? `stop #${act.targetStopIdentifier.byOrdinal}`
        : act.targetStopIdentifier?.byName || 'stop';
      descParts.push(isEnResp ? `removed ${target}` : `${target} हटा दिया`);
    } else if (act.type === 'ADD_STOP') {
      const anchorDesc =
        act.searchAnchor === 'origin'
          ? (isEnResp ? 'near origin' : 'origin ke paas')
          : act.searchAnchor === 'destination'
          ? (isEnResp ? 'near destination' : 'destination ke paas')
          : (isEnResp ? 'along route' : 'रास्ते में');
      descParts.push(isEnResp ? `added ${act.placeQuery} (${anchorDesc})` : `${anchorDesc} ${act.placeQuery} जोड़ दिया`);
    } else if (act.type === 'SET_DESTINATION' || act.type === 'CHANGE_DESTINATION') {
      descParts.push(isEnResp ? `destination set to ${act.placeQuery}` : `destination ${act.placeQuery} set kar diya`);
    } else if (act.type === 'SET_ORIGIN' || act.type === 'CHANGE_ORIGIN') {
      descParts.push(isEnResp ? `origin set to ${act.placeQuery}` : `origin ${act.placeQuery} set kar diya`);
    } else if (act.type === 'SET_TRAVEL_MODE') {
      descParts.push(isEnResp ? `travel mode set to ${act.travelMode}` : `${act.travelMode} mode on kar diya`);
    } else if (act.type === 'TOGGLE_TOLLS') {
      descParts.push(isEnResp ? (act.avoidTolls ? 'avoiding tolls' : 'allowing tolls') : (act.avoidTolls ? 'toll avoid kar diya' : 'toll allow kar diya'));
    }
  }

  const spokenResponse = isEnResp
    ? `Route updated: ${descParts.join(', ')}.`
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
