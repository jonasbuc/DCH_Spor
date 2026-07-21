"use client";

import { useMemo, useState } from "react";
import type { TrackTemplateRules } from "@/domain/types";
import { stepsToMeters } from "@/utils/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type TemplateAdminModel = {
  id: string;
  name: string;
  description: string;
  rules: TrackTemplateRules;
};

type NumericRuleKey =
  | "lengthSteps"
  | "stepLengthMeters"
  | "turnCount"
  | "turnAngleDegrees"
  | "minMiddleSegmentSteps"
  | "objectCount"
  | "minTrackSpacingSteps"
  | "startMarkers"
  | "minLastObjectToFinishMeters"
  | "minObjectDistanceFromTurnMeters"
  | "angleToleranceDegrees"
  | "lengthToleranceMeters";

const numericFields: { key: NumericRuleKey; label: string; unit: string; step?: string }[] = [
  { key: "lengthSteps", label: "Længde", unit: "skridt" },
  { key: "stepLengthMeters", label: "Skridtlængde", unit: "m", step: "0.01" },
  { key: "turnCount", label: "Knæk", unit: "stk." },
  { key: "turnAngleDegrees", label: "Knækvinkel", unit: "grader" },
  { key: "minMiddleSegmentSteps", label: "Minimum mellem knæk", unit: "skridt" },
  { key: "objectCount", label: "Genstande", unit: "stk." },
  { key: "minTrackSpacingSteps", label: "Minimumafstand mellem spor", unit: "skridt" },
  { key: "startMarkers", label: "Startmarkeringer", unit: "stk." },
  { key: "minLastObjectToFinishMeters", label: "Sidste genstand til slut", unit: "m" },
  { key: "minObjectDistanceFromTurnMeters", label: "Genstand fra knæk", unit: "m" },
  { key: "angleToleranceDegrees", label: "Vinkeltolerance", unit: "grader" },
  { key: "lengthToleranceMeters", label: "Længdetolerance", unit: "m" }
];

export function TemplateAdminForm({ template }: { template: TemplateAdminModel }) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);
  const [rules, setRules] = useState(template.rules);
  const [status, setStatus] = useState("Ikke gemt");

  const derived = useMemo(() => normalizeRules(rules), [rules]);

  function updateNumber(key: NumericRuleKey, value: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setRules((current) => normalizeRules({ ...current, [key]: parsed }));
    setStatus("Ikke gemt");
  }

  async function save() {
    setStatus("Gemmer ...");
    const response = await fetch(`/api/templates/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, rules: normalizeRules({ ...rules, name }) })
    });
    setStatus(response.ok ? "Gemt" : "Kunne ikke gemme");
  }

  return (
    <article className="rounded-md border border-slate-200 bg-white p-4 shadow-panel">
      <div className="grid gap-3 md:grid-cols-[1fr_160px]">
        <label className="text-sm font-medium">
          Templatenavn
          <Input value={name} onChange={(event) => setName(event.currentTarget.value)} />
        </label>
        <div className="flex items-end">
          <Button variant="primary" className="w-full" onClick={() => void save()}>
            Gem regler
          </Button>
        </div>
      </div>
      <label className="mt-3 block text-sm font-medium">
        Beskrivelse
        <Input value={description} onChange={(event) => setDescription(event.currentTarget.value)} />
      </label>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {numericFields.map((field) => (
          <label key={field.key} className="text-xs font-medium text-ink-700">
            {field.label}
            <div className="mt-1 grid grid-cols-[1fr_auto] overflow-hidden rounded-md border border-slate-200 bg-white">
              <input
                className="min-h-10 px-3 py-2 text-sm outline-none"
                type="number"
                min={0}
                step={field.step ?? "1"}
                value={rules[field.key]}
                onChange={(event) => updateNumber(field.key, event.currentTarget.value)}
              />
              <span className="flex min-w-16 items-center justify-center border-l border-slate-200 bg-slate-50 px-2 text-xs">
                {field.unit}
              </span>
            </div>
          </label>
        ))}
        <label className="text-xs font-medium text-ink-700">
          Sporalder
          <Input
            value={rules.trackAgeInfo}
            onChange={(event) => {
              setRules((current) => ({ ...current, trackAgeInfo: event.currentTarget.value }));
              setStatus("Ikke gemt");
            }}
          />
        </label>
        <label className="text-xs font-medium text-ink-700">
          Genstandstype
          <Input
            value={rules.objectMaterial}
            onChange={(event) => {
              setRules((current) => ({ ...current, objectMaterial: event.currentTarget.value }));
              setStatus("Ikke gemt");
            }}
          />
        </label>
      </div>
      <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-ink-700">
        Afledt længde: {derived.lengthMeters.toFixed(1)} m. Minimum mellem knæk: {derived.minMiddleSegmentMeters.toFixed(1)} m.
        Minimum sporafstand: {derived.minTrackSpacingMeters.toFixed(1)} m.
      </div>
      <p className="mt-2 text-xs text-ink-500">{status}</p>
    </article>
  );
}

function normalizeRules(rules: TrackTemplateRules): TrackTemplateRules {
  return {
    ...rules,
    lengthMeters: stepsToMeters(rules.lengthSteps, rules.stepLengthMeters),
    minMiddleSegmentMeters: stepsToMeters(rules.minMiddleSegmentSteps, rules.stepLengthMeters),
    minTrackSpacingMeters: stepsToMeters(rules.minTrackSpacingSteps, rules.stepLengthMeters)
  };
}
