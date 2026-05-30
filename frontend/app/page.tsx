export default function Home() {
  return (
    <main className="flex-1 flex items-center justify-center px-6 py-32">
      <div className="max-w-md text-center space-y-4">
        <p className="font-mono text-xs uppercase tracking-widest text-ifasto-amber">
          ifasto dashboard · phase 1 scaffold
        </p>
        <h1 className="font-display text-4xl tracking-tight leading-tight">
          Login lands here in step 7.
        </h1>
        <p className="text-ifasto-secondary leading-relaxed">
          Restaurant operator dashboard for{" "}
          <a
            href="https://ifasto.com"
            className="text-ifasto-text border-b border-ifasto-amber hover:text-ifasto-amber transition-colors"
          >
            ifasto
          </a>
          . Backend health at{" "}
          <code className="font-mono text-sm text-ifasto-text">/api/health</code>.
        </p>
      </div>
    </main>
  );
}
