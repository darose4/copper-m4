"use client";

// Ask Copper: the floating shopping chat. Each answer is drawn as a rail of
// stations (the tools on offer, Copper's thinking, each tool call with what
// went in and what came back), then the reply, so shoppers can see how the
// answer was worked out.
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BrainIcon,
  MessageCircleIcon,
  RepeatIcon,
  TriangleAlertIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { SetupRequired } from "@/components/setup-required";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { readLive } from "@/lib/ai/live";
import { askCopper, type ChatMessage } from "@/lib/copper/assistant/ask";
import { splitCitations } from "@/lib/copper/assistant/citations";
import {
  AGENT_NAMES,
  AGENT_TOOLS,
  type AgentId,
  type Progress,
  type ToolStep,
  TOOL_LABELS,
} from "@/lib/copper/assistant/progress";
import { formatUsd, getPlans, getProducts } from "@/lib/copper/catalog";
import { cn } from "@/lib/utils";

const STARTERS = [
  "How much is Copper Home with Copper Plus, paid yearly, for 2 years?",
  "Is Copper Notes in Night Sky in stock?",
  "Is Copper Plus cheaper monthly or yearly?",
  "I want a refund for order CSL-1001 (dana.reyes@example.com).",
];

// Once the Refund agent has the chat, its starters are about orders.
const REFUND_STARTERS = [
  "Refund order CSL-1002, my email is dana.reyes@example.com.",
  "What orders do I have? My email is priya.shah@example.com.",
];

/** The Refund Console sends this when a person approves or rejects a refund. */
export const REFUND_DECIDED_EVENT = "copper:refund-decided";

/** A notice is a message from an agent that nobody asked for (a refund decision). */
type Turn = { question: string; progress: Progress; notice?: boolean };
type Chats = { tools: Turn[]; noTools: Turn[] };

const WORKING: Progress = {
  steps: [],
  reply: "",
  status: "working",
  agent: "copper",
};

export function AskCopper({
  aiConfigured,
  docked = false,
}: {
  aiConfigured: boolean;
  /** Stays open beside the page, which remains clickable (the Support page). */
  docked?: boolean;
}) {
  const [open, setOpen] = useState(docked);
  const [useTools, setUseTools] = useState(true);
  const [chats, setChats] = useState<Chats>({ tools: [], noTools: [] });
  const [draft, setDraft] = useState("");
  const body = useRef<HTMLDivElement>(null);

  const key = useTools ? "tools" : "noTools";
  const turns = chats[key];
  const busy = turns.some((turn) => turn.progress.status === "working");
  // The chat stays with whichever agent spoke last, until it hands back.
  const agent: AgentId = useTools
    ? (turns.findLast((turn) => !turn.notice)?.progress.agent ?? "copper")
    : "copper";

  // Open from the header's #ask link or a page load at /#ask. Clicking the
  // link again fires no hashchange, so listen for the click too.
  useEffect(() => {
    const openOnHash = () => window.location.hash === "#ask" && setOpen(true);
    const openOnClick = (event: MouseEvent) => {
      if ((event.target as Element).closest?.('a[href$="#ask"]')) setOpen(true);
    };
    openOnHash();
    window.addEventListener("hashchange", openOnHash);
    document.addEventListener("click", openOnClick);
    return () => {
      window.removeEventListener("hashchange", openOnHash);
      document.removeEventListener("click", openOnClick);
    };
  }, []);

  // The Refund Console tells the chat when a person decides a refund, and the
  // Refund agent passes the news on to the customer.
  useEffect(() => {
    const onDecided = (event: Event) => {
      const text = (event as CustomEvent<{ text: string }>).detail?.text;
      if (!text) return;
      setChats((all) => ({
        ...all,
        tools: [
          ...all.tools,
          {
            question: "",
            notice: true,
            progress: { steps: [], reply: text, status: "done", agent: "refund" },
          },
        ],
      }));
      setUseTools(true);
    };
    window.addEventListener(REFUND_DECIDED_EVENT, onDecided);
    return () => window.removeEventListener(REFUND_DECIDED_EVENT, onDecided);
  }, []);

  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [chats, useTools]);

  async function send(question: string) {
    question = question.trim();
    if (!question || busy) return;
    setDraft("");
    const chat = key;
    const index = turns.length;
    // Only finished turns go to the model: questions and Copper's replies.
    // A notice has no question, so it goes as just the agent's message.
    const messages: ChatMessage[] = [
      ...turns.flatMap(({ question, progress }): ChatMessage[] => [
        ...(question
          ? [{ role: "user" as const, content: question }]
          : []),
        { role: "assistant", content: progress.reply },
      ]),
      { role: "user", content: question },
    ];
    const setProgress = (progress: Progress) =>
      setChats((all) => ({
        ...all,
        [chat]: all[chat].map((turn, i) =>
          i === index ? { ...turn, progress } : turn,
        ),
      }));
    setChats((all) => ({
      ...all,
      [chat]: [...all[chat], { question, progress: WORKING }],
    }));
    try {
      const { progress } = await askCopper({
        messages,
        useTools: chat === "tools",
        // Only named once the Refund agent has the chat; Copper is the default.
        ...(agent === "refund" && { agent }),
      });
      for await (const update of readLive(progress)) setProgress(update);
    } catch {
      setProgress({
        steps: [],
        reply: "Sorry, I couldn't reach Copper. Please try again.",
        status: "error",
        agent,
      });
    }
  }

  return (
    <>
      {!open && (
        <Button
          data-testid="ask-copper-launcher"
          aria-label="Ask Copper"
          onClick={() => setOpen(true)}
          className="fixed right-4 bottom-4 z-40 h-12 gap-2 rounded-full px-5 shadow-lg sm:right-6 sm:bottom-6"
        >
          <MessageCircleIcon className="size-5" />
          Ask Copper
        </Button>
      )}
      <Sheet open={open} onOpenChange={setOpen} modal={!docked}>
        <SheetContent
          data-testid="ask-copper"
          side="right"
          showCloseButton={false}
          onInteractOutside={(event) => docked && event.preventDefault()}
          className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
        >
          <header className="bg-chart-5 dark:bg-background text-white">
            <div className="flex items-center gap-3 px-4 pt-4 pb-3">
              <span className="bg-primary flex size-10 shrink-0 items-center justify-center rounded-full">
                <MessageCircleIcon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-base font-bold text-white">
                  Ask Copper
                </SheetTitle>
                <SheetDescription
                  data-testid="chat-agent"
                  className="text-xs text-white/70"
                >
                  {agent === "refund"
                    ? "You're chatting with the Refund agent."
                    : "Prices, totals and stock, checked with tools."}
                </SheetDescription>
              </div>
              <SheetClose asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-white hover:bg-white/10 hover:text-white"
                >
                  <XIcon />
                  <span className="sr-only">Close</span>
                </Button>
              </SheetClose>
            </div>
            {aiConfigured && (
              <div className="flex items-center gap-3 bg-white/10 px-4 py-2">
                <div className="flex-1 text-sm">
                  <span className="font-semibold">Use tools</span>
                  <span className="ml-2 text-xs text-white/70">
                    {useTools ? "Checks every answer" : "Model guesses alone"}
                  </span>
                </div>
                <Switch
                  aria-label="Use tools"
                  checked={useTools}
                  onCheckedChange={setUseTools}
                />
              </div>
            )}
          </header>

          {aiConfigured ? (
            <>
              <div
                ref={body}
                className="bg-secondary flex-1 space-y-6 overflow-y-auto px-4 py-5"
              >
                {turns.map((turn, i) =>
                  turn.notice ? (
                    <div
                      key={i}
                      data-testid="refund-notice"
                      className="bg-card border-chart-5 ml-2 rounded-2xl rounded-tl-sm border-2 p-4 shadow-xs"
                    >
                      <p className="text-primary mb-1 text-xs font-bold">
                        {AGENT_NAMES.refund}
                      </p>
                      <p className="text-sm whitespace-pre-wrap">
                        {turn.progress.reply}
                      </p>
                    </div>
                  ) : (
                    <div key={i} className="space-y-4">
                      <p className="bg-primary text-primary-foreground ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2">
                        {turn.question}
                      </p>
                      <Answer progress={turn.progress} useTools={useTools} />
                    </div>
                  ),
                )}
                {!busy && (
                  <div className="space-y-2">
                    {turns.length === 0 && (
                      <p className="text-muted-foreground text-sm">
                        Hi, I&apos;m Copper! Ask me about prices, totals, stock
                        or a refund. Try one of these:
                      </p>
                    )}
                    {(agent === "refund" ? REFUND_STARTERS : STARTERS).map(
                      (starter) => (
                        <button
                          key={starter}
                          type="button"
                          onClick={() => send(starter)}
                          className="bg-background hover:border-primary block w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors"
                        >
                          {starter}
                        </button>
                      ),
                    )}
                  </div>
                )}
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  send(draft);
                }}
                className="bg-background flex items-center gap-2 border-t p-3"
              >
                <input
                  aria-label="Your question"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={
                    agent === "refund"
                      ? "Tell the Refund agent about your order…"
                      : "Ask about prices, stock or a refund…"
                  }
                  className="bg-background focus-visible:ring-ring h-10 flex-1 rounded-full border px-4 text-sm outline-none focus-visible:ring-2"
                />
                <Button
                  type="submit"
                  size="icon"
                  aria-label="Send"
                  disabled={busy || !draft.trim()}
                  className="size-10 rounded-full"
                >
                  <ArrowUpIcon />
                </Button>
              </form>
            </>
          ) : (
            <div className="bg-secondary flex-1 overflow-y-auto px-4">
              <SetupRequired service="ai" />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

/** One answer: the rail of stations, then Copper's reply. */
function Answer({
  progress,
  useTools,
}: {
  progress: Progress;
  useTools: boolean;
}) {
  const { steps, reply, status } = progress;
  const used = new Set(
    steps.filter((s): s is ToolStep => s.type === "tool").map((s) => s.name),
  );
  const working = status === "working";
  let toolCount = 0;
  // The answer starts with whichever agent had the chat, and changes at each hand-off.
  const endAgent: AgentId = progress.agent ?? "copper";
  const firstHandoff = steps.find((s) => s.type === "handoff");
  const startAgent: AgentId =
    firstHandoff?.type === "handoff" ? firstHandoff.from : endAgent;
  // Who is speaking at each step.
  const speakers = steps.reduce<AgentId[]>(
    (all, step) => [
      ...all,
      step.type === "handoff" ? step.to : (all.at(-1) ?? startAgent),
    ],
    [],
  );
  const agentName = AGENT_NAMES[endAgent];
  return (
    <div className="space-y-3">
      <div className="relative space-y-4 pl-9">
        <span
          aria-hidden
          className={cn(
            "absolute top-3 bottom-3 left-[11px] w-0.5 bg-gradient-to-b",
            useTools
              ? "from-primary via-accent to-accent"
              : "from-chart-3 to-chart-3",
          )}
        />
        <Station
          node={<WrenchIcon className="size-3" />}
          nodeClass="bg-muted-foreground"
          label={
            useTools
              ? `Tools ${AGENT_NAMES[startAgent]} can use`
              : "Tools given to Copper: none"
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {AGENT_TOOLS[startAgent].map((name) => (
              <span
                key={name}
                className={cn(
                  "rounded-md px-2 py-0.5 font-mono text-xs",
                  !useTools &&
                    "text-muted-foreground bg-background line-through",
                  useTools &&
                    used.has(name) &&
                    "bg-accent font-bold text-white",
                  useTools &&
                    !used.has(name) &&
                    "bg-background text-muted-foreground",
                )}
              >
                {name}
              </span>
            ))}
          </div>
          {!useTools && (
            <p className="text-muted-foreground mt-1.5 text-xs">
              Copper has to answer from memory alone.
            </p>
          )}
        </Station>

        {steps.map((step, i) => {
          if (step.type === "handoff") {
            return (
              <Station
                key={i}
                node={<RepeatIcon className="size-3" />}
                nodeClass="bg-chart-5"
                label="Hand-off"
              >
                <p
                  data-testid="handoff"
                  className="bg-card rounded-xl border px-3 py-2 text-sm"
                >
                  <strong>{AGENT_NAMES[step.from]}</strong> handed the chat to{" "}
                  <strong>{AGENT_NAMES[step.to]}</strong>, which has its own
                  instructions and tools.
                </p>
              </Station>
            );
          }
          const who = speakers[i] === "refund" ? "The Refund agent" : "Copper";
          return step.type === "thinking" ? (
            <Station
              key={i}
              node={<BrainIcon className="size-3" />}
              nodeClass={useTools ? "bg-primary" : "bg-chart-3"}
              label={`${who} is thinking`}
            >
              <p
                data-testid="thinking"
                className="text-muted-foreground border-l-2 pl-3 text-sm whitespace-pre-wrap italic"
              >
                <InlineMarkdown text={step.text} />
              </p>
            </Station>
          ) : (
            <Station
              key={i}
              node={<WrenchIcon className="size-3" />}
              nodeClass="bg-accent"
              label={
                step.state === "calling"
                  ? `${who} is calling a tool`
                  : `${who} called a tool`
              }
            >
              <ToolCard step={step} number={++toolCount} />
            </Station>
          );
        })}

        {working && (
          <div className="relative">
            <span className="bg-primary ring-secondary absolute top-0.5 -left-9 flex size-6 animate-pulse items-center justify-center gap-0.5 rounded-full ring-4">
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="size-1 animate-bounce rounded-full bg-white"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </span>
            <p className="text-muted-foreground pt-1 text-sm">
              {reply
                ? "Writing the answer…"
                : !useTools
                  ? "Answering from memory…"
                  : steps.length
                    ? "Deciding what to do next…"
                    : "Reading your question…"}
            </p>
          </div>
        )}
      </div>

      {(reply || !working) && (
        <div className="bg-card ml-2 rounded-2xl rounded-tl-sm border p-4 shadow-xs">
          <p className="text-primary mb-1 text-xs font-bold">
            {useTools && endAgent === "refund" ? agentName : "Copper"}
          </p>
          {!useTools && (
            <div className="border-chart-3 bg-chart-3/10 mb-3 rounded-lg border p-3 text-xs">
              <p className="flex items-center gap-1.5 font-bold">
                <TriangleAlertIcon className="text-chart-3 size-4" />
                Answered without tools: may be made up
              </p>
              <p className="text-muted-foreground mt-1">
                With tools off, Copper can&apos;t see today&apos;s prices or
                stock. The AI only has what it learned in training, so it fills
                the gaps with guesses that sound right. That&apos;s a
                hallucination.
              </p>
            </div>
          )}
          <p className="text-sm whitespace-pre-wrap">
            <CitedText text={reply} />
            {working && (
              <span className="bg-primary ml-0.5 inline-block h-4 w-0.5 animate-pulse align-middle" />
            )}
          </p>
        </div>
      )}
    </div>
  );
}

function Station({
  node,
  nodeClass,
  label,
  children,
}: {
  node: ReactNode;
  nodeClass: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="relative">
      <span
        className={cn(
          "ring-secondary absolute top-0 -left-9 flex size-6 items-center justify-center rounded-full text-white ring-4",
          nodeClass,
        )}
      >
        {node}
      </span>
      <p className="text-muted-foreground mb-2 pt-1 text-[11px] font-semibold tracking-widest uppercase">
        {label}
      </p>
      {children}
    </section>
  );
}

/** A reply with each [Title, p. N] citation linked to that page of the PDF. */
function CitedText({ text }: { text: string }) {
  return splitCitations(text).map((part, i) =>
    typeof part === "string" ? (
      part
    ) : (
      <a
        key={i}
        href={part.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary font-medium underline underline-offset-2"
      >
        {part.label}
      </a>
    ),
  );
}

/** Thought summaries arrive as markdown: render **bold** and `code`. */
function InlineMarkdown({ text }: { text: string }) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return (
        <strong key={i} className="text-foreground not-italic">
          {part.slice(2, -2)}
        </strong>
      );
    if (part.startsWith("`") && part.endsWith("`"))
      return (
        <code key={i} className="font-mono not-italic">
          {part.slice(1, -1)}
        </code>
      );
    return part;
  });
}

function ToolCard({ step, number }: { step: ToolStep; number: number }) {
  return (
    <div
      data-testid="tool-call"
      data-tool={step.name}
      className="bg-card overflow-hidden rounded-xl border text-sm"
    >
      <div className="bg-accent flex items-center gap-2 px-3 py-2 text-white">
        <span className="font-mono font-bold">{step.name}()</span>
        <span className="rounded bg-white/20 px-1.5 text-[10px]">
          tool {number}
        </span>
        <span className="ml-auto text-xs text-white/80">
          {TOOL_LABELS[step.name] ?? "Using a tool"}
        </span>
      </div>
      <div className="space-y-2 px-3 py-3">
        <p className="text-muted-foreground flex items-center gap-1 text-[11px] font-semibold tracking-widest uppercase">
          <ArrowRightIcon className="size-3" /> What Copper sent
        </p>
        {step.input === undefined ? (
          <p className="text-muted-foreground text-xs italic">
            filling in the details…
          </p>
        ) : (
          <ToolInput name={step.name} input={step.input} />
        )}
      </div>
      <div className="bg-accent/10 space-y-2 border-t px-3 py-3">
        <p className="text-muted-foreground flex items-center gap-1 text-[11px] font-semibold tracking-widest uppercase">
          <ArrowLeftIcon className="size-3" /> What came back
        </p>
        {step.state === "calling" ? (
          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            <Spinner className="size-3" /> the app is running the code…
          </p>
        ) : step.state === "error" ? (
          <p className="text-chart-3 text-xs">{String(step.output)}</p>
        ) : (
          <ToolOutput name={step.name} output={step.output} />
        )}
      </div>
    </div>
  );
}

const NAMES: Record<string, string> = Object.fromEntries([
  ...getProducts().map((p) => [p.id, p.name]),
  ...getPlans().map((p) => [p.id, p.name]),
]);

const nameOf = (value: unknown) =>
  Array.isArray(value)
    ? value.map((v) => NAMES[String(v)] ?? String(v)).join(", ") || "None"
    : (NAMES[String(value)] ?? String(value));

const NO_INPUT: Record<string, string> = {
  get_prices: "Nothing, it just asked for the price list",
  get_products: "Nothing, it just asked what Copper sells",
};

function ToolInput({ name, input }: { name: string; input: unknown }) {
  const entries = Object.entries((input ?? {}) as Record<string, unknown>);
  if (entries.length === 0)
    return (
      <p className="text-muted-foreground text-xs">
        {NO_INPUT[name] ?? "Nothing"}
      </p>
    );
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
      {entries.map(([field, value]) => (
        <div key={field} className="contents">
          <dt className="text-muted-foreground capitalize">{field}</dt>
          <dd className="font-medium">{nameOf(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any -- tool outputs arrive untyped from the stream */
function ToolOutput({ name, output }: { name: string; output: any }) {
  if (name === "calculate_cost" && output?.lines)
    return (
      <div className="text-xs">
        {output.lines.map((line: any) => (
          <div key={line.item} className="flex justify-between py-0.5">
            <span>{line.item}</span>
            <span className="font-mono">{formatUsd(line.usd)}</span>
          </div>
        ))}
        <div className="mt-1 flex items-baseline justify-between border-t pt-2">
          <span className="font-semibold">Total</span>
          <span className="text-primary text-xl font-bold">
            {formatUsd(output.totalUsd)}
          </span>
        </div>
      </div>
    );
  if (name === "get_products" && output?.products)
    return (
      <div className="space-y-2 text-xs">
        {output.products.map((p: any) => (
          <div key={p.id}>
            <div className="flex justify-between font-medium">
              <span>{p.name}</span>
              <span className="font-mono">{formatUsd(p.priceUsd)}</span>
            </div>
            <p className="text-muted-foreground">{p.type}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {p.colors.map((c: string) => (
                <span key={c} className="bg-accent/15 rounded-full px-2 py-0.5">
                  {c}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  if (name === "get_prices" && output?.products)
    return (
      <div className="text-xs">
        {output.products.map((p: any) => (
          <div key={p.id} className="flex justify-between py-0.5">
            <span>{p.name}</span>
            <span className="font-mono">{formatUsd(p.priceUsd)}</span>
          </div>
        ))}
        {output.plans
          .filter((p: any) => p.monthlyUsd > 0)
          .map((p: any) => (
            <div key={p.id} className="flex justify-between py-0.5">
              <span>{p.name}</span>
              <span className="font-mono">
                {formatUsd(p.monthlyUsd)}/mo · {formatUsd(p.annualUsd)}/yr
              </span>
            </div>
          ))}
      </div>
    );
  if (name === "check_availability" && output?.status) {
    if (output.status === "unavailable")
      return <p className="text-xs">{output.message}</p>;
    if (output.status === "not_a_color")
      return (
        <p className="text-xs">
          {output.product} doesn&apos;t come in {output.color}. It comes in{" "}
          {output.colors.join(", ")}.
        </p>
      );
    return (
      <div className="space-y-1 text-xs">
        {output.colors.map((c: any) => (
          <div key={c.color} className="flex items-center justify-between">
            <span>{c.color}</span>
            <StockPill stock={c.stock} restockDate={c.restockDate} />
          </div>
        ))}
      </div>
    );
  }
  if (name === "search_docs" && output?.matches)
    return (
      <ol className="space-y-2 text-xs">
        {output.matches.map((m: any) => (
          <li key={`${m.url}-${m.text}`} className="space-y-0.5">
            <div className="flex items-baseline justify-between gap-2">
              <a
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary font-medium underline-offset-2 hover:underline"
              >
                {m.title}, page {m.page}
              </a>
              <span className="text-muted-foreground shrink-0 font-mono">
                {m.score.toFixed(2)}
              </span>
            </div>
            <p className="text-muted-foreground line-clamp-3">{m.text}</p>
          </li>
        ))}
      </ol>
    );
  if (name === "get_orders" && output?.status === "ok")
    return output.orders.length === 0 ? (
      <p className="text-xs">No orders found for that.</p>
    ) : (
      <ul className="space-y-1.5 text-xs">
        {output.orders.map((o: any) => (
          <li key={o.id} className="flex items-start justify-between gap-2">
            <span>
              <span className="font-mono font-semibold">{o.id}</span>{" "}
              {o.items.join(", ")}
            </span>
            <span className="shrink-0 text-right">
              <span className="font-mono">{formatUsd(o.totalUsd)}</span>
              {o.refund && (
                <span className="text-muted-foreground block">
                  refund {o.refund.status}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    );
  if (name === "get_orders" && output?.status === "need_details")
    return <p className="text-xs">{output.message}</p>;
  if (name === "request_refund" && output?.status) {
    const refund = output.refund;
    if (output.status === "not_found")
      return <p className="text-xs">No order {output.orderId}.</p>;
    const label =
      output.status === "refunded"
        ? `Refunded ${formatUsd(refund.amountUsd)}`
        : output.status === "pending_approval"
          ? `Waiting for a person: ${formatUsd(refund.amountUsd)} is over the limit`
          : `Already asked for: ${refund.status}`;
    return (
      <div className="space-y-1 text-xs">
        <Pill
          className={
            output.status === "refunded"
              ? "bg-accent text-white"
              : "bg-chart-4 text-chart-5"
          }
        >
          {label}
        </Pill>
        <p className="text-muted-foreground">
          Order {refund.orderId}, refund {refund.id}
        </p>
      </div>
    );
  }
  if (output?.status === "transferred")
    return (
      <p className="text-xs">
        Chat handed to {output.to}: {output.summary}
      </p>
    );
  // A tool without its own layout yet: show what came back as plain text.
  return (
    <pre className="max-h-48 overflow-auto text-xs whitespace-pre-wrap">
      {typeof output === "string" ? output : JSON.stringify(output, null, 2)}
    </pre>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function StockPill({
  stock,
  restockDate,
}: {
  stock: string;
  restockDate: string | null;
}) {
  if (stock === "in_stock")
    return <Pill className="bg-accent text-white">In stock</Pill>;
  if (stock === "low_stock")
    return <Pill className="bg-chart-4 text-chart-5">Low stock</Pill>;
  const date = restockDate
    ? new Date(`${restockDate}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "later";
  return (
    <Pill className="bg-chart-3 text-white">Back-ordered until {date}</Pill>
  );
}

function Pill({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
        className,
      )}
    >
      {children}
    </span>
  );
}
