import { stubFalse } from "lodash";
import { WorkerPoolAdapter } from "../worker_pool_adapter";

interface Methods {
  scanDir(dir: string): false | string[];
  fileExists(path: string): boolean;
}

class Scanner extends WorkerPoolAdapter<Methods> {
  constructor() {
    super(__dirname + '/scanner_worker.js', { });
  }

  async scanDir(dir: string) {
    return this.exec('scanDir', dir).catch(stubFalse);
  }

  async fileExists(path: string) {
    return this.exec('fileExists', path).catch(stubFalse);
  }
}

let instance: Scanner;

function getDefaultInstance() {
  if (!instance) {
    instance = new Scanner();
  }

  return instance;
}

export async function scanDir(dir: string) {
  return getDefaultInstance().scanDir(dir);
}

export async function fileExists(path: string) {
  return getDefaultInstance().fileExists(path);
}
