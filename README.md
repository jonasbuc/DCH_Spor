# DcH Sporplanlægger

Fullstack MVP til at planlægge, tegne, validere og eksportere DcH B-spor på markarealer.

## Arkitektur

Appen bruger Next.js App Router, React, TypeScript strict, Tailwind CSS, Zustand, Prisma og SQLite lokalt. Til produktion findes en separat PostgreSQL Prisma-schemafil i `prisma/schema.postgresql.prisma`, og `docker-compose.yml` starter en PostgreSQL-service.

Geometrien normaliseres til lokale meterkoordinater. Billed- og kortkoordinater er kun input/visningslag; længder, vinkler, kantmarginer, sporafstande og arealer beregnes i meter. Lat/lon må derfor ikke bruges direkte til euklidiske afstande.

## Implementeret MVP

- Projektliste, opret projekt og hovededitor.
- SVG-baseret mark- og sporeditor med zoom, pan, multi-select, lagpanel, context menu, snap-grid, snap-vinkler, undo/redo, tastaturgenveje og autosave debounce.
- Privat uploadet markbillede som redigerbart baggrundslag med rotation, crop, opacitet og tilpasning til markpolygon.
- Kalibrering efter kendt areal, to-punkts afstand og kendt bredde/højde.
- Interaktivt Leaflet/OpenStreetMap-kortflow med adresseopslag, klik-polygon og projektion til EPSG:25832/lokale meterkoordinater.
- Dansk talfortolkning: `28.310 m²`, `2,831 ha`, skridt og meter.
- Admin-side til redigering af DcH B-spor-template uden hardcoding i UI.
- Geometri-funktioner for længde, segmenter, knækvinkler, afstand mellem spor, kantafstand, buffer, rotation, spejling, selvkrydsning og objektplacering langs polyline.
- Validation engine med strukturerede fejl/advarsler.
- Server-side automatisk placering med reproducerbar seed, flere kandidatstrategier, fremdriftsvisning og annullering i UI.
- Upload-endpoint med filtype- og størrelseskontrol samt privat image retrieval.
- Eksport til SVG, PNG, GeoJSON, projekt-JSON, oversigts-PDF, Markdown-sporlæggerark og PDF-sporlæggerark.
- Versionshistorik med snapshot-oprettelse og restore-flow.
- Valgfri adgangskontrol via `DCH_ACCESS_TOKEN`; når tokenet er sat, beskyttes sider og API-ruter.
- Prisma-modeller for User, Project, Field, FieldImage, Calibration, FieldPolygon, RestrictedArea, TrackTemplate, TrackRule, Track, TrackPoint, TrackObject, ValidationSnapshot, Export og ProjectVersion.
- Seedet demoprojekt: “Eksempelmark - 6 B-spor”, 28.310 m² / 2,831 ha.

## Lokal start

```bash
npm install
npm run dev
```

Åbn `http://127.0.0.1:3102`.

`npm run dev` starter den stabile real-preview, som bruger de samme domænefunktioner til validering, placering, kortprojektion, billedlag og eksport som resten af appen. De oprindelige Next-kommandoer er bevaret som:

```bash
npm run dev:next
npm run build:next
```

Preview-serveren har et health-endpoint på `/api/health`. Kør `npm run demo:check` for at starte en isoleret preview-server på en testport og kontrollere, at HTML og health-status svarer.

I denne Codex-session har Next CLI-hovedstien hængt før første brugbare output, så preview-serveren er den aktuelle lokale feedbackflade.

Hvis Prisma migrate-engine fejler lokalt, bruger `npm run db:migrate` den indcheckede idempotente SQLite-SQL direkte via `prisma db execute`.

## Adgangskontrol

Lokalt er appen åben, hvis `DCH_ACCESS_TOKEN` er tom. Sæt `DCH_ACCESS_TOKEN` i miljøet for at aktivere login-siden og API-beskyttelse. API-klienter kan bruge headeren `x-dch-access-token`.

## PostgreSQL

Udvikling bruger som standard SQLite:

```bash
DATABASE_URL="file:./dev.db"
```

Produktion eller compose-kørsel kan bruge PostgreSQL:

```bash
DATABASE_URL="postgresql://dch_spor:dch_spor@localhost:5432/dch_spor?schema=public"
npm run db:generate:postgres
npm run db:push:postgres
npm run db:seed
```

## Kvalitetskontrol

```bash
npm run typecheck
npm run lint
npm test
npm run test:vitest
npm run build
npm run build:next
```

`npm run build` bygger real-previewen. `npm test` kører den deterministiske domæne-testpakke via TSX. `npm run test:vitest`, `npm run typecheck` og Next CLI-kørslerne er bevaret, men har hængt sporadisk i denne lokale Codex-session før brugbart output.

## Docker

```bash
docker compose up --build
```

Appen eksponeres på `http://localhost:3000`.

## Test

Unit tests dækker de centrale geometrikrav og ligger både som Vitest-specifikation i `src/domain/domain.test.ts` og som stabil Node/TSX-runner i `scripts/run-domain-tests.ts`.

Playwright-specifikationerne ligger i `tests/e2e/app.spec.ts` og dækker opret projekt, billed-/markflow, B-spor, auto-placering, validering, PNG-eksport og genåbning.
