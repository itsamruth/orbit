import type { Project } from "../protocol/index.js";
import type { GitRepository } from "../storage/git/index.js";
export interface CommandContext {
  command: string;
  args: string[];
  repo: GitRepository;
  pid: string;
  root: string;
  project: Project;
}
