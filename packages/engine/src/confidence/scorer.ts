/**
 * Confidence scorer (M6.2, Blueprint §4.6):
 *
 *   field_confidence = f(extractor_agreement, vendor_confidence, gate_results)
 *
 * with exactly three outcomes: auto_accept (agree + gates pass + confident),
 * review (ANYTHING uncertain), reject (illegible). 99% is achieved by
 * CATCHING the uncertain 5–8%, not by wishing the extractor were perfect —
 * so every rule here fails toward review.
 *
 * Thresholds live in config. Real tuning happens against the corpus
 * (auto-accept precision ≥99.5% governs the threshold; coverage is what it
 * is — task M6.2); the defaults below are deliberately conservative until
 * that ROC run exists.
 */

export type Decision = "auto_accept" | "review" | "reject";

/** One field's signals after consensus (M4.4) + gates (M6.1). */
export interface FieldSignals {
  factId: string;
  /** Normalized cents from each independent path; null = extractor said absent. */
  path1Cents: bigint | null;
  path2Cents: bigint | null;
  /** Vendor/model-reported confidences, 0..1. */
  path1Confidence: number;
  path2Confidence: number;
  /** True when runGates() put this fact in blockedFactIds (Iron Law #6). */
  gateBlocked: boolean;
}

export interface ConfidenceThresholds {
  /** Combined confidence required to auto-accept an agreed value. */
  autoAcceptMin: number;
  /** Both-absent below this combined confidence = illegible → reject. */
  rejectBelow: number;
}

/** Conservative until the corpus ROC run tunes them (M6.2 / M1.3). */
export const DEFAULT_THRESHOLDS: ConfidenceThresholds = {
  autoAcceptMin: 0.9,
  rejectBelow: 0.3,
};

export interface ScoredField {
  factId: string;
  decision: Decision;
  /** Combined confidence in [0,1] — min of the paths (conservatism). */
  confidence: number;
  /** True when both extractors agree the field is absent on the document. */
  agreedAbsent: boolean;
  /** Auditable rationale, most significant first. */
  reasons: string[];
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function scoreField(
  s: FieldSignals,
  t: ConfidenceThresholds = DEFAULT_THRESHOLDS,
): ScoredField {
  const c1 = clamp01(s.path1Confidence);
  const c2 = clamp01(s.path2Confidence);
  const combined = Math.min(c1, c2);
  const reasons: string[] = [];

  // 1. Gate blocks veto auto-accept unconditionally (Iron Law #6).
  if (s.gateBlocked) {
    reasons.push("blocked by validation gate (G1–G5)");
    return {
      factId: s.factId,
      decision: "review",
      confidence: combined,
      agreedAbsent: false,
      reasons,
    };
  }

  const bothAbsent = s.path1Cents === null && s.path2Cents === null;
  const oneAbsent = (s.path1Cents === null) !== (s.path2Cents === null);

  // 2. Both extractors say the field is absent.
  if (bothAbsent) {
    if (combined < t.rejectBelow) {
      reasons.push(`illegible: both paths absent at low confidence (${combined.toFixed(2)})`);
      return {
        factId: s.factId,
        decision: "reject",
        confidence: combined,
        agreedAbsent: true,
        reasons,
      };
    }
    if (combined >= t.autoAcceptMin) {
      reasons.push("both paths confidently agree the field is absent");
      return {
        factId: s.factId,
        decision: "auto_accept",
        confidence: combined,
        agreedAbsent: true,
        reasons,
      };
    }
    reasons.push("both paths absent but not confidently — review");
    return {
      factId: s.factId,
      decision: "review",
      confidence: combined,
      agreedAbsent: true,
      reasons,
    };
  }

  // 3. Single-source-only: one path found a value, the other did not.
  if (oneAbsent) {
    reasons.push("single-source value (paths disagree on presence)");
    return {
      factId: s.factId,
      decision: "review",
      confidence: combined,
      agreedAbsent: false,
      reasons,
    };
  }

  // 4. Both present — exact cent agreement is the only agreement.
  if (s.path1Cents !== s.path2Cents) {
    reasons.push("extractors disagree on the value");
    return {
      factId: s.factId,
      decision: "review",
      confidence: combined,
      agreedAbsent: false,
      reasons,
    };
  }

  // 5. Agreement + gates clean: confidence decides.
  if (combined >= t.autoAcceptMin) {
    reasons.push(`independent extractors agree at confidence ${combined.toFixed(2)}`);
    return {
      factId: s.factId,
      decision: "auto_accept",
      confidence: combined,
      agreedAbsent: false,
      reasons,
    };
  }
  reasons.push(`agreement but combined confidence ${combined.toFixed(2)} below auto-accept bar`);
  return {
    factId: s.factId,
    decision: "review",
    confidence: combined,
    agreedAbsent: false,
    reasons,
  };
}

export function scoreFields(
  signals: FieldSignals[],
  t: ConfidenceThresholds = DEFAULT_THRESHOLDS,
): ScoredField[] {
  return signals.map((s) => scoreField(s, t));
}
