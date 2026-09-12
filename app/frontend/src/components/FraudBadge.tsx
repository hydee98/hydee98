import { AlertTriangle, HelpCircle, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";

interface Props {
  score: number | null;
}

function ratingFor(score: number): { label: string; className: string; Icon: typeof ShieldCheck } {
  if (score <= 30) return { label: "Low fraud risk", className: "badge badge-risk-low", Icon: ShieldCheck };
  if (score <= 60)
    return { label: "Some caution advised", className: "badge badge-risk-medium", Icon: ShieldAlert };
  if (score <= 80)
    return { label: "High fraud risk", className: "badge badge-risk-high", Icon: AlertTriangle };
  return { label: "Critical - likely scam", className: "badge badge-risk-critical", Icon: ShieldX };
}

export function FraudBadge({ score }: Props) {
  if (score === null) {
    return (
      <span className="badge badge-neutral">
        <HelpCircle size={13} /> Not yet screened
      </span>
    );
  }
  const { label, className, Icon } = ratingFor(score);
  return (
    <span className={className} title={`AI fraud score: ${score}/100`}>
      <Icon size={13} /> {label} ({score})
    </span>
  );
}
