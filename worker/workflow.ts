import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

type PreWarmingOption = "all" | "next";
type StepStatus = "running" | "completed" | "error";
type WorkflowPayload = Record<string, unknown>;

const FUNCTION_NAME_PATTERN = /^f[0-7]$/;

/**
 * @see https://developers.cloudflare.com/workflows
 */
export class MyWorkflow extends WorkflowEntrypoint<Env, WorkflowPayload> {
	async run(event: WorkflowEvent<WorkflowPayload>, step: WorkflowStep) {
		console.log(event.payload)
		const { flows, definitions, preWarming, preWarmingOption } =
			this.parsePayload(event.payload);
		const instanceId = event.instanceId;

		if (preWarming && preWarmingOption === "all") {
			await this.prewarmFunctions(flows, definitions, instanceId, step);
		}

		let functionInput: unknown = {};
		for (const functionName of flows) {
			if (preWarming && preWarmingOption === "next") {
				await this.prewarmFunctions(
					[functionName],
					definitions,
					instanceId,
					step,
					`prewarm ${functionName}`,
				);
			}

			const stepName = `execute ${functionName}`;
			await this.notifyStep(stepName, "running", instanceId);
			try {
				const url = definitions[functionName];
				const responseBody = await step.do(stepName, async () => {
					let response: Response;
					try {
						response = await fetch(url, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify(functionInput),
						});
					} catch (error) {
						throw new Error(
							`POST to function ${functionName} at ${url} failed: ${this.getErrorMessage(error)}`,
							{ cause: error },
						);
					}

					if (!response.ok) {
						const responseBody = (await response.text()).slice(0, 300);
						throw new Error(
							`Function ${functionName} at ${url} failed: HTTP ${response.status} ${response.statusText}${responseBody ? `: ${responseBody}` : ""}`,
						);
					}

					return response.text();
				});

				try {
					functionInput = JSON.parse(responseBody);
				} catch (error) {
					throw new Error(
						`Function ${functionName} did not return valid JSON`,
						{ cause: error },
					);
				}

				await this.notifyStep(stepName, "completed", instanceId);
			} catch (error) {
				const errorMessage = this.getErrorMessage(error);
				console.error(`Workflow step "${stepName}" failed: ${errorMessage}`);
				await this.notifyStep(stepName, "error", instanceId, errorMessage);
				throw error;
			}
		}
	}

	private parsePayload(payload: WorkflowPayload): {
		flows: string[];
		definitions: Record<string, string>;
		preWarming: boolean;
		preWarmingOption: PreWarmingOption;
	} {
		const { flowOrder, definitions: serializedDefinitions, preWarming } =
			payload;
		if (typeof flowOrder !== "string" || typeof serializedDefinitions !== "string") {
			throw new Error("Payload must include flowOrder and JSON definitions");
		}
		if (typeof preWarming !== "boolean") {
			throw new Error("Payload must include a boolean preWarming value");
		}

		const flows = flowOrder.split("-").map((flow) => flow.trim());
		if (
			flows.length === 0 ||
			flows.some((flow) => !FUNCTION_NAME_PATTERN.test(flow))
		) {
			throw new Error("Flow order must contain function names from f0 to f7");
		}
		if (new Set(flows).size !== flows.length) {
			throw new Error("Flow order cannot contain duplicate function names");
		}

		let parsedDefinitions: unknown;
		try {
			parsedDefinitions = JSON.parse(serializedDefinitions);
		} catch (error) {
			throw new Error("Function definitions must be valid JSON", { cause: error });
		}
		if (
			typeof parsedDefinitions !== "object" ||
			parsedDefinitions === null ||
			Array.isArray(parsedDefinitions)
		) {
			throw new Error("Function definitions must be a JSON object");
		}

		const definitions: Record<string, string> = {};
		for (const [name, value] of Object.entries(parsedDefinitions)) {
			if (typeof value !== "string" || value.trim() === "") {
				throw new Error(`Definition for ${name} must be a non-empty URL`);
			}
			definitions[name] = value;
		}

		for (const functionName of flows) {
			if (!definitions[functionName]) {
				throw new Error(`Function definition not found for flow: ${functionName}`);
			}
		}

		const option = payload.preWarmingOption;
		if (preWarming && option !== "all" && option !== "next") {
			throw new Error("preWarmingOption must be 'all' or 'next'");
		}

		return {
			flows,
			definitions,
			preWarming,
			preWarmingOption: option === "next" ? "next" : "all",
		};
	}

	private async prewarmFunctions(
		flows: string[],
		definitions: Record<string, string>,
		instanceId: string,
		step: WorkflowStep,
		stepName = "prewarm functions",
	): Promise<void> {
		await this.runStep(step, stepName, instanceId, async () => {
			await Promise.all(
				flows.map(async (functionName) => {
					const url = definitions[functionName];
					try {
						const response = await fetch(url);
						if (!response.ok) {
							const responseText = await response.text();
							throw new Error(
								`HTTP ${response.status} ${response.statusText}${responseText ? `: ${responseText.slice(0, 300)}` : ""}`,
							);
						}
						await response.body?.cancel();
					} catch (error) {
						throw new Error(
							`Prewarming ${functionName} at ${url} failed: ${this.getErrorMessage(error)}`,
							{ cause: error },
						);
					}
				}),
			);
		});
	}

	private async runStep(
		step: WorkflowStep,
		stepName: string,
		instanceId: string,
		run: () => Promise<void>,
	): Promise<void> {
		await this.notifyStep(stepName, "running", instanceId);
		try {
			await step.do(stepName, run);
			await this.notifyStep(stepName, "completed", instanceId);
		} catch (error) {
			const errorMessage = this.getErrorMessage(error);
			console.error(`Workflow step "${stepName}" failed: ${errorMessage}`);
			await this.notifyStep(stepName, "error", instanceId, errorMessage);
			throw error;
		}
	}

	private getErrorMessage(error: unknown): string {
		if (error instanceof Error) {
			const cause = error.cause;
			return cause === undefined
				? error.message
				: `${error.message} (cause: ${this.getErrorMessage(cause)})`;
		}
		return String(error);
	}

	private async notifyStep(
		stepName: string,
		status: StepStatus,
		instanceId: string,
		errorMessage?: string,
	): Promise<void> {
		try {
			const id = this.env.WORKFLOW_STATUS.idFromName(instanceId);
			const stub = this.env.WORKFLOW_STATUS.get(id);
			await stub.updateStep(stepName, status, errorMessage);
		} catch (error) {
			console.error(`Failed to report workflow step "${stepName}"`, error);
		}
	}
}
