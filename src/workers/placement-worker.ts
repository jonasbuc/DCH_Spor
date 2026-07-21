import type { PlacementOptions, PlacementResult, ProjectSnapshot } from "@/domain/types";
import { autoPlaceTracks } from "@/geometry/placement/auto-placement";

type PlacementWorkerRequest = {
  project: ProjectSnapshot;
  options: PlacementOptions;
};

type PlacementWorkerResponse =
  | { type: "progress"; stage: string }
  | { type: "done"; result: PlacementResult }
  | { type: "error"; message: string };

self.onmessage = (event: MessageEvent<PlacementWorkerRequest>) => {
  try {
    postWorkerMessage({ type: "progress", stage: "Worker genererer kandidatplaceringer ..." });
    const result = autoPlaceTracks(event.data.project, event.data.options);
    postWorkerMessage({ type: "done", result });
  } catch (error) {
    postWorkerMessage({ type: "error", message: error instanceof Error ? error.message : "Workerplacering fejlede." });
  }
};

function postWorkerMessage(message: PlacementWorkerResponse) {
  self.postMessage(message);
}
