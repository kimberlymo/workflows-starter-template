import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

type PreWarmingOption = "all" | "next";
type StepStatus = "running" | "completed" | "error";
type WorkflowPayload = Record<string, unknown>;
type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };
type FunctionRunResult =
	| { status: "completed"; durationMs: number; outputJson: string }
	| { status: "error"; durationMs: number; errorMessage: string };
type FunctionStatistic = {
	functionName: string;
	durationMs: number;
	status: "completed" | "error";
	errorMessage?: string;
};

const FUNCTION_NAME_PATTERN = /^f[0-7]$/;

/**
 * @see https://developers.cloudflare.com/workflows
 */
export class MyWorkflow extends WorkflowEntrypoint<Env, WorkflowPayload> {
	async run(event: WorkflowEvent<WorkflowPayload>, step: WorkflowStep) {
		const instanceId = event.instanceId;
		let parsedPayload: ReturnType<MyWorkflow["parsePayload"]>;
		try {
			parsedPayload = this.parsePayload(event.payload);
		} catch (error) {
			const errorMessage = this.getErrorMessage(error);
			await this.notifyStep(
				"validate payload",
				"error",
				instanceId,
				errorMessage,
			);
			throw error;
		}
		const { flows, definitions, requestBody, preWarming, preWarmingOption } =
			parsedPayload;
		const functionStatistics: FunctionStatistic[] = [];

		console.log("test")
		if (preWarming && preWarmingOption === "all") {
			await this.prewarmFunctions(flows, definitions, instanceId, step);
		}

		let functionInput: JsonValue = requestBody;
		for (const functionName of flows) {
			console.log("testliii")
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
			const result = await step.do(stepName, async (): Promise<FunctionRunResult> => {
				const startedAt = Date.now();
				try {
					const url = definitions[functionName];
					const response = await fetch(url, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(functionInput),
					});

					if (!response.ok) {
						const body = (await response.text()).slice(0, 300);
						throw new Error(
							`POST ${url} returned HTTP ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`,
						);
					}

					const responseBody = await response.text();
					try {
						JSON.parse(responseBody);
					} catch (error) {
						throw new Error("Function returned invalid JSON", { cause: error });
					}

					return {
						status: "completed",
						durationMs: Date.now() - startedAt,
						outputJson: responseBody,
					};
				} catch (error) {
					return {
						status: "error",
						durationMs: Date.now() - startedAt,
						errorMessage: `Function ${functionName} failed: ${this.getErrorMessage(error)}`,
					};
				}
			});

			const statistic = {
				functionName,
				durationMs: result.durationMs,
				status: result.status,
				...(result.status === "error"
					? { errorMessage: result.errorMessage }
					: {}),
			};
			functionStatistics.push(statistic);
			const output: JsonValue | undefined =
				result.status === "completed"
					? (JSON.parse(result.outputJson) as JsonValue)
					: undefined;
			await this.recordFunctionStatistic(
				instanceId,
				statistic,
				output,
			);

			if (result.status === "error") {
				await this.notifyStep(
					stepName,
					"error",
					instanceId,
					result.errorMessage,
				);
				throw new Error(result.errorMessage);
			}

			functionInput = output ?? null;
		}

		await this.completeWorkflow(instanceId, functionInput);
		return { output: functionInput, statistics: functionStatistics };
	}

	private parsePayload(payload: WorkflowPayload): {
		flows: string[];
		definitions: Record<string, string>;
		preWarming: boolean;
		requestBody: JsonValue;
		preWarmingOption: PreWarmingOption;
	} {
		const { flowOrder, definitions: serializedDefinitions, preWarming, requestBody: serializedBody } =
			payload;
		if (
			typeof flowOrder !== "string" ||
			typeof serializedDefinitions !== "string" ||
			typeof serializedBody !== "string"
		) {
			throw new Error(
				"Payload must include flowOrder, JSON definitions, and a request body",
			);
		}
		if (typeof preWarming !== "boolean") {
			throw new Error("Payload must include a boolean preWarming value");
		}

		let requestBody: JsonValue;
		try {
			requestBody = JSON.parse(serializedBody) as JsonValue;
		} catch (error) {
			throw new Error("Request body must be valid JSON", { cause: error });
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
			requestBody,
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

	private async recordFunctionStatistic(
		instanceId: string,
		statistic: FunctionStatistic,
		output?: unknown,
	): Promise<void> {
		try {
			const id = this.env.WORKFLOW_STATUS.idFromName(instanceId);
			const stub = this.env.WORKFLOW_STATUS.get(id);
			await stub.recordFunctionStatistic(statistic, output);
		} catch (error) {
			console.error("Failed to report function statistics", error);
		}
	}

	private async completeWorkflow(
		instanceId: string,
		output: unknown,
	): Promise<void> {
		try {
			const id = this.env.WORKFLOW_STATUS.idFromName(instanceId);
			const stub = this.env.WORKFLOW_STATUS.get(id);
			await stub.completeWorkflow(output);
		} catch (error) {
			console.error("Failed to report workflow completion", error);
		}
	}
}
