interface Props {
  score: number | null;
}

function ratingFor(score: number): { label: string; className: string } {
  if (score <= 30) return { label: "Low fraud risk", className: "badge badge-risk-low" };
  if (score <= 60) return { label: "Some caution advised", className: "badge badge-risk-medium" };
  if (score <= 80) return { label: "High fraud risk", className: "badge badge-risk-high" };
  return { label: "Critical - likely scam", className: "badge badge-risk-critical" };
}

export function FraudBadge({ score }: Props) {
  if (score === null) {
    return <span className="badge badge-neutral">Not yet screened</span>;
  }
  const { label, className } = ratingFor(score);
  return (
    <span className={className} title={`AI fraud score: ${score}/100`}>
      {label} ({score})
    </span>
  );
}
