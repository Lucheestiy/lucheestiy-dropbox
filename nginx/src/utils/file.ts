export function validateFileReadable(
  file: File,
  opts: { timeoutMs?: number } = {}
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs || 10000;

  return new Promise((resolve) => {
    if (!file) {
      resolve(false);
      return;
    }

    // 0-size files with no type are highly suspicious (iOS placeholders)
    if (file.size === 0 && !file.type) {
      resolve(false);
      return;
    }

    const reader = new FileReader();
    const timer = window.setTimeout(() => {
      reader.abort();
      resolve(false);
    }, timeoutMs);

    reader.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };
    reader.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };

    try {
      // Read just the first few bytes to check readability
      reader.readAsArrayBuffer(file.slice(0, 4096));
    } catch (e) {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

export function isIOSDevice(): boolean {
  return (
    ["iPad Simulator", "iPhone Simulator", "iPod Simulator", "iPad", "iPhone", "iPod"].includes(
      navigator.platform
    ) ||
    // iPad on iOS 13 detection
    (navigator.userAgent.includes("Mac") && "ontouchend" in document)
  );
}

export function hasAnyZeroSize(files: File[]): boolean {
  for (let i = 0; i < files.length; i++) {
    if (files[i].size === 0 && !files[i].type) return true;
  }
  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
