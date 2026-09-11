interface Props {
  score: number | null;
}

function ratingFor(score: number): { label: string; className: string } {
  if (score <= 30) return { label: "Low risk", className: "badge badge-risk-low" };
  if (score <= 60) return { label: "Medium risk", className: "badge badge-risk-medium" };
  if (score <= 80) return { label: "High risk", className: "badge badge-risk-high" };
  return { label: "Critical risk", className: "badge badge-risk-critical" };
}

export function RiskBadge({ score }: Props) {
  if (score === null) {
    return <span className="badge badge-neutral">Not yet assessed</span>;
  }
  const { label, className } = ratingFor(score);
  return (
    <span className={className} title={`AI risk score: ${score}/100`}>
      {label} ({score})
    </span>
  );
}
