import { DEFAULT_POLICY, type AuditResult, type GateResult, type Policy } from '@agentic-hub/shared';

/**
 * Politique effective : remplit les champs non définis (null) par les défauts.
 * Pour désactiver le seuil de score, mettre explicitement minScore = 0.
 */
export function resolveEffectivePolicy(stored: Partial<Policy> | null | undefined): Policy {
  const p = stored ?? {};
  return {
    minScore: p.minScore ?? DEFAULT_POLICY.minScore,
    maxCritical: p.maxCritical ?? DEFAULT_POLICY.maxCritical,
    maxHigh: p.maxHigh ?? DEFAULT_POLICY.maxHigh,
  };
}

/** Évalue la gate à partir d'un score et de comptes par sévérité (recalcul léger). */
export function evaluateGateCounts(
  globalScore: number,
  critical: number,
  high: number,
  policy: Policy,
): GateResult {
  const reasons: string[] = [];
  if (policy.minScore != null && globalScore < policy.minScore) {
    reasons.push(`Score ${globalScore} < minimum requis ${policy.minScore}`);
  }
  if (policy.maxCritical != null && critical > policy.maxCritical) {
    reasons.push(`${critical} finding(s) critique(s) > max ${policy.maxCritical}`);
  }
  if (policy.maxHigh != null && high > policy.maxHigh) {
    reasons.push(`${high} finding(s) élevé(s) > max ${policy.maxHigh}`);
  }
  return { passed: reasons.length === 0, reasons };
}

/** Compte les findings par sévérité (hors ignorés si statut fourni). */
function countSeverity(result: AuditResult, sev: string): number {
  return result.findings.filter((f) => f.severity === sev).length;
}

/**
 * Évalue la "gate" qualité d'un audit vis-à-vis d'une politique.
 * passed=false si l'un des seuils est dépassé.
 */
export function evaluateGate(result: AuditResult, policy: Policy): GateResult {
  const reasons: string[] = [];

  if (policy.minScore != null && result.globalScore < policy.minScore) {
    reasons.push(`Score ${result.globalScore} < minimum requis ${policy.minScore}`);
  }
  if (policy.maxCritical != null) {
    const c = countSeverity(result, 'critical');
    if (c > policy.maxCritical) reasons.push(`${c} finding(s) critique(s) > max ${policy.maxCritical}`);
  }
  if (policy.maxHigh != null) {
    const h = countSeverity(result, 'high');
    if (h > policy.maxHigh) reasons.push(`${h} finding(s) élevé(s) > max ${policy.maxHigh}`);
  }

  return { passed: reasons.length === 0, reasons };
}
