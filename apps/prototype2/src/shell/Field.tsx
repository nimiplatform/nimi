/** The Field — luminous sky container. Phase rides on this element. */
export function Field({ phase, children }: { phase: string; children?: React.ReactNode }) {
  return (
    <div className="field" data-phase={phase}>
      <span className="wisp a" />
      <span className="wisp b" />
      {children}
    </div>
  );
}
