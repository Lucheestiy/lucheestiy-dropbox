import { IcloudWaitModal } from "../components/Panel/IcloudWaitModal";
import { isIOSDevice, hasAnyZeroSize, validateFileReadable, sleep } from "../utils/file";

interface GateToken {
  canceled: boolean;
}

export class IcloudGateService {
  private fileInputBypass = false;
  private currentGate: GateToken | null = null;
  private modal = new IcloudWaitModal();

  constructor() {
    this.patchFileInputs();
  }

  private patchFileInputs() {
    document.addEventListener(
      "change",
      (e) => {
        const input = e.target as HTMLInputElement;
        if (!input || input.type !== "file" || !input.files || input.files.length === 0) return;
        if (this.fileInputBypass) return;

        const files = Array.from(input.files);
        const shouldGate = isIOSDevice() || hasAnyZeroSize(files);
        if (!shouldGate) return;

        // Block FileBrowser from starting the upload until iOS/iCloud has a fully-readable file.
        e.stopImmediatePropagation();
        e.preventDefault();

        if (this.currentGate) {
          this.currentGate.canceled = true;
        }

        const gate: GateToken = { canceled: false };
        this.currentGate = gate;

        let overlayVisible = false;
        const overlayTimer = window.setTimeout(() => {
          if (gate.canceled || this.currentGate !== gate) return;
          this.modal.show();
          overlayVisible = true;
          this.modal.onCancel(() => {
            gate.canceled = true;
            this.dismiss();
            try {
              input.value = "";
            } catch (_err) {
              /* ignore */
            }
          });
        }, 350);

        const setStatus = (text: string) => {
          if (overlayVisible && this.currentGate === gate) {
            this.modal.setStatus(text);
          }
        };

        this.waitForFilesReadable(files, gate, setStatus)
          .then((ok) => {
            if (this.currentGate !== gate) return;
            this.dismiss();
            if (gate.canceled) return;

            if (ok) {
              this.dispatchSyntheticChange(input);
            } else {
              const name = files[0]?.name || "";
              this.showFileNotReadyWarning(name);
              try {
                input.value = "";
              } catch (_err) {
                /* ignore */
              }
            }
          })
          .catch(() => {
            if (this.currentGate !== gate) return;
            this.dismiss();
            if (gate.canceled) return;
            const name = files[0]?.name || "";
            this.showFileNotReadyWarning(name);
            try {
              input.value = "";
            } catch (_err) {
              /* ignore */
            }
          })
          .finally(() => {
            clearTimeout(overlayTimer);
          });
      },
      true
    );
  }

  private async waitForFilesReadable(
    files: File[],
    token: GateToken,
    onStatus: (s: string) => void
  ): Promise<boolean> {
    const maxWaitMs = 20 * 60 * 1000;
    const start = Date.now();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const name = file.name || "file";
      let attempt = 0;

      while (true) {
        if (token.canceled) return false;
        if (Date.now() - start > maxWaitMs) return false;

        attempt++;
        const elapsed = Math.round((Date.now() - start) / 1000);
        onStatus(`Preparing ${i + 1}/${files.length}: ${name} (${elapsed}s)`);

        const ok = await validateFileReadable(file, { timeoutMs: 15000 });
        if (ok) break;
        if (token.canceled) return false;

        const delay = Math.min(8000, 600 + attempt * 450);
        await sleep(delay);
      }
    }
    return true;
  }

  private dismiss() {
    this.modal.dismiss();
  }

  private dispatchSyntheticChange(input: HTMLInputElement) {
    this.fileInputBypass = true;
    try {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } finally {
      // Use a timeout to ensure the event is processed before re-enabling the gate
      setTimeout(() => {
        this.fileInputBypass = false;
      }, 50);
    }
  }

  private showFileNotReadyWarning(name: string) {
    const WARNING_ID = "droppr-icloud-warning";
    const existing = document.getElementById(WARNING_ID);
    if (existing) return;

    const el = document.createElement("div");
    el.id = WARNING_ID;
    el.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: #ef4444;
      color: #fff;
      padding: 12px 20px;
      border-radius: 12px;
      font: 700 14px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      box-shadow: 0 20px 40px rgba(0,0,0,0.4);
    `;
    el.innerHTML = `
      <div style="margin-bottom:4px;">File not ready: ${name}</div>
      <div style="font-weight:400;font-size:12px;opacity:0.9;">Please wait for the file to download from iCloud before uploading.</div>
    `;
    document.body.appendChild(el);
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 6000);
  }
}

export const icloudGateService = new IcloudGateService();
