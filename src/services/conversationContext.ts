import { AtomicAction, LatLng, Waypoint } from '../types/navigation';

export type ConversationState =
  | 'IDLE'
  | 'INTERPRETING_REQUEST'
  | 'RESOLVING_ENTITIES'
  | 'AWAITING_CLARIFICATION'
  | 'AWAITING_CONFIRMATION'
  | 'READY_TO_EXECUTE'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface ClarificationCandidate {
  index: number; // 1-indexed (1, 2, 3...)
  id: string; // Google Place ID or unique ID
  name: string;
  address: string;
  latLng?: LatLng;
  category?: string;
  confidenceScore?: number;
}

export interface PendingClarification {
  id: string;
  originalCommand: string;
  targetRole: 'destination' | 'origin' | 'stop';
  query: string;
  candidates: ClarificationCandidate[];
  pendingActions: AtomicAction[]; // actions from the compound command that wait for this clarification
  targetAction: AtomicAction;
  timestamp: number;
  responseLanguage: string;
}

export interface FollowUpResolutionResult {
  type: 'select_candidate' | 'cancel' | 'not_applicable';
  selectedCandidate?: ClarificationCandidate;
  additionalActions?: AtomicAction[];
  userMessage?: string;
}

class ConversationContextManager {
  private currentState: ConversationState = 'IDLE';
  private pendingClarification: PendingClarification | null = null;
  private clarificationTimeoutMs = 120000; // 2 minutes expiration
  private listeners: Array<() => void> = [];

  public getState(): ConversationState {
    return this.currentState;
  }

  public setState(state: ConversationState): void {
    this.currentState = state;
    this.notifyListeners();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Safe notification
      }
    }
  }

  public setPendingClarification(clarification: Omit<PendingClarification, 'id' | 'timestamp'>): PendingClarification {
    const fullClarification: PendingClarification = {
      ...clarification,
      id: `clarify-${Date.now()}`,
      timestamp: Date.now(),
    };
    this.pendingClarification = fullClarification;
    this.currentState = 'AWAITING_CLARIFICATION';
    this.notifyListeners();
    return fullClarification;
  }

  public getPendingClarification(): PendingClarification | null {
    if (!this.pendingClarification) return null;
    // Check expiration
    if (Date.now() - this.pendingClarification.timestamp > this.clarificationTimeoutMs) {
      this.clearPendingClarification();
      return null;
    }
    return this.pendingClarification;
  }

  public clearPendingClarification(): void {
    this.pendingClarification = null;
    this.currentState = 'IDLE';
    this.notifyListeners();
  }

  public isClarificationActive(): boolean {
    return this.getPendingClarification() !== null;
  }

  /**
   * Resolves follow-up user references against the active clarification context.
   * Supports English, Hindi, Hinglish, Marathi, and mixed languages.
   * Handles:
   * - Ordinals: "the first one", "second one", "3rd option", "number 2"
   * - Hindi: "पहला वाला", "दूसरा वाला", "तीसरी लोकेशन", "पहले वाली"
   * - Marathi: "पहिला", "दुसरे ठिकाण", "तिसरा पर्याय", "दुसरा"
   * - Locality & keyword disambiguation: "the one in Dwarka", "Paschim Vihar वाला", "Airport वाला"
   * - Cancellation: "cancel", "no", "rehne do", "chhod do", "radh kara"
   * - Compound follow-ups: "Choose the second one and add a petrol pump on the way"
   */
  public resolveFollowUpReference(input: string): FollowUpResolutionResult {
    const clarification = this.getPendingClarification();
    if (!clarification || clarification.candidates.length === 0) {
      return { type: 'not_applicable' };
    }

    const clean = input.trim();
    const lower = clean.toLowerCase();

    // Check for cancellation
    if (/^(?:cancel|no|nahin|nahi|rehne\s*do|chhod\s*do|radh\s*kara|nakko|stop|mat\s*karo|dismiss)(?:[,.!]|$)/i.test(lower)) {
      return { type: 'cancel', userMessage: 'Cancelled selection.' };
    }

    // Check for compound command combined with selection, e.g. "Choose the second one and add a petrol pump"
    let additionalActions: AtomicAction[] | undefined = undefined;
    if (/(?:and\s+add|aur\s+(?:ek\s+)?|aani\s+)/i.test(lower)) {
      if (/petrol|fuel|gas/i.test(lower)) {
        additionalActions = [{ type: 'ADD_STOP', placeQuery: 'petrol pump', category: 'gas_station', searchAnchor: 'route' }];
      } else if (/cng/i.test(lower)) {
        additionalActions = [{ type: 'ADD_STOP', placeQuery: 'CNG station', category: 'cng_station', searchAnchor: 'route' }];
      } else if (/restaurant|cafe|dhaba|khana/i.test(lower)) {
        additionalActions = [{ type: 'ADD_STOP', placeQuery: 'restaurant', category: 'restaurant', searchAnchor: 'route' }];
      } else if (/coffee/i.test(lower)) {
        additionalActions = [{ type: 'ADD_STOP', placeQuery: 'coffee shop', category: 'restaurant', searchAnchor: 'route' }];
      }
    }

    // 1. Ordinal pattern matching
    let targetIndex: number | null = null;

    // Second / #2 (Check before single 'one' to avoid 'second one' matching 'one')
    if (
      /\b(?:second|2nd|number\s*2|two|dusra|doosra|dusara|second\s*one|second\s*option)\b/i.test(lower) ||
      /दूसरा|दूसरी|दुसरा|दुसरे/i.test(clean)
    ) {
      targetIndex = 2;
    }
    // Third / #3
    else if (
      /\b(?:third|3rd|number\s*3|three|teesra|tisra|third\s*one|third\s*option)\b/i.test(lower) ||
      /तीसरा|तीसरी|तिसरा|तिसरे/i.test(clean)
    ) {
      targetIndex = 3;
    }
    // Fourth / #4
    else if (
      /\b(?:fourth|4th|number\s*4|four|chautha|fourth\s*one)\b/i.test(lower) ||
      /चौथा|चौथी/i.test(clean)
    ) {
      targetIndex = 4;
    }
    // First / #1
    else if (
      /\b(?:first|1st|number\s*1|first\s*one|first\s*option|pehla|pahila)\b/i.test(lower) ||
      (!/\b(?:second|third|fourth|2nd|3rd|4th)\b/i.test(lower) && /\bone\b/i.test(lower)) ||
      /पहला|पहली|पहिला|पहिले/i.test(clean)
    ) {
      targetIndex = 1;
    }

    if (targetIndex !== null) {
      const candidate = clarification.candidates.find((c) => c.index === targetIndex);
      if (candidate) {
        return {
          type: 'select_candidate',
          selectedCandidate: candidate,
          additionalActions,
          userMessage: `Selected option #${targetIndex}: ${candidate.name}`,
        };
      }
    }

    // 2. Locality / descriptive disambiguation matching
    // e.g. "the one in Dwarka", "Paschim Vihar वाला", "near airport"
    for (const candidate of clarification.candidates) {
      const candName = candidate.name.toLowerCase();
      const candAddr = (candidate.address || '').toLowerCase();

      // Extract significant tokens from user input (ignoring common filler words)
      const inputTokens = clean
        .toLowerCase()
        .replace(/^(?:the\s+one\s+(?:in|near|at)|choose|select|i\s+meant\s+(?:the\s+one\s+in)?|meant|wala|waala|mein|me|par|pe)\s+/gi, '')
        .replace(/(?:\s+(?:वाला|वाली|वाले|wala|waala|hotel|location|stop))+$/gi, '')
        .split(/\s+/)
        .map((t) => t.replace(/^(?:वाला|वाली|वाले|wala|waala|hotel|location|stop)$/gi, '').trim())
        .filter((t) => t.length > 2 && !['the', 'one', 'and', 'with', 'stop', 'karo', 'chuno'].includes(t));

      if (inputTokens.length > 0) {
        const matchesAll = inputTokens.every((tok) => candName.includes(tok) || candAddr.includes(tok));
        if (matchesAll) {
          return {
            type: 'select_candidate',
            selectedCandidate: candidate,
            additionalActions,
            userMessage: `Selected ${candidate.name} based on your specification`,
          };
        }
      }
    }

    return { type: 'not_applicable' };
  }
}

export const conversationContext = new ConversationContextManager();
