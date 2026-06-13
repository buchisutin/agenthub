import { Router } from "express";
import { AssignmentsService } from "../assignments/assignments.service.js";
import { ConversationsService } from "../conversations/conversations.service.js";
import { RunsService } from "../runs/runs.service.js";
import { RunManager } from "../../runtime/manager/run-manager.js";
import { TasksService } from "./tasks.service.js";

export function createTasksRouter(
  conversationsService: ConversationsService,
  tasksService: TasksService,
  assignmentsService: AssignmentsService,
  runsService: RunsService,
  runManager: RunManager,
): Router {
  const router = Router();

  function buildTaskDetail(taskId: string) {
    const task = tasksService.getById(taskId);
    if (!task) {
      return null;
    }

    const assignments = assignmentsService.listAssignmentsByTask(task.id);
    const latestAssignment =
      assignments.find((assignment) => assignment.latest_run_id) ?? assignments[0] ?? null;
    const latestRun = latestAssignment?.latest_run_id
      ? runsService.getById(latestAssignment.latest_run_id)
      : null;

    return {
      task,
      assignments,
      latestRun,
    };
  }

  router.get("/conversations/:conversationId/tasks", (req, res) => {
    const conversation = conversationsService.getById(req.params.conversationId);
    if (!conversation) {
      res.status(404).json({ detail: "Conversation not found" });
      return;
    }

    res.json(tasksService.listByConversation(req.params.conversationId));
  });

  router.get("/tasks/:taskId", (req, res) => {
    const detail = buildTaskDetail(req.params.taskId);
    if (!detail) {
      res.status(404).json({ detail: "Task not found" });
      return;
    }

    res.json({
      ...detail.task,
      assignments: detail.assignments,
      latestRun: detail.latestRun,
    });
  });

  router.get("/tasks/:taskId/detail", (req, res) => {
    const detail = buildTaskDetail(req.params.taskId);
    if (!detail) {
      res.status(404).json({ detail: "Task not found" });
      return;
    }

    res.json(detail);
  });

  router.get("/tasks/:taskId/assignments", (req, res) => {
    const task = tasksService.getById(req.params.taskId);
    if (!task) {
      res.status(404).json({ detail: "Task not found" });
      return;
    }

    res.json(assignmentsService.listAssignmentsByTask(task.id));
  });

  router.get("/conversations/:conversationId/assignments", (req, res) => {
    const conversation = conversationsService.getById(req.params.conversationId);
    if (!conversation) {
      res.status(404).json({ detail: "Conversation not found" });
      return;
    }

    res.json(assignmentsService.listAssignmentsByConversation(req.params.conversationId));
  });

  router.patch("/tasks/:taskId/status", (req, res) => {
    const detail = buildTaskDetail(req.params.taskId);
    if (!detail) {
      res.status(404).json({ detail: "Task not found" });
      return;
    }

    const status = req.body?.status;
    if (status !== "cancelled") {
      res.status(400).json({ detail: "Only cancelled status is supported" });
      return;
    }

    const latestRunStatus = detail.latestRun?.status ?? null;
    if (detail.task.status === "completed") {
      res.status(400).json({ detail: "Completed task cannot be cancelled" });
      return;
    }
    if (detail.task.status === "running" || latestRunStatus === "running" || latestRunStatus === "queued") {
      res.status(400).json({ detail: "Task is running, please interrupt the run first" });
      return;
    }

    tasksService.updateTaskStatus(detail.task.id, "cancelled");
    const assignment = detail.assignments[0];
    if (assignment) {
      assignmentsService.updateAssignmentStatus(assignment.id, "cancelled");
    }
    res.json(tasksService.getById(detail.task.id));
  });

  router.post("/tasks/:taskId/rerun", (req, res) => {
    const detail = buildTaskDetail(req.params.taskId);
    if (!detail) {
      res.status(404).json({ detail: "Task not found" });
      return;
    }

    const assignment = detail.assignments[0];
    if (!assignment) {
      res.status(400).json({ detail: "Task assignment not found" });
      return;
    }

    const latestRunStatus = detail.latestRun?.status ?? null;
    if (detail.task.status === "running" || latestRunStatus === "running" || latestRunStatus === "queued") {
      res.status(400).json({ detail: "Task is already running" });
      return;
    }

    try {
      const run = runManager.createRun({
        conversationId: assignment.conversation_id,
        agentId:
          typeof req.body?.agentId === "string" && req.body.agentId
            ? req.body.agentId
            : assignment.agent_id,
        prompt: detail.task.description || detail.task.title,
        taskId: detail.task.id,
        assignmentId: assignment.id,
        sourceMessageId: detail.task.plan_message_id ?? detail.task.source_message_id ?? undefined,
      });
      assignmentsService.prepareAssignmentRerun(assignment.id, {
        agentId:
          typeof req.body?.agentId === "string" && req.body.agentId
            ? req.body.agentId
            : assignment.agent_id,
        latestRunId: run.id,
        status: "pending",
      });
      tasksService.updateTaskStatus(detail.task.id, "assigned");

      res.status(200).json({
        task: tasksService.getById(detail.task.id),
        assignment: assignmentsService.getAssignment(assignment.id),
        run: runsService.getDetail(run.id),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to rerun task";
      const status = /not found/i.test(message) ? 404 : 400;
      res.status(status).json({ detail: message });
    }
  });

  return router;
}
