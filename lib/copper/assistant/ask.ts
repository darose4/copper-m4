"use server";

// The server action the Ask Copper chat calls. It streams the conversation to
// the model through callStream (lib/ai/call.ts), with or without the tools,
// and sends back each step as it happens, so the panel can show Copper
// thinking and using its tools.
//
// Two agents share the chat: Copper Support and the Refund agent (Module 4).
// Each has its own instructions and tools. When one calls its hand-off tool,
// the same question continues with the other agent, and the chat stays with
// that agent until it hands back.
import { hasToolCall, stepCountIs } from "ai";
import { callStream, THOUGHT_SUMMARIES } from "@/lib/ai/call";
import { createLive, type Live } from "@/lib/ai/live";
import {
  COPPER_INSTRUCTIONS,
  REFUND_INSTRUCTIONS,
} from "@/lib/copper/assistant/instructions";
import {
  type AgentId,
  HANDOFFS,
  type Progress,
  type ToolStep,
} from "@/lib/copper/assistant/progress";
import { copperTools, refundTools } from "@/lib/copper/assistant/tools";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type AskCopperRequest = {
  messages: ChatMessage[];
  useTools: boolean;
  /** Who the chat is with now. Defaults to Copper Support. */
  agent?: AgentId;
};

export type AskCopperResult = { progress: Live<Progress> };

/** At most this many model steps (tool calls plus the reply) per agent per question. */
const MAX_STEPS = 5;

const SORRY = "Sorry, something went wrong on my end. Please try again.";

const AGENTS = {
  copper: { instructions: COPPER_INSTRUCTIONS, tools: copperTools },
  refund: { instructions: REFUND_INSTRUCTIONS, tools: refundTools },
};

export async function askCopper({
  messages,
  useTools,
  agent: startingAgent,
}: AskCopperRequest): Promise<AskCopperResult> {
  const { live, update, done } = createLive<Progress>();
  // Anything but "refund" is Copper: the action can be called by anyone.
  let agent: AgentId = useTools && startingAgent === "refund" ? "refund" : "copper";
  const progress: Progress = {
    steps: [],
    reply: "",
    status: "working",
    agent,
  };
  // A fresh copy each time, so earlier updates never change underneath the
  // panel.
  const snapshot = (): Progress => ({
    ...progress,
    steps: progress.steps.map((step) => ({ ...step })),
  });
  const toolStep = (id: string) =>
    progress.steps.find(
      (step): step is ToolStep => step.type === "tool" && step.id === id,
    );

  // Read the stream in the background, so the panel gets the first update now.
  void (async () => {
    try {
      // One agent answers; if it hands off, the other one picks up the same
      // question. Two hand-offs in one question is the most we allow.
      for (let turn = 0; turn < 3; turn++) {
        const handoff = HANDOFFS[agent];
        let handedOff = false;
        // Without tools, send no instructions either: "always use your tools"
        // with no tools makes the model answer with nothing.
        const result = callStream(
          agent === "refund"
            ? { module: 4, feature: "ask-refund" }
            : { module: 2, feature: "ask-copper" },
          {
            messages,
            providerOptions: THOUGHT_SUMMARIES,
            ...(useTools && {
              instructions: AGENTS[agent].instructions,
              tools: AGENTS[agent].tools,
              stopWhen: [stepCountIs(MAX_STEPS), hasToolCall(handoff.tool)],
            }),
          },
        );

        for await (const part of result.fullStream) {
          switch (part.type) {
            case "reasoning-delta": {
              const last = progress.steps.at(-1);
              if (last?.type === "thinking") last.text += part.text;
              else progress.steps.push({ type: "thinking", text: part.text });
              break;
            }
            case "tool-input-start":
              progress.steps.push({
                type: "tool",
                id: part.id,
                name: part.toolName,
                state: "calling",
              });
              break;
            case "tool-call": {
              const step = toolStep(part.toolCallId);
              if (step) step.input = part.input;
              else
                progress.steps.push({
                  type: "tool",
                  id: part.toolCallId,
                  name: part.toolName,
                  state: "calling",
                  input: part.input,
                });
              break;
            }
            case "tool-result": {
              const step = toolStep(part.toolCallId);
              if (step)
                Object.assign(step, { output: part.output, state: "done" });
              if (part.toolName === handoff.tool) handedOff = true;
              break;
            }
            case "tool-error": {
              const step = toolStep(part.toolCallId);
              const message =
                part.error instanceof Error
                  ? part.error.message
                  : String(part.error);
              if (step)
                Object.assign(step, { output: message, state: "error" });
              break;
            }
            case "text-delta":
              progress.reply += part.text;
              break;
            case "error":
              throw part.error;
            default:
              continue;
          }
          update(snapshot());
        }

        if (!useTools || !handedOff) break;
        // The agent that handed off says nothing more: the next one answers.
        progress.reply = "";
        progress.steps.push({ type: "handoff", from: agent, to: handoff.to });
        agent = handoff.to;
        progress.agent = agent;
        update(snapshot());
      }
      progress.status = "done";
      if (!progress.reply.trim()) progress.reply = SORRY;
    } catch {
      progress.status = "error";
      if (!progress.reply.trim()) progress.reply = SORRY;
    }
    done(snapshot());
  })();

  return { progress: live };
}
