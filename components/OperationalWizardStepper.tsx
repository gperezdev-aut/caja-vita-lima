"use client";

type Props = {
  labels: string[];
  step: number;
  maxStep: number;
  onNavigate: (step: number) => void;
  ariaLabel: string;
};

export function OperationalWizardStepper({
  labels,
  step,
  maxStep,
  onNavigate,
  ariaLabel,
}: Props) {
  return (
    <nav className={`wizardProgress operationalStepper operationalStepper${labels.length}`} aria-label={ariaLabel}>
      {labels.map((label, index) => {
        const number = index + 1;
        const done = number !== step && number < maxStep;
        const available = number <= maxStep || number === step;

        return (
          <button
            key={label}
            type="button"
            className={`wizardStep ${number === step ? "active" : ""} ${done ? "done" : ""}`}
            disabled={!available}
            aria-current={number === step ? "step" : undefined}
            onClick={() => onNavigate(number)}
          >
            <span aria-hidden="true">{done ? "✓" : number}</span>
            <small>{label}</small>
          </button>
        );
      })}
    </nav>
  );
}
