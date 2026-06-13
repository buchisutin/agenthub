import { TaskType } from "../../shared/types.js";

export interface PlannedTask {
  id: string;
  title: string;
  description: string;
  task_type: TaskType;
  expected_output: string;
  affected_files: string[];
  suggested_agent: string | null;
  priority: number;
  depends_on: string[];
}

type TaskState = "pending" | "running" | "completed" | "failed" | "blocked";

export interface DagPreview {
  levels: PlannedTask[][];
  text: string;
}

export function findDagCycle(tasks: PlannedTask[]): string[] | null {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const visiting: string[] = [];
  const visited = new Set<string>();

  const visit = (taskId: string): string[] | null => {
    if (visited.has(taskId)) {
      return null;
    }
    const activeIndex = visiting.indexOf(taskId);
    if (activeIndex >= 0) {
      return [...visiting.slice(activeIndex), taskId];
    }

    visiting.push(taskId);
    const task = tasksById.get(taskId);
    for (const dependencyId of task?.depends_on ?? []) {
      if (!tasksById.has(dependencyId)) {
        continue;
      }
      const cycle = visit(dependencyId);
      if (cycle) {
        return cycle;
      }
    }
    visiting.pop();
    visited.add(taskId);
    return null;
  };

  for (const task of tasks) {
    const cycle = visit(task.id);
    if (cycle) {
      return cycle;
    }
  }
  return null;
}

export function buildDagPreview(tasks: PlannedTask[]): DagPreview {
  const cycle = findDagCycle(tasks);
  if (cycle) {
    throw new Error(`cyclic dependency detected: ${cycle.join(" -> ")}`);
  }

  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const remaining = new Map(tasks.map((task) => [task.id, new Set(task.depends_on)]));
  const completed = new Set<string>();
  const levels: PlannedTask[][] = [];

  while (remaining.size > 0) {
    const ready = tasks
      .filter((task) => remaining.has(task.id))
      .filter((task) => Array.from(remaining.get(task.id) ?? []).every((id) => completed.has(id)));
    if (ready.length === 0) {
      throw new Error("Unable to build DAG preview");
    }
    levels.push(ready);
    for (const task of ready) {
      remaining.delete(task.id);
      completed.add(task.id);
    }
  }

  const text = levels
    .map((level, index) => {
      const lines = level.map((task) => {
        const dependencyText =
          task.depends_on.length > 0 ? ` depends on ${task.depends_on.join(",")}` : "";
        return `  ${task.id} ${task.title}${dependencyText}`;
      });
      return [`Layer ${index + 1}:`, ...lines].join("\n");
    })
    .join("\n\n");

  for (const task of tasks) {
    if (!tasksById.has(task.id)) {
      throw new Error(`Unknown task: ${task.id}`);
    }
  }

  return { levels, text };
}

export class DagScheduler {
  private readonly tasksById = new Map<string, PlannedTask>();
  private readonly dependentsById = new Map<string, string[]>();
  private readonly stateById = new Map<string, TaskState>();
  private readonly startOrder: string[];
  private allCompletedNotified = false;

  constructor(
    tasks: PlannedTask[],
    private readonly onStartTask: (task: PlannedTask) => Promise<void>,
    private readonly onAllCompleted: () => void,
    private readonly onTaskBlocked: (task: PlannedTask, reason: string) => void,
  ) {
    this.startOrder = tasks.map((task) => task.id);
    for (const task of tasks) {
      this.tasksById.set(task.id, task);
      this.dependentsById.set(task.id, []);
      this.stateById.set(task.id, "pending");
    }
    for (const task of tasks) {
      for (const dependencyId of task.depends_on) {
        const dependents = this.dependentsById.get(dependencyId);
        if (dependents) {
          dependents.push(task.id);
        }
      }
    }
    const cycle = findDagCycle(tasks);
    if (cycle) {
      throw new Error(`cyclic dependency detected: ${cycle.join(" -> ")}`);
    }
  }

  async start(): Promise<void> {
    if (this.tasksById.size === 0) {
      this.notifyAllCompletedIfNeeded();
      return;
    }

    const rootTasks = this.startOrder
      .map((taskId) => this.tasksById.get(taskId))
      .filter((task): task is PlannedTask => Boolean(task))
      .filter((task) => task.depends_on.length === 0);
    await Promise.all(rootTasks.map((task) => this.startTask(task)));
  }

  async notifyCompleted(taskId: string): Promise<void> {
    const current = this.stateById.get(taskId);
    if (!current || current === "completed" || current === "failed" || current === "blocked") {
      return;
    }
    this.stateById.set(taskId, "completed");

    const readyTasks = (this.dependentsById.get(taskId) ?? [])
      .map((dependentId) => this.tasksById.get(dependentId))
      .filter((task): task is PlannedTask => Boolean(task))
      .filter((task) => this.stateById.get(task.id) === "pending")
      .filter((task) =>
        task.depends_on.every((dependencyId) => this.stateById.get(dependencyId) === "completed"),
      );

    await Promise.all(readyTasks.map((task) => this.startTask(task)));
    this.notifyAllCompletedIfNeeded();
  }

  async notifyFailed(taskId: string): Promise<void> {
    const current = this.stateById.get(taskId);
    if (!current || current === "completed" || current === "failed") {
      return;
    }
    this.stateById.set(taskId, "failed");
    this.blockDependents(taskId, `Dependency ${taskId} failed`);
    this.notifyAllCompletedIfNeeded();
  }

  private async startTask(task: PlannedTask): Promise<void> {
    if (this.stateById.get(task.id) !== "pending") {
      return;
    }
    this.stateById.set(task.id, "running");
    await this.onStartTask(task);
  }

  private blockDependents(taskId: string, reason: string): void {
    for (const dependentId of this.dependentsById.get(taskId) ?? []) {
      const current = this.stateById.get(dependentId);
      if (!current || current === "completed" || current === "failed" || current === "blocked") {
        continue;
      }
      this.stateById.set(dependentId, "blocked");
      const task = this.tasksById.get(dependentId);
      if (task) {
        this.onTaskBlocked(task, reason);
      }
      this.blockDependents(dependentId, `Dependency chain blocked by ${taskId}`);
    }
  }

  private notifyAllCompletedIfNeeded(): void {
    if (this.allCompletedNotified) {
      return;
    }
    const allTerminal = Array.from(this.stateById.values()).every((state) =>
      state === "completed" || state === "failed" || state === "blocked",
    );
    if (!allTerminal) {
      return;
    }
    this.allCompletedNotified = true;
    this.onAllCompleted();
  }

}
