interface CodeDisplayProps {
	currentStep: string | null;
	workflowStatus: "idle" | "running" | "completed" | "error";
	errorMessage: string | null;
	onStartWorkflow: () => void;
	isStarting: boolean;
	flowOrder: string;
	definitions: string;
	preWarming: boolean;
	requestBody: string;
	preWarmingOption: "all" | "next";
	onPayloadChange: (payload: {
		flowOrder: string;
		definitions: string;
		requestBody: string;
		preWarming: boolean;
		preWarmingOption: "all" | "next";
	}) => void;
}

export function CodeDisplay({
	currentStep,
	workflowStatus,
	errorMessage,
	onStartWorkflow,
	isStarting,
	flowOrder,
	preWarmingOption,
	requestBody,
	definitions,
	preWarming,
	onPayloadChange,
}: CodeDisplayProps) {
	const canStart = workflowStatus !== "running" && !isStarting;

	return (
		<section className="h-full overflow-auto p-4">
			<form
				className="space-y-4 rounded-lg border border-neutral-300 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900"
				onSubmit={(event) => {
					event.preventDefault();
					onStartWorkflow();
				}}
			>
				<div>
					<label htmlFor="flow-order" className="mb-1 block text-sm font-medium dark:text-neutral-200">
						Flow order
					</label>
					<input
						id="flow-order"
						value={flowOrder}
						onChange={(event) =>
							onPayloadChange({
								flowOrder: event.target.value,
								definitions,
								requestBody,
								preWarming,
								preWarmingOption,
							})
						}
						placeholder="f0-f1"
						className="w-full rounded border border-neutral-300 p-2 dark:text-neutral-200 dark:border-neutral-700 dark:bg-neutral-800"
					/>
				</div>

				<div>
					<label
						htmlFor="function-definitions"
						className="mb-1 block text-sm font-medium dark:text-neutral-200"
					>
						Function definitions (JSON)
					</label>
					<textarea
						id="function-definitions"
						value={definitions}
						onChange={(event) =>
							onPayloadChange({
								flowOrder,
								requestBody,
								definitions: event.target.value,
								preWarming,
								preWarmingOption,
							})
						}
						placeholder={'{"f0":"https://example.com"}'}
						rows={9}
						className="w-full rounded border border-neutral-300 p-2 font-mono dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
					/>
				</div>

				<div>
					<label
						htmlFor="function-input"
						className="mb-1 block text-sm font-medium dark:text-neutral-200"
					>
						Request Body (JSON)
					</label>
					<textarea
						id="function-input"
						value={requestBody}
						onChange={(event) =>
							onPayloadChange({
								flowOrder,
								definitions,
								requestBody: event.target.value,
								preWarming,
								preWarmingOption,
							})
						}
						placeholder={'{ "url":"https://example.com" } or { "text":"Hello World" }'}
						rows={3}
						className="w-full rounded border border-neutral-300 p-2 font-mono dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
					/>
				</div>

				<label className="flex items-center gap-2 text-sm dark:text-neutral-200">
					<input
						type="checkbox"
						checked={preWarming}
						onChange={(event) =>
							onPayloadChange({
								flowOrder,
								definitions,
								requestBody,
								preWarming: event.target.checked,
								preWarmingOption,
							})
						}
					/>
					Prewarm functions before execution
				</label>

				{preWarming && (
					<div>
						<label htmlFor="prewarming-options" className="mb-1 block text-sm font-medium dark:text-neutral-200">
							Prewarming options
						</label>
						<select
							id="prewarming-options"
							value={preWarmingOption}
							onChange={(event) =>
								onPayloadChange({
									flowOrder,
									definitions,
									requestBody,
									preWarming,
									preWarmingOption:
										event.target.value === "next" ? "next" : "all",
								})
							}
							className="w-full rounded border border-neutral-300 p-2 dark:text-neutral-200 dark:border-neutral-700 dark:bg-neutral-800"
						>
							<option value="all">All functions</option>
							<option value="next">Each function before it executes</option>
						</select>
					</div>
				)}

				<button
					type="submit"
					disabled={!canStart}
					className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-700 dark:text-neutral-200"
				>
					{isStarting ? "Starting..." : "Start workflow"}
				</button>

				<p className="text-sm text-neutral-600 dark:text-neutral-400">
					Status: {workflowStatus}
					{currentStep ? ` — ${currentStep}` : ""}
				</p>
				{errorMessage && (
					<p role="alert" className="break-words text-sm text-red-700 dark:text-red-300">
						{errorMessage}
					</p>
				)}
			</form>
		</section>
	);
}
