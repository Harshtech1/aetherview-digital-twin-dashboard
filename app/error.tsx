"use client";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({
  error,
  reset,
}: ErrorPageProps): JSX.Element {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[var(--surface-base)] px-6 text-[var(--text-primary)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.1),transparent_26%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_20%,rgba(0,0,0,0.22))]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.16),transparent)]" />

      <div className="glass-panel relative z-10 max-w-2xl rounded-[2rem] px-8 py-10 text-center">
        <div className="flex items-center justify-center gap-3">
          <p className="text-[0.68rem] uppercase tracking-[0.34em] text-white/74">
            AETHERVIEW
          </p>
          <span className="font-[family-name:var(--font-mono)] text-[0.66rem] uppercase tracking-[0.24em] text-white/42">
            ROUTE / ERROR
          </span>
        </div>
        <h1 className="mt-4 text-[clamp(2.3rem,4vw,3.5rem)] font-semibold tracking-[-0.05em] text-white">
          This route needs another pass.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-[var(--text-secondary)]">
          {error.message ||
            "AetherView hit an unexpected issue while composing this scene."}
        </p>
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button
            type="button"
            className="focus-ring inline-flex items-center rounded-full border border-white/10 bg-white/[0.08] px-5 py-3 text-sm font-medium text-white transition-all duration-300 ease-out hover:scale-[1.02] hover:border-[#8ea8ff]/28 hover:bg-white/[0.12]"
            onClick={() => reset()}
          >
            Retry route
          </button>
          {error.digest ? (
            <div className="rounded-full border border-white/10 bg-black/20 px-4 py-3 font-[family-name:var(--font-mono)] text-[0.68rem] uppercase tracking-[0.22em] text-white/52 backdrop-blur-3xl shadow-2xl shadow-black/60">
              Digest / {error.digest}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
