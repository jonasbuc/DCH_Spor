import Link from "next/link";
import { NewProjectForm } from "@/components/projects/new-project-form";

export default function NewProjectPage() {
  return (
    <main className="min-h-screen bg-[#f5f7f4] px-5 py-8 text-ink-900">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="text-sm text-field-700 underline">
          Tilbage til projekter
        </Link>
        <h1 className="mt-4 text-3xl font-semibold">Opret nyt sporprojekt</h1>
        <p className="mt-2 text-ink-700">Projektet starter med et kalibreret areal og kan derefter redigeres i hovededitoren.</p>
      </div>
      <NewProjectForm />
    </main>
  );
}
