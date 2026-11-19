import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { H3Ref } from "../types";
import { config } from "./config";
import { cleanTabs } from "./refTabs";

// Tab-Gruppen: gespeicherte Sätze aller Ref-Tabs („Strand-Video“, „Büro-Szene“ …), damit man für
// ein neues Video frische Tabs nehmen und die alten später wieder laden kann.

export interface RefTabGroup {
  id: string;
  name: string;
  tabs: H3Ref[][];
  savedAt: number;
}

export const GROUP_NAME_MAX = 60;
export const GROUPS_MAX = 100;

const file = () => config.dataPath("ref-tab-groups.json");

export async function listGroups(): Promise<RefTabGroup[]> {
  try {
    const data = JSON.parse(await fs.readFile(file(), "utf8")) as { groups?: RefTabGroup[] };
    return Array.isArray(data.groups) ? data.groups : [];
  } catch {
    return [];
  }
}

async function write(groups: RefTabGroup[]) {
  await fs.mkdir(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ groups }));
  await fs.rename(tmp, file());
}

// Schreibzugriffe nacheinander, damit sich zwei schnelle Klicks nicht überschreiben
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

export class GroupError extends Error {}

export const cleanName = (name: unknown) => (typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, GROUP_NAME_MAX) : "");

/** Speichern; gleicher Name (Groß/klein egal) = überschreiben. Neueste zuerst. */
export function saveGroup(nameIn: unknown, tabsIn: unknown): Promise<RefTabGroup> {
  return serial(async () => {
    const name = cleanName(nameIn);
    const tabs = cleanTabs(tabsIn);
    if (!name) throw new GroupError("Bitte einen Namen für die Tab-Gruppe angeben");
    if (!tabs) throw new GroupError("Ungültige Ref-Tabs");
    const groups = await listGroups();
    const old = groups.find((g) => g.name.toLowerCase() === name.toLowerCase());
    if (!old && groups.length >= GROUPS_MAX) throw new GroupError(`Höchstens ${GROUPS_MAX} Tab-Gruppen – bitte alte löschen`);
    const group: RefTabGroup = { id: old?.id ?? randomUUID().slice(0, 8), name, tabs, savedAt: Date.now() };
    await write([group, ...groups.filter((g) => g !== old)]);
    return group;
  });
}

export function deleteGroup(id: string): Promise<void> {
  return serial(async () => {
    const groups = await listGroups();
    await write(groups.filter((g) => g.id !== id));
  });
}
