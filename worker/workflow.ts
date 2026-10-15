import { WorkflowEntrypoint, WorkflowStep } from "cloudflare:workers";
import type { WorkflowEvent } from "cloudflare:workers";

/**
 * This workflow showcases:
 * - Durable step execution with step.do
 * - Time-based delays with step.sleep
 * - Interactive pausing with step.waitForEvent
 * - Data flow between steps
 *
 * @see https://developers.cloudflare.com/workflows
 */
export class MyWorkflow extends WorkflowEntrypoint<
	Env,
	Record<string, unknown>
> {
	// Notify Durable Object of step progress. Called outside step.do, so this
	// operation may repeat. Safe here because updateStep is idempotent.
	// Refer to: https://developers.cloudflare.com/workflows/build/rules-of-workflows/
	async notifyStep(stepName: string, status: "running" | "completed" | "waiting", instanceId: string) {
		try {
			const doId = this.env.WORKFLOW_STATUS.idFromName(instanceId);
			const stub = this.env.WORKFLOW_STATUS.get(doId);
			await stub.updateStep(stepName, status);
		} catch {
			// Silently fail
		}
	};

	async run(event: WorkflowEvent<Record<string, unknown>>, step: WorkflowStep) {
		const instanceId = event.instanceId;
		const flowOrder = event.payload.flowOrder as string;
		const functionDefinitions = event.payload.definitions as string;
		const preWarming = event.payload.preWarming;

		const flows = flowOrder.split("-");
		const definitions = JSON.parse(functionDefinitions) as Record<string, string>;

		for (const functionName of flows) {
			if (!definitions[functionName]) {
				throw new Error(`Function definition not found for flow: ${functionName}`);
			}

			const checkNameRegex = /^f[0-7]+$/;
			if (!checkNameRegex.test(functionName)) {
				throw new Error(`Invalid function name: ${functionName}`);
			}
		}

		if (preWarming === true) {
			await this.notifyStep("prewarm functions", "running", instanceId);
			await step.do("prewarm functions", async () => {
				await Promise.all(
					flows.map(async (functionName) => {
						const url = definitions[functionName];

						if (!url) {
							throw new Error(
								`Function definition not found for flow: ${functionName}`,
							);
						}

						const response = await fetch(url);
						if (!response.ok) {
							throw new Error(
								`Failed to prewarm ${functionName}: HTTP ${response.status}`,
							);
						}

						await response.body?.cancel();
					}),
				);
			});
			await this.notifyStep("prewarm functions", "completed", instanceId);
		}

		for (const functionName of flows) {
			const url = definitions[functionName];

			if (!url) {
				throw new Error(`Function definition not found for flow: ${functionName}`);
			}

			console.log(`Executing flow: ${functionName}, function: ${functionName}`);

			await this.notifyStep(`execute ${functionName}`, "running", instanceId);
			// Execute the function (this is a placeholder, replace with actual function execution)
			await step.do(`execute ${functionName}`, async () => {
				// Simulate function execution
				await new Promise((resolve) => setTimeout(resolve, 500));
				return { executed: true, functionName };
			});
			await this.notifyStep(`execute ${functionName}`, "completed", instanceId);
		}
	}
}
