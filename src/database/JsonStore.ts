import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export class JsonStore<T> {
  constructor(
    private readonly filePath: string,
    private readonly defaultValue: T,
  ) {}

  async ensure(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, "utf8");
    } catch {
      await writeFile(this.filePath, JSON.stringify(this.defaultValue, null, 2), "utf8");
    }
  }

  async read(): Promise<T> {
    await this.ensure();
    const raw = await readFile(this.filePath, "utf8");
    return JSON.parse(raw) as T;
  }

  async write(value: T): Promise<void> {
    await this.ensure();
    await writeFile(this.filePath, JSON.stringify(value, null, 2), "utf8");
  }

  async update(mutator: (current: T) => T | Promise<T>): Promise<T> {
    const current = await this.read();
    const next = await mutator(current);
    await this.write(next);
    return next;
  }
}
