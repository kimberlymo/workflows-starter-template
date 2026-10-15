import type { FunctionStatistic } from "../types";

interface WorkflowStatisticsProps {
	statistics: FunctionStatistic[];
	finalOutput: unknown;
}

export function WorkflowStatistics({
	statistics,
	finalOutput,
}: WorkflowStatisticsProps) {
	return (
		<section className="rounded-lg border border-neutral-300 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
			<h2 className="mb-3 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
				Workflow statistics
			</h2>

			{statistics.length === 0 ? (
				<p className="text-sm text-neutral-600 dark:text-neutral-400">
					Function timings will appear here after execution.
				</p>
			) : (
				<ul className="space-y-3">
					{statistics.map((statistic) => (
						<li
							key={statistic.functionName}
							className="border-b border-neutral-200 pb-3 last:border-0 dark:border-neutral-700"
						>
							<div className="flex justify-between gap-4 text-sm">
								<span className="font-medium text-neutral-800 dark:text-neutral-100">
									{statistic.functionName}
								</span>
								<span className="text-neutral-600 dark:text-neutral-400">
									{statistic.durationMs} ms · {statistic.status}
								</span>
							</div>
							{statistic.errorMessage && (
								<p className="mt-1 break-words text-sm text-red-700 dark:text-red-300">
									{statistic.errorMessage}
								</p>
							)}
						</li>
					))}
				</ul>
			)}

			{finalOutput !== null && (
				<div className="mt-4">
					<h3 className="mb-1 text-sm font-medium text-neutral-800 dark:text-neutral-100">
						Last function output
					</h3>
					<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-100 p-3 text-xs text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
						{JSON.stringify(finalOutput, null, 2)}
					</pre>
				</div>
			)}
		</section>
	);
}
