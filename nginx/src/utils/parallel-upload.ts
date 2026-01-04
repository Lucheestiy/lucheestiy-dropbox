/**
 * Parallel Chunk Upload Utility
 *
 * Enables uploading multiple chunks of a file simultaneously for improved
 * upload performance, especially on high-bandwidth connections.
 */

export interface ParallelUploadConfig {
  chunkSize: number;
  maxParallelChunks: number;
  maxRetries: number;
  file: File;
  uploadUrl: string;
  headers?: Record<string, string>;
  relPath?: string;
  onProgress?: (loaded: number, total: number) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
  adaptiveChunkSizing?: boolean;
  minChunkSize?: number;
  maxChunkSize?: number;
}

interface ChunkInfo {
  index: number;
  start: number;
  end: number;
  blob: Blob;
  retries: number;
  uploaded: boolean;
}

interface ProgressTracker {
  chunks: Map<number, number>;
  total: number;
}

export class ParallelUploader {
  private config: ParallelUploadConfig;
  private chunks: ChunkInfo[] = [];
  private activeUploads: Set<number> = new Set();
  private completedChunks: Set<number> = new Set();
  private failedChunks: Set<number> = new Set();
  private uploadId: string = "";
  private progress: ProgressTracker;
  private startTime: number = 0;
  private aborted: boolean = false;
  private storageKey: string;
  private chunkSize: number;

  constructor(config: ParallelUploadConfig) {
    this.config = config;
    this.chunkSize = this._determineChunkSize();
    this.progress = {
      chunks: new Map(),
      total: config.file.size,
    };
    this.storageKey = `droppr_upload_parallel_${config.file.name}_${config.file.size}`;
    this.prepareChunks();
  }

  /**
   * Prepare chunks for upload
   */
  private prepareChunks(): void {
    const { file } = this.config;
    const totalChunks = Math.ceil(file.size / this.chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * this.chunkSize;
      const end = Math.min(start + this.chunkSize, file.size);
      const blob = file.slice(start, end);

      this.chunks.push({
        index: i,
        start,
        end,
        blob,
        retries: 0,
        uploaded: false,
      });
    }

    this.progress.total = file.size;
  }

  private _determineChunkSize(): number {
    const baseSize = this.config.chunkSize;
    if (!this.config.adaptiveChunkSizing) {
      return baseSize;
    }

    const minSize = Math.max(this.config.minChunkSize ?? 0, baseSize / 2, 256 * 1024);
    const maxSize =
      this.config.maxChunkSize && this.config.maxChunkSize > minSize
        ? this.config.maxChunkSize
        : Math.max(baseSize * 3, minSize);

    if (typeof navigator === "undefined") {
      return baseSize;
    }

    const connection =
      (navigator as Navigator & { connection?: NetworkInformation }).connection ?? null;

    if (!connection) {
      return baseSize;
    }

    const downlink = typeof connection.downlink === "number" ? connection.downlink : 0;
    const effectiveType = connection.effectiveType || "";

    let multiplier = 1;
    if (downlink >= 20) {
      multiplier = 2;
    } else if (downlink >= 10) {
      multiplier = 1.5;
    } else if (downlink >= 5) {
      multiplier = 1.25;
    } else if (downlink > 0 && downlink < 1) {
      multiplier = 0.6;
    } else if (downlink === 0) {
      multiplier = 0.9;
    }

    if (effectiveType.includes("2g")) {
      multiplier *= 0.6;
    } else if (effectiveType.includes("3g")) {
      multiplier *= 0.85;
    }

    const computed = Math.round(baseSize * multiplier);
    return Math.max(minSize, Math.min(maxSize, computed));
  }

  /**
   * Start the parallel upload
   */
  public async start(): Promise<void> {
    this.startTime = Date.now();
    this.aborted = false;

    // Try to resume from localStorage
    const savedSession = this.loadSession();
    if (savedSession) {
      this.uploadId = savedSession.uploadId;
      savedSession.completedChunks.forEach((idx) => {
        this.completedChunks.add(idx);
        this.chunks[idx].uploaded = true;
      });
    }

    try {
      await this.uploadChunksParallel();
      this.clearSession();
      if (this.config.onComplete) {
        this.config.onComplete();
      }
    } catch (error) {
      if (this.config.onError && !this.aborted) {
        this.config.onError(error as Error);
      }
      throw error;
    }
  }

  /**
   * Upload chunks in parallel with controlled concurrency
   */
  private async uploadChunksParallel(): Promise<void> {
    const pendingChunks = this.chunks.filter((chunk) => !chunk.uploaded);

    return new Promise((resolve, reject) => {
      let completed = 0;
      let hasError = false;

      const uploadNext = () => {
        if (hasError || this.aborted) return;

        // Find next chunk to upload
        const nextChunk = pendingChunks.find(
          (chunk) =>
            !chunk.uploaded &&
            !this.activeUploads.has(chunk.index) &&
            !this.failedChunks.has(chunk.index)
        );

        if (!nextChunk) {
          // No more chunks to upload
          if (this.activeUploads.size === 0) {
            // All uploads complete
            if (this.failedChunks.size > 0) {
              reject(new Error(`Failed to upload ${this.failedChunks.size} chunks`));
            } else {
              resolve();
            }
          }
          return;
        }

        // Upload the chunk
        this.activeUploads.add(nextChunk.index);

        this.uploadChunk(nextChunk)
          .then(() => {
            this.activeUploads.delete(nextChunk.index);
            this.completedChunks.add(nextChunk.index);
            nextChunk.uploaded = true;
            completed++;

            // Save progress
            this.saveSession();

            // Update progress
            const totalLoaded = Array.from(this.completedChunks).reduce((sum, idx) => {
              return sum + (this.chunks[idx].end - this.chunks[idx].start);
            }, 0);
            if (this.config.onProgress) {
              this.config.onProgress(totalLoaded, this.progress.total);
            }

            // Start next upload
            if (this.activeUploads.size < this.config.maxParallelChunks) {
              uploadNext();
            }
          })
          .catch((error) => {
            this.activeUploads.delete(nextChunk.index);

            // Retry logic
            if (nextChunk.retries < this.config.maxRetries) {
              nextChunk.retries++;
              // Exponential backoff
              const delay = Math.pow(2, nextChunk.retries) * 1000;
              setTimeout(() => uploadNext(), delay);
            } else {
              this.failedChunks.add(nextChunk.index);
              hasError = true;
              reject(error);
            }
          });

        // Start more uploads if slots available
        if (this.activeUploads.size < this.config.maxParallelChunks) {
          setTimeout(uploadNext, 0);
        }
      };

      // Start initial batch of uploads
      for (let i = 0; i < this.config.maxParallelChunks; i++) {
        uploadNext();
      }
    });
  }

  /**
   * Upload a single chunk
   */
  private uploadChunk(chunk: ChunkInfo): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", this.config.uploadUrl);
      xhr.timeout = 300000; // 5 minutes

      // Set headers
      xhr.setRequestHeader(
        "Content-Range",
        `bytes ${chunk.start}-${chunk.end - 1}/${this.progress.total}`
      );
      xhr.setRequestHeader("X-Upload-Offset", String(chunk.start));
      xhr.setRequestHeader("X-Upload-Length", String(this.progress.total));
      xhr.setRequestHeader("X-Chunk-Index", String(chunk.index));

      if (this.config.relPath) {
        xhr.setRequestHeader("X-Upload-Path", this.config.relPath);
      }

      if (this.uploadId) {
        xhr.setRequestHeader("X-Upload-Id", this.uploadId);
      }

      if (this.config.headers) {
        Object.entries(this.config.headers).forEach(([key, value]) => {
          xhr.setRequestHeader(key, value);
        });
      }

      // Track progress for this chunk
      xhr.upload.onprogress = (event: ProgressEvent) => {
        if (event.lengthComputable) {
          this.progress.chunks.set(chunk.index, event.loaded);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText || "{}");
            if (response.upload_id && !this.uploadId) {
              this.uploadId = response.upload_id;
            }
            resolve();
          } catch {
            resolve();
          }
        } else {
          reject(new Error(`Chunk upload failed: ${xhr.status}`));
        }
      };

      xhr.onerror = () => {
        reject(new Error("Network error during chunk upload"));
      };

      xhr.ontimeout = () => {
        reject(new Error("Chunk upload timeout"));
      };

      xhr.send(chunk.blob);
    });
  }

  /**
   * Abort the upload
   */
  public abort(): void {
    this.aborted = true;
    this.activeUploads.clear();
  }

  /**
   * Save upload session to localStorage for resumption
   */
  private saveSession(): void {
    try {
      const session = {
        uploadId: this.uploadId,
        completedChunks: Array.from(this.completedChunks),
        timestamp: Date.now(),
      };
      localStorage.setItem(this.storageKey, JSON.stringify(session));
    } catch {
      // Ignore localStorage errors
    }
  }

  /**
   * Load upload session from localStorage
   */
  private loadSession(): { uploadId: string; completedChunks: number[] } | null {
    try {
      const data = localStorage.getItem(this.storageKey);
      if (!data) return null;

      const session = JSON.parse(data);
      // Expire sessions older than 24 hours
      if (Date.now() - session.timestamp > 24 * 60 * 60 * 1000) {
        this.clearSession();
        return null;
      }

      return session;
    } catch {
      return null;
    }
  }

  /**
   * Clear upload session from localStorage
   */
  private clearSession(): void {
    try {
      localStorage.removeItem(this.storageKey);
    } catch {
      // Ignore localStorage errors
    }
  }

  /**
   * Get upload statistics
   */
  public getStats(): {
    totalChunks: number;
    completedChunks: number;
    activeUploads: number;
    failedChunks: number;
    speed: number;
    eta: number;
  } {
    const totalLoaded = Array.from(this.completedChunks).reduce((sum, idx) => {
      return sum + (this.chunks[idx].end - this.chunks[idx].start);
    }, 0);

    const elapsed = (Date.now() - this.startTime) / 1000;
    const speed = elapsed > 0 ? totalLoaded / elapsed : 0;
    const remaining = this.progress.total - totalLoaded;
    const eta = speed > 0 ? Math.round(remaining / speed) : 0;

    return {
      totalChunks: this.chunks.length,
      completedChunks: this.completedChunks.size,
      activeUploads: this.activeUploads.size,
      failedChunks: this.failedChunks.size,
      speed,
      eta,
    };
  }
}

/**
 * Helper function to detect optimal number of parallel connections
 * based on network conditions
 */
export function getOptimalParallelChunks(): number {
  // Use Network Information API if available
  if ("connection" in navigator) {
    const connection = (navigator as any).connection;
    if (connection) {
      const effectiveType = connection.effectiveType;

      // Adjust based on connection quality
      switch (effectiveType) {
        case "4g":
          return 6; // High quality connection
        case "3g":
          return 3; // Medium quality
        case "2g":
        case "slow-2g":
          return 1; // Poor connection, use sequential
        default:
          return 4; // Default
      }
    }
  }

  // Fallback to 4 parallel chunks
  return 4;
}
