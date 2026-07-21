"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

type ProjectVersionItem = {
  id: string;
  label: string;
  createdAt: string;
};

export function VersionRestorePanel({ projectId, versions }: { projectId: string; versions: ProjectVersionItem[] }) {
  const [items, setItems] = useState(versions);
  const [status, setStatus] = useState("");
  const [restoringId, setRestoringId] = useState<string>();

  async function saveSnapshot() {
    setStatus("Gemmer snapshot ...");
    const response = await fetch(`/api/projects/${projectId}/versions`, { method: "POST" });
    const payload = (await response.json()) as
      | { success: true; data: { id: string; label: string; createdAt: string | Date } }
      | { success: false; error: { message: string } };
    if (!response.ok || !payload.success) {
      setStatus(payload.success ? "Kunne ikke gemme snapshot." : payload.error.message);
      return;
    }
    setItems((current) => [
      {
        id: payload.data.id,
        label: payload.data.label,
        createdAt: new Date(payload.data.createdAt).toISOString()
      },
      ...current
    ]);
    setStatus("Snapshot gemt.");
  }

  async function restore(versionId: string) {
    setRestoringId(versionId);
    setStatus("Gendanner ...");
    const response = await fetch(`/api/projects/${projectId}/versions/${versionId}/restore`, { method: "POST" });
    if (response.ok) {
      window.location.href = `/projects/${projectId}`;
      return;
    }
    setRestoringId(undefined);
    setStatus("Kunne ikke gendanne versionen.");
  }

  return (
    <section className="mt-6 rounded-md border border-slate-200 bg-white p-4 shadow-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Versionshistorik</h2>
          <p className="text-sm text-ink-500">Gemte snapshots kan gendannes til projektet.</p>
        </div>
        <Button onClick={() => void saveSnapshot()}>Gem snapshot</Button>
      </div>
      <div className="mt-4 space-y-2">
        {items.length === 0 ? (
          <p className="rounded-md bg-slate-50 p-3 text-sm text-ink-500">Ingen gemte snapshots endnu.</p>
        ) : (
          items.map((version) => (
            <div key={version.id} className="flex items-center justify-between gap-3 rounded-md bg-slate-50 p-3 text-sm">
              <div>
                <p className="font-medium">{version.label}</p>
                <p className="text-ink-500">{new Date(version.createdAt).toLocaleString("da-DK")}</p>
              </div>
              <Button
                icon={<RotateCcw size={16} />}
                disabled={restoringId === version.id}
                onClick={() => void restore(version.id)}
              >
                Gendan
              </Button>
            </div>
          ))
        )}
      </div>
      {status ? <p className="mt-3 text-xs text-ink-500">{status}</p> : null}
    </section>
  );
}
