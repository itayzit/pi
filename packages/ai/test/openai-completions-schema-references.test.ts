import { expect, it } from "vitest";
import { streamSimple } from "../src/api/openai-completions.ts";
import type { Model, Tool } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

// Regression for #10270: referenced object parameters were sent as JSON strings.
it.each([
	"nvidia/nemotron-3.5-super-vl-preview",
	"qwen/qwen3.8-flash-next",
	"claude-opus-5-5",
	"gpt-6-astra",
	"kimi-k2.6",
])("prepares tool references for %s without mutating the validation schema", async (id) => {
	const settings = {
		type: "object",
		properties: { notifications: { type: "boolean" } },
		required: ["notifications"],
		additionalProperties: false,
	};
	const parameters = {
		type: "object",
		properties: { settings: { $ref: "#/$defs/Settings" } },
		$defs: { Settings: settings },
	};
	const original = structuredClone(parameters);
	const model: Model<"openai-completions"> = {
		id,
		name: id,
		api: "openai-completions",
		provider: "custom",
		baseUrl: "https://example.com/v1",
		reasoning: false,
		input: ["text"],
		contextWindow: 32768,
		maxTokens: 1024,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
	let payload: { tools: { function: { parameters: typeof parameters } }[] } | undefined;
	const response = await streamSimple(
		model,
		normalizeContext({
			messages: [{ role: "user", content: "Record the check.", timestamp: 1 }],
			tools: [{ name: "record", description: "Record settings", parameters: parameters as Tool["parameters"] }],
		}),
		{
			apiKey: "test",
			maxRetries: 0,
			fetch: async (_url, init) => {
				payload = JSON.parse(String(init?.body));
				return new Response(
					'data: {"id":"test","choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
					{ headers: { "Content-Type": "text/event-stream" } },
				);
			},
		},
	).result();
	expect(response.stopReason).toBe("stop");
	expect(payload?.tools[0].function.parameters.properties.settings).toEqual(
		/nemotron|qwen/.test(id) ? settings : { $ref: "#/$defs/Settings" },
	);
	expect(parameters).toEqual(original);
});
