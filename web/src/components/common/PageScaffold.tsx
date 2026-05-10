import type { ReactNode } from "react";

export function PageScaffold({ children, width = "wide" }: { children: ReactNode; width?: "wide" | "full" }) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-bg)]">
      <div className={width === "full" ? "h-full p-6" : "mx-auto max-w-7xl p-6"}>
        {children}
      </div>
    </main>
  );
}

export function PageSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--color-border-soft)] bg-white shadow-sm">
      <div className="border-b border-[var(--color-border-soft)] px-5 py-4">
        <h2 className="text-base font-semibold text-[var(--color-text)]">{title}</h2>
        {description && <p className="mt-1 text-sm leading-6 text-[var(--color-text-muted)]">{description}</p>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function InfoCard({
  title,
  description,
  meta,
}: {
  title: string;
  description: string;
  meta?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] p-4">
      <div className="text-sm font-semibold text-[var(--color-text)]">{title}</div>
      <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">{description}</p>
      {meta && <div className="mt-3 font-mono text-xs text-[var(--color-text-soft)]">{meta}</div>}
    </div>
  );
}
