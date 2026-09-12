type Props = {
  visible: boolean;
  summary: string;
  detail?: string;
  actionLabel: string;
  disabled?: boolean;
  onAction: () => void;
};

export function MobileSummaryBar({ visible, summary, detail, actionLabel, disabled, onAction }: Props) {
  if (!visible) return null;
  return (
    <aside className="mobileSummaryBar" aria-label="Resumen de la cita">
      <div>
        <strong title={summary}>{summary}</strong>
        {detail && <span>{detail}</span>}
      </div>
      <button type="button" disabled={disabled} onClick={onAction}>{actionLabel}</button>
    </aside>
  );
}
