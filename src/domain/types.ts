export type Coordinate = {
  x: number;
  y: number;
};

export type Axis = "x" | "y";

export type FieldPolygon = Coordinate[];

export type CalibrationMethod = "distance" | "area" | "dimensions";

export type Calibration = {
  method: CalibrationMethod;
  meterPerPixel: number;
  knownDistanceMeters?: number;
  knownAreaM2?: number;
  knownWidthMeters?: number;
  knownHeightMeters?: number;
  calculatedAreaM2?: number;
  deviationPercent?: number;
  warningDa?: string;
};

export type FieldBackgroundImage = {
  originalName: string;
  mimeType: string;
  byteSize: number;
  storageKey: string;
  url: string;
  widthPixels: number;
  heightPixels: number;
  x: number;
  y: number;
  widthMeters: number;
  heightMeters: number;
  rotationDegrees: number;
  opacity: number;
  crop: {
    topPercent: number;
    rightPercent: number;
    bottomPercent: number;
    leftPercent: number;
  };
};

export type FieldMapReference = {
  provider: "openstreetmap";
  projection: "EPSG:25832";
  centerLat: number;
  centerLon: number;
  zoom: number;
  originEasting: number;
  originNorthing: number;
  address?: string;
};

export type TrackObject = {
  id: string;
  displayNo: number;
  distanceAlongTrackMeters: number;
  material: string;
  description?: string;
  marksFinish?: boolean;
};

export type Track = {
  id: string;
  displayNo: number;
  name: string;
  templateCode?: string;
  trackType?: string;
  color: string;
  points: Coordinate[];
  lengthSteps: number;
  stepLengthMeters: number;
  lengthMeters: number;
  rotationDegrees: number;
  lockedLength: boolean;
  lockedAngles: boolean;
  objects: TrackObject[];
};

export type RestrictedArea =
  | {
      id: string;
      name: string;
      type: "polygon";
      areaType: string;
      description?: string;
      safetyDistanceMeters: number;
      color: string;
      active: boolean;
      polygon: Coordinate[];
    }
  | {
      id: string;
      name: string;
      type: "line";
      areaType: string;
      description?: string;
      safetyDistanceMeters: number;
      color: string;
      active: boolean;
      line: Coordinate[];
    }
  | {
      id: string;
      name: string;
      type: "circle";
      areaType: string;
      description?: string;
      safetyDistanceMeters: number;
      color: string;
      active: boolean;
      center: Coordinate;
      radiusMeters: number;
    };

export type TrackTemplateRules = {
  code: string;
  name: string;
  lengthSteps: number;
  stepLengthMeters: number;
  lengthMeters: number;
  turnCount: number;
  turnAngleDegrees: number;
  turnAnglesDegrees?: number[];
  minMiddleSegmentSteps: number;
  minMiddleSegmentMeters: number;
  objectCount: number;
  minTrackSpacingSteps: number;
  minTrackSpacingMeters: number;
  trackAgeInfo: string;
  startMarkers: number;
  objectMaterial: string;
  minLastObjectToFinishMeters: number;
  minObjectDistanceFromTurnMeters: number;
  angleToleranceDegrees: number;
  lengthToleranceMeters: number;
};

export type ProjectField = {
  id: string;
  name: string;
  sourceType: "image" | "map";
  backgroundImage?: FieldBackgroundImage;
  mapReference?: FieldMapReference;
  areaM2: number;
  areaHa: number;
  polygon: FieldPolygon;
  perimeterMeters: number;
  calibration?: Calibration;
};

export type ProjectSnapshot = {
  id: string;
  name: string;
  club: string;
  eventName: string;
  eventDate?: string;
  description: string;
  notes: string;
  requestedTrackCount: number;
  edgeMarginMeters: number;
  minimumTrackSpacingMeters: number;
  field: ProjectField;
  restrictedAreas: RestrictedArea[];
  template: TrackTemplateRules;
  templates?: TrackTemplateRules[];
  tracks: Track[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ValidationSeverity = "error" | "warning" | "info";

export type ValidationMessage = {
  code: string;
  severity: ValidationSeverity;
  messageDa: string;
  trackId?: string;
  relatedTrackId?: string;
  position?: Coordinate;
  actualValue?: number;
  requiredValue?: number;
  unit?: string;
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
  measurements: {
    totalLengthMeters: number;
    totalLengthSteps: number;
    segmentLengthsMeters: number[];
    turnAnglesDegrees: number[];
    nearestTrackDistanceMeters?: number;
    nearestBoundaryDistanceMeters?: number;
  };
};

export type ProjectValidationResult = {
  valid: boolean;
  tracks: Record<string, ValidationResult>;
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
};

export type TurnDirection = "left" | "right";

export type TrackCandidateShape = {
  firstTurn: TurnDirection;
  secondTurn: TurnDirection;
  segmentLengthsMeters: [number, number, number];
};

export type PlacementOptions = {
  requestedTrackCount: number;
  edgeMarginMeters: number;
  minimumTrackSpacingMeters: number;
  preferredDirectionDegrees: number;
  allowMirror: boolean;
  alternateStartDirections: boolean;
  placeInRows: boolean;
  sameShape: boolean;
  varySegmentLengths: boolean;
  seed: number;
};

export type PlacementResult = {
  labelDa: "Bedste fundne forslag";
  tracks: Track[];
  requestedTrackCount: number;
  placedTrackCount: number;
  durationMs: number;
  score: number;
  candidatesEvaluated: number;
  rejectedReasons: Record<string, number>;
};
