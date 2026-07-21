export function parseDanishNumber(input: string): number {
  const normalized = input
    .trim()
    .replace(/\s/g, "")
    .replace(/\u00a0/g, "")
    .replace(/\./g, "")
    .replace(",", ".");

  const value = Number(normalized.replace(/[^\d.-]/g, ""));

  if (!Number.isFinite(value)) {
    throw new Error(`Kan ikke fortolke tallet: ${input}`);
  }

  return value;
}

export function parseAreaInputToM2(input: string): number {
  const value = parseDanishNumber(input);
  const lower = input.toLowerCase();

  if (lower.includes("ha")) {
    return value * 10_000;
  }

  return value;
}

export function squareMetersToHectares(areaM2: number): number {
  return areaM2 / 10_000;
}

export function stepsToMeters(steps: number, stepLengthMeters: number): number {
  return steps * stepLengthMeters;
}

export function metersToSteps(meters: number, stepLengthMeters: number): number {
  return meters / stepLengthMeters;
}

export function formatSquareMeters(areaM2: number): string {
  return `${new Intl.NumberFormat("da-DK", {
    maximumFractionDigits: 0
  }).format(areaM2)} m²`;
}

export function formatHectares(areaM2: number): string {
  return `${new Intl.NumberFormat("da-DK", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  }).format(squareMetersToHectares(areaM2))} ha`;
}

export function formatMeters(meters: number, fractionDigits = 1): string {
  return `${new Intl.NumberFormat("da-DK", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(meters)} m`;
}

export function formatSteps(steps: number): string {
  return `${new Intl.NumberFormat("da-DK", {
    maximumFractionDigits: 0
  }).format(steps)} skridt`;
}
