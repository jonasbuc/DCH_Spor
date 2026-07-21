import Link from "next/link";

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-[#f5f7f4] px-5 py-8 text-ink-900">
      <div className="mx-auto max-w-4xl">
        <Link href="/" className="text-sm text-field-700 underline">
          Tilbage
        </Link>
        <h1 className="mt-4 text-3xl font-semibold">Brugervejledning</h1>
        <div className="mt-6 space-y-4 text-ink-700">
          <section className="rounded-md border border-slate-200 bg-white p-4 shadow-panel">
            <h2 className="font-semibold text-ink-900">Koordinater og mål</h2>
            <p className="mt-2">
              Editorens sandhed er lokale meterkoordinater. Billedkoordinater bruges kun som visnings- og
              kalibreringsgrundlag, mens længder, vinkler, afstande og arealer beregnes matematisk i meter.
            </p>
          </section>
          <section className="rounded-md border border-slate-200 bg-white p-4 shadow-panel">
            <h2 className="font-semibold text-ink-900">Billedkalibrering</h2>
            <p className="mt-2">
              Du kan kalibrere via kendt afstand, kendt areal eller kendt bredde og højde. Arealmetoden viser en
              præcisionsadvarsel, fordi den kun er præcis uden perspektivforvrængning.
            </p>
          </section>
          <section className="rounded-md border border-slate-200 bg-white p-4 shadow-panel">
            <h2 className="font-semibold text-ink-900">Tastatur</h2>
            <p className="mt-2">
              Delete sletter valgt spor, Cmd/Ctrl+Z fortryder, Cmd/Ctrl+Shift+Z gentager, Cmd/Ctrl+D duplikerer,
              R roterer, M spejlvender, F tilpasser zoom, og Escape annullerer aktiv handling.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
