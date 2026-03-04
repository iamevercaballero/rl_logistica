export function EmptyState({
  title = "No hay datos",
  description = "Todavía no hay registros para mostrar.",
  action,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__title">{title}</div>
      <div className="empty__desc">{description}</div>
      {action ? <div className="empty__action">{action}</div> : null}
    </div>
  );
}