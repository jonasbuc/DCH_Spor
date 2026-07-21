import { apiError, apiErrorFromUnknown, apiOk } from "@/server/api-response";

type NominatimResult = {
  display_name: string;
  lat: string;
  lon: string;
};

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get("query")?.trim();
    if (!query) {
      return apiError("INVALID_INPUT", "Skriv en adresse eller et stednavn.", 422);
    }

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "5");
    url.searchParams.set("addressdetails", "0");

    const response = await fetch(url, {
      headers: {
        "User-Agent": "DcH-Sporplanlaegger/1.0"
      }
    });

    if (!response.ok) {
      return apiError("INVALID_INPUT", "Adresseopslag kunne ikke gennemføres.", 502);
    }

    const results = (await response.json()) as NominatimResult[];
    return apiOk(
      results.map((result) => ({
        label: result.display_name,
        lat: Number(result.lat),
        lon: Number(result.lon)
      }))
    );
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
