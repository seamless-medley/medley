import { stubFalse } from "lodash";
import { globStream } from 'fast-glob';
import { WorkerPoolAdapter } from "../worker_pool_adapter";
import normalizePath from "normalize-path";
import { FileScanner, FileScanOptions } from "../collections";

interface Methods {
  scanDir(dir: string): false | string[];
}

class Scanner extends WorkerPoolAdapter<Methods> {
  constructor() {
    super(__dirname + '/scanner_worker.js', { });
  }

  async scanDir(dir: string) {
    return this.exec('scanDir', dir).catch(stubFalse);
  }
}

let instance: Scanner;

function getDefaultInstance() {
  if (!instance) {
    instance = new Scanner();
  }

  return instance;
}

export const scanDir: FileScanner = ({ dir, onFiles, onDone }) => getDefaultInstance().scanDir(dir).then(async files => {
  if (files === false) {
    return;
  }

  await onFiles(files).then(() => onDone());
  return true;
});

/**
 * This is a specialized version of `scanDir` function.
 * It provides scanned results in chunks as soon as possible.
 *
 * Streaming chunk of files
 *
 * This might be helpful for large directory whereas the large list of files are not deserialized at the main thread
 *
 * Although, this does not leverage the use of worker pool.
 */
export async function scanDirStream({ dir, chunkSize, onFiles, onDone }: FileScanOptions) {
  const s = globStream(
    `${normalizePath(dir)}/**/*`,
    {
      absolute: true,
      onlyFiles: true,
      braceExpansion: true,
      suppressErrors: true,
    }
  );

  let files: string[] = [];
  const promises: Promise<unknown>[] = [];

  const store = () => {
    promises.push(onFiles([...files]));
    files = [];
  }

  s.on('data', (file) => {
    files.push(file);

    if (files.length >= chunkSize) {
      store();
    }
  });

  s.on('end', async () => {
    if (files.length) {
      store();
    }

    await Promise.all(promises).then(onDone);
  });

  return true as const;
}
