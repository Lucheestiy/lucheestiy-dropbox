/**
 * EXIF Search Modal Component
 *
 * Provides a modal interface for searching images by EXIF metadata.
 */

import { api } from "../services/api";
import { showToast } from "../utils/toast";

export interface EXIFSearchCriteria {
  camera_make?: string;
  camera_model?: string;
  iso_min?: number;
  iso_max?: number;
  date_from?: string;
  date_to?: string;
  has_gps?: boolean;
  keywords?: string[];
}

export interface EXIFSearchResult {
  path: string;
  name: string;
  exif: Record<string, unknown>;
}

/**
 * Create and show the EXIF search modal
 */
export function showEXIFSearchModal(
  shareHash: string,
  onSearch: (results: EXIFSearchResult[]) => void
): void {
  const modal = createEXIFSearchModal(shareHash, onSearch);
  document.body.appendChild(modal);
  modal.showModal();
}

/**
 * Create the EXIF search modal element
 */
function createEXIFSearchModal(
  shareHash: string,
  onSearch: (results: EXIFSearchResult[]) => void
): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.className = "modal";
  dialog.setAttribute("aria-labelledby", "exif-search-title");

  dialog.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="exif-search-title">Search by EXIF Metadata</h2>
        <button
          type="button"
          class="modal-close"
          aria-label="Close EXIF search"
        >
          &times;
        </button>
      </div>
      <div class="modal-body">
        <form id="exif-search-form">
          <div class="form-group">
            <label for="exif-camera-make">Camera Make</label>
            <input
              type="text"
              id="exif-camera-make"
              placeholder="e.g., Canon, Nikon, Sony"
              autocomplete="off"
            />
          </div>

          <div class="form-group">
            <label for="exif-camera-model">Camera Model</label>
            <input
              type="text"
              id="exif-camera-model"
              placeholder="e.g., EOS 5D Mark IV"
              autocomplete="off"
            />
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="exif-iso-min">Min ISO</label>
              <input
                type="number"
                id="exif-iso-min"
                placeholder="100"
                min="0"
                step="100"
              />
            </div>

            <div class="form-group">
              <label for="exif-iso-max">Max ISO</label>
              <input
                type="number"
                id="exif-iso-max"
                placeholder="6400"
                min="0"
                step="100"
              />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="exif-date-from">Date From</label>
              <input
                type="date"
                id="exif-date-from"
              />
            </div>

            <div class="form-group">
              <label for="exif-date-to">Date To</label>
              <input
                type="date"
                id="exif-date-to"
              />
            </div>
          </div>

          <div class="form-group">
            <label>
              <input
                type="checkbox"
                id="exif-has-gps"
              />
              <span>Only show images with GPS data</span>
            </label>
          </div>

          <div class="form-group">
            <label for="exif-keywords">Keywords (comma-separated)</label>
            <input
              type="text"
              id="exif-keywords"
              placeholder="vacation, beach, sunset"
              autocomplete="off"
            />
          </div>

          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" id="exif-reset-btn">
              Reset
            </button>
            <button type="submit" class="btn btn-primary">
              Search
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Get form elements
  const form = dialog.querySelector("#exif-search-form") as HTMLFormElement;
  const closeBtn = dialog.querySelector(".modal-close") as HTMLButtonElement;
  const resetBtn = dialog.querySelector("#exif-reset-btn") as HTMLButtonElement;

  const cameraMakeInput = dialog.querySelector("#exif-camera-make") as HTMLInputElement;
  const cameraModelInput = dialog.querySelector("#exif-camera-model") as HTMLInputElement;
  const isoMinInput = dialog.querySelector("#exif-iso-min") as HTMLInputElement;
  const isoMaxInput = dialog.querySelector("#exif-iso-max") as HTMLInputElement;
  const dateFromInput = dialog.querySelector("#exif-date-from") as HTMLInputElement;
  const dateToInput = dialog.querySelector("#exif-date-to") as HTMLInputElement;
  const hasGpsInput = dialog.querySelector("#exif-has-gps") as HTMLInputElement;
  const keywordsInput = dialog.querySelector("#exif-keywords") as HTMLInputElement;

  // Close button handler
  closeBtn.addEventListener("click", () => {
    dialog.close();
    dialog.remove();
  });

  // Reset button handler
  resetBtn.addEventListener("click", () => {
    form.reset();
  });

  // Form submit handler
  form.addEventListener("submit", async (e: Event) => {
    e.preventDefault();

    // Build search criteria
    const criteria: EXIFSearchCriteria = {};

    if (cameraMakeInput.value.trim()) {
      criteria.camera_make = cameraMakeInput.value.trim();
    }
    if (cameraModelInput.value.trim()) {
      criteria.camera_model = cameraModelInput.value.trim();
    }
    if (isoMinInput.value) {
      criteria.iso_min = parseInt(isoMinInput.value, 10);
    }
    if (isoMaxInput.value) {
      criteria.iso_max = parseInt(isoMaxInput.value, 10);
    }
    if (dateFromInput.value) {
      criteria.date_from = new Date(dateFromInput.value).toISOString();
    }
    if (dateToInput.value) {
      criteria.date_to = new Date(dateToInput.value).toISOString();
    }
    if (hasGpsInput.checked) {
      criteria.has_gps = true;
    }
    if (keywordsInput.value.trim()) {
      criteria.keywords = keywordsInput.value
        .split(",")
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
    }

    // Validate at least one criterion
    if (Object.keys(criteria).length === 0) {
      showToast("Please enter at least one search criterion", "warning");
      return;
    }

    try {
      // Perform search
      const response = await api.post<{ results: EXIFSearchResult[]; total: number }>(
        `/api/share/${shareHash}/exif-search`,
        criteria
      );

      showToast(`Found ${response.total} matching images`, "success");
      onSearch(response.results);

      dialog.close();
      dialog.remove();
    } catch (error) {
      console.error("EXIF search failed:", error);
      showToast("EXIF search failed. Please try again.", "error");
    }
  });

  // Close on backdrop click
  dialog.addEventListener("click", (e: MouseEvent) => {
    if (e.target === dialog) {
      dialog.close();
      dialog.remove();
    }
  });

  // Close on Escape key
  dialog.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      dialog.close();
      dialog.remove();
    }
  });

  return dialog;
}

/**
 * Fetch unique camera models in a share
 */
export async function fetchCameraModels(shareHash: string): Promise<string[]> {
  try {
    const response = await api.get<{ cameras: string[] }>(`/api/share/${shareHash}/exif-cameras`);
    return response.cameras;
  } catch (error) {
    console.error("Failed to fetch camera models:", error);
    return [];
  }
}
