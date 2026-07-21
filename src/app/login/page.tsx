import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7f4] px-5 text-ink-900">
      <section className="w-full max-w-sm rounded-md border border-slate-200 bg-white p-5 shadow-panel">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-field-700" size={20} />
          <h1 className="text-xl font-semibold">Adgang til DcH Sporplanlægger</h1>
        </div>
        <form className="mt-5 space-y-3" action="/api/auth/login" method="post">
          <input type="hidden" name="next" value={params.next ?? "/"} />
          <label className="block text-sm font-medium">
            Adgangstoken
            <Input name="token" type="password" autoComplete="current-password" />
          </label>
          {params.error ? <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">Token blev ikke godkendt.</p> : null}
          <Button variant="primary" className="w-full">
            Log ind
          </Button>
        </form>
      </section>
    </main>
  );
}
