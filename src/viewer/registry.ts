import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export interface ViewerProject {
  projectId: string;
  root: string;
}

export function viewerHome() {
  return process.env.ORBIT_VIEWER_HOME ?? join(homedir(), ".orbit", "viewer");
}

export async function registerProject(root: string, projectId: string) {
  if (!/^prj_[a-zA-Z0-9_-]+$/.test(projectId))
    throw new Error("Invalid project ID");
  const entry: ViewerProject = { projectId, root: await realpath(root) };
  const directory = join(viewerHome(), "projects");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, projectId + ".json");
  const body = JSON.stringify(entry) + "\n";
  if ((await readFile(path, "utf8").catch(() => "")) === body) return;
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, body, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function registeredProjects(): Promise<ViewerProject[]> {
  const directory = join(viewerHome(), "projects");
  const files = await readdir(directory).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const result: ViewerProject[] = [];
  for (const file of files.sort()) {
    if (!/^prj_[a-zA-Z0-9_-]+\.json$/.test(file)) continue;
    const entry = JSON.parse(
      await readFile(join(directory, file), "utf8"),
    ) as ViewerProject;
    if (
      entry.projectId + ".json" !== file ||
      typeof entry.root !== "string" ||
      !isAbsolute(entry.root)
    )
      throw new Error("Invalid local dashboard project registration");
    result.push(entry);
  }
  return result;
}
