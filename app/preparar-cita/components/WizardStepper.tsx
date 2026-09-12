import { WIZARD_PROGRESS, progressIndex } from "../prepararCitaWizard";

type Props = {
  step: number;
  maxStep: number;
  onNavigate: (step: number) => void;
};

const destination = [0, 1, 3, 4, 5];

export function WizardStepper({ step, maxStep, onNavigate }: Props) {
  const current = progressIndex(step);
  return (
    <nav className="prepararStepper" aria-label="Progreso de preparación">
      {WIZARD_PROGRESS.map((label, index) => {
        const target = destination[index];
        const available = target <= maxStep || index === current;
        const done = index < current;
        return (
          <button
            key={label}
            type="button"
            className={index === current ? "active" : done ? "done" : ""}
            disabled={!available}
            aria-current={index === current ? "step" : undefined}
            onClick={() => onNavigate(target)}
          >
            <span aria-hidden="true">{done ? "✓" : index + 1}</span>
            <small>{label}</small>
          </button>
        );
      })}
    </nav>
  );
}
