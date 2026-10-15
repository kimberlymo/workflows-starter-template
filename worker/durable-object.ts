import { DurableObject } from "cloudflare:workers";
import type { FunctionStatistic } from "../src/types";

/**
 * WorkflowStatusDO - Durable Object for managing workflow state and WebSocket connections
 *
 * Responsibilities:
 * - Accept and manage WebSocket connections using hibernation API
 * - Track step statuses for a workflow instance
 * - Broadcast updates to all connected clients
 * - Provide RPC method for workflow to update step status
 */
export class WorkflowStatusDO extends DurableObject {
	private stepStatuses: Map<string, string>;
	private currentStep: string | null;
	private workflowStatus: "running" | "completed" | "error";
	private errorMessage: string | null;
	private functionStatistics: FunctionStatistic[];
	private finalOutput: unknown;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		this.stepStatuses = new Map();
		this.currentStep = null;
		this.workflowStatus = "running";
		this.errorMessage = null;
		this.functionStatistics = [];
		this.finalOutput = null;

		// Load state from durable storage to survive hibernation/eviction
		ctx.blockConcurrencyWhile(async () => {
			const storedStatuses =
				await ctx.storage.get<Record<string, string>>("stepStatuses");
			const storedCurrent = await ctx.storage.get<string | null>("currentStep");
			const storedWorkflowStatus = await ctx.storage.get<
				"running" | "completed" | "error"
			>("workflowStatus");
			const storedErrorMessage =
				await ctx.storage.get<string | null>("errorMessage");
			const storedFunctionStatistics =
				await ctx.storage.get<FunctionStatistic[]>("functionStatistics");
			this.finalOutput = await ctx.storage.get("finalOutput");

			if (storedStatuses) {
				this.stepStatuses = new Map(Object.entries(storedStatuses));
			}

			this.currentStep = storedCurrent ?? null;
			this.workflowStatus = storedWorkflowStatus ?? "running";
			this.errorMessage = storedErrorMessage ?? null;
			this.functionStatistics = storedFunctionStatistics ?? [];
		});
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") === "websocket") {
			const pair = new WebSocketPair();
			const [client, server] = Object.values(pair);

			// Use hibernation API - acceptWebSocket allows the DO to hibernate
			this.ctx.acceptWebSocket(server);

			// Send current state immediately upon connection
			server.send(JSON.stringify(this.getStateMessage()));

			return new Response(null, { status: 101, webSocket: client });
		}

		return new Response("Expected WebSocket", { status: 400 });
	}

	/**
	 * RPC method called by the workflow to update step status
	 * This is called via stub.updateStep() from the workflow
	 */
	async updateStep(
		stepName: string,
		status: string,
		errorMessage?: string,
	): Promise<void> {
		this.stepStatuses.set(stepName, status);

		if (status === "running" || status === "waiting") {
			this.currentStep = stepName;
			this.workflowStatus = "running";
			this.errorMessage = null;
		}

		if (status === "error") {
			this.workflowStatus = "error";
			this.currentStep = null;
			this.errorMessage = errorMessage ?? `Step "${stepName}" failed`;
		}

		await this.ctx.storage.put(
			"stepStatuses",
			Object.fromEntries(this.stepStatuses),
		);
		await this.ctx.storage.put("currentStep", this.currentStep);
		await this.ctx.storage.put("workflowStatus", this.workflowStatus);
		await this.ctx.storage.put("errorMessage", this.errorMessage);

		this.broadcast(this.getStateMessage());
	}

	async recordFunctionStatistic(
		statistic: FunctionStatistic,
		output?: unknown,
	): Promise<void> {
		this.functionStatistics = [
			...this.functionStatistics.filter(
				(item) => item.functionName !== statistic.functionName,
			),
			statistic,
		];
		if (output !== undefined) {
			this.finalOutput = output;
		}

		await this.ctx.storage.put("functionStatistics", this.functionStatistics);
		await this.ctx.storage.put("finalOutput", this.finalOutput);
		this.broadcast(this.getStateMessage());
	}

	async completeWorkflow(output: unknown): Promise<void> {
		this.workflowStatus = "completed";
		this.currentStep = null;
		this.errorMessage = null;
		this.finalOutput = output;

		await this.ctx.storage.put("currentStep", null);
		await this.ctx.storage.put("workflowStatus", this.workflowStatus);
		await this.ctx.storage.put("errorMessage", null);
		await this.ctx.storage.put("finalOutput", output);
		this.broadcast(this.getStateMessage());
	}

	/**
	 * WebSocket message handler (hibernation API)
	 * Called when a client sends a message
	 */
	async webSocketMessage(ws: WebSocket, _message: string): Promise<void> {
		ws.send(JSON.stringify(this.getStateMessage()));
	}

	/**
	 * WebSocket close handler (hibernation API)
	 * Called when a client closes the connection
	 */
	async webSocketClose(
		ws: WebSocket,
		code: number,
		reason: string,
		_wasClean: boolean,
	): Promise<void> {
		ws.close(code, reason);
	}

	/**
	 * Broadcast a message to all connected WebSocket clients
	 */
	private broadcast(message: object): void {
		const sockets = this.ctx.getWebSockets();
		const json = JSON.stringify(message);

		for (const socket of sockets) {
			try {
				socket.send(json);
			} catch {
				// Ignore errors for disconnected sockets
			}
		}
	}

	/**
	 * Get the current state as a message object
	 */
	private getStateMessage(): object {
		return {
			type: "workflow_update",
			currentStep: this.currentStep,
			stepStatuses: Object.fromEntries(this.stepStatuses),
			workflowStatus: this.workflowStatus,
			errorMessage: this.errorMessage,
			functionStatistics: this.functionStatistics,
			finalOutput: this.finalOutput,
			timestamp: Date.now(),
		};
	}
}
