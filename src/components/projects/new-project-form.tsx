"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProjectSnapshot } from "@/domain/types";

type ApiResponse<T> = { success: true; data: T } | { success: false; error: { message: string } };

export function NewProjectForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setPending(true);
    setError("");

    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        club: formData.get("club"),
        eventName: formData.get("eventName"),
        areaInput: formData.get("areaInput")
      })
    });
    const payload = (await response.json()) as ApiResponse<ProjectSnapshot>;
    setPending(false);

    if (!payload.success) {
      setError(payload.error.message);
      return;
    }

    router.push(`/projects/${payload.data.id}`);
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto mt-8 max-w-2xl space-y-4 rounded-md border border-slate-200 bg-white p-5 shadow-panel">
      <label className="block text-sm font-medium">
        Projektnavn
        <Input name="name" required defaultValue="B-spor - ny mark" />
      </label>
      <label className="block text-sm font-medium">
        Klub
        <Input name="club" defaultValue="DcH Holbæk" />
      </label>
      <label className="block text-sm font-medium">
        Arrangement
        <Input name="eventName" defaultValue="Træning" />
      </label>
      <label className="block text-sm font-medium">
        Kendt markareal
        <Input name="areaInput" defaultValue="28.310 m²" />
      </label>
      {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      <Button type="submit" variant="primary" disabled={pending} icon={<FilePlus2 size={16} />}>
        {pending ? "Opretter ..." : "Opret projekt"}
      </Button>
    </form>
  );
}
