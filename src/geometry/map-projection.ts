import proj4 from "proj4";
import type { Coordinate, FieldMapReference } from "@/domain/types";

proj4.defs(
  "EPSG:25832",
  "+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs"
);

type LatLon = {
  lat: number;
  lon: number;
};

type EastingNorthing = {
  easting: number;
  northing: number;
};

export function latLonToEastingNorthing(point: LatLon): EastingNorthing {
  const [easting, northing] = proj4("EPSG:4326", "EPSG:25832", [point.lon, point.lat]);
  return { easting, northing };
}

export function eastingNorthingToLatLon(point: EastingNorthing): LatLon {
  const [lon, lat] = proj4("EPSG:25832", "EPSG:4326", [point.easting, point.northing]);
  return { lat, lon };
}

export function latLonToLocalMeters(point: LatLon, reference: FieldMapReference): Coordinate {
  const projected = latLonToEastingNorthing(point);
  return {
    x: projected.easting - reference.originEasting,
    y: reference.originNorthing - projected.northing
  };
}

export function localMetersToLatLon(point: Coordinate, reference: FieldMapReference): LatLon {
  return eastingNorthingToLatLon({
    easting: reference.originEasting + point.x,
    northing: reference.originNorthing - point.y
  });
}

export function createMapReference(input: {
  centerLat: number;
  centerLon: number;
  zoom: number;
  address?: string;
}): FieldMapReference {
  const origin = latLonToEastingNorthing({ lat: input.centerLat, lon: input.centerLon });

  return {
    provider: "openstreetmap",
    projection: "EPSG:25832",
    centerLat: input.centerLat,
    centerLon: input.centerLon,
    zoom: input.zoom,
    originEasting: origin.easting,
    originNorthing: origin.northing,
    address: input.address
  };
}
