// Export the Workflow and Durable Object classes
export { MyWorkflow } from "./workflow";
export { WorkflowStatusDO } from "./durable-object";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Main Worker fetch handler
 *
 * Handles API routes and WebSocket upgrade requests for workflow management:
 * - POST /api/workflow/start - Create new workflow instance
 * - GET /api/workflow/status/:id - Get workflow status
 * - POST /api/workflow/event/:id - Send events to workflow
 * - GET /ws - WebSocket connection for real-time updates
 */
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// API: Start a new workflow instance
		if (url.pathname === "/api/workflow/start" && request.method === "POST") {
			let payload: unknown;
			try {
				payload = await request.json();
			} catch {
				return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
			}

			if (
				!isRecord(payload) ||
				typeof payload.flowOrder !== "string" ||
				typeof payload.definitions !== "string" ||
				typeof payload.preWarming !== "boolean"
			) {
				return Response.json(
					{
						error:
							"Payload must include flowOrder, definitions, and preWarming",
					},
					{ status: 400 },
				);
			}
			if (
				payload.preWarming &&
				payload.preWarmingOption !== "all" &&
				payload.preWarmingOption !== "next"
			) {
				return Response.json(
					{ error: "preWarmingOption must be 'all' or 'next'" },
					{ status: 400 },
				);
			}

			try {
				const instance = await env.MY_WORKFLOW.create({
					params: payload,
				});

				return Response.json({
					instanceId: instance.id,
					message: "Workflow started successfully",
				});
			} catch {
				return Response.json(
					{ error: "Failed to start workflow" },
					{ status: 500 },
				);
			}
		}

		// API: Get workflow status
		if (url.pathname.startsWith("/api/workflow/status/")) {
			const instanceId = url.pathname.split("/").pop();
			if (!instanceId) {
				return Response.json(
					{ error: "Instance ID required" },
					{ status: 400 },
				);
			}

			try {
				const instance = await env.MY_WORKFLOW.get(instanceId);
				const status = await instance.status();
				return Response.json(status);
			} catch {
				return Response.json(
					{ error: "Failed to get workflow status" },
					{ status: 500 },
				);
			}
		}

		// API: Send event to workflow instance
		if (
			url.pathname.startsWith("/api/workflow/event/") &&
			request.method === "POST"
		) {
			const instanceId = url.pathname.split("/").pop();
			if (!instanceId) {
				return Response.json(
					{ error: "Instance ID required" },
					{ status: 400 },
				);
			}

			try {
				const body = (await request.json()) as {
					approved: boolean;
					comment?: string;
				};
				const instance = await env.MY_WORKFLOW.get(instanceId);

				await instance.sendEvent({
					type: "user-approval",
					payload: body,
				});

				return Response.json({
					success: true,
					message: "Event sent successfully",
				});
			} catch {
				return Response.json(
					{ error: "Failed to send event" },
					{ status: 500 },
				);
			}
		}

		// WebSocket: Connect to workflow status updates
		if (url.pathname === "/ws") {
			const instanceId = url.searchParams.get("instanceId");
			if (!instanceId) {
				return new Response("instanceId query parameter required", {
					status: 400,
				});
			}

			const upgradeHeader = request.headers.get("Upgrade");
			if (upgradeHeader !== "websocket") {
				return new Response("Expected Upgrade: websocket", { status: 426 });
			}

			try {
				const doId = env.WORKFLOW_STATUS.idFromName(instanceId);
				const stub = env.WORKFLOW_STATUS.get(doId);
				return stub.fetch(request);
			} catch {
				return new Response("Failed to establish WebSocket connection", {
					status: 500,
				});
			}
		}

		return Response.json({ error: "Not Found" }, { status: 404 });
	},
} satisfies ExportedHandler<Env>;
