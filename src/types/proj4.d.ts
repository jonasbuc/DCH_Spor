declare module "proj4" {
  type PointTuple = [number, number];

  type Proj4Static = {
    (fromProjection: string, toProjection: string, coordinate: PointTuple): PointTuple;
    defs(name: string, definition: string): void;
  };

  const proj4: Proj4Static;
  export default proj4;
}
