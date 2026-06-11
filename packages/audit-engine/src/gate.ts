import type { AuditResult, GateResult, Policy } from '@agentic-hub/shared';

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
