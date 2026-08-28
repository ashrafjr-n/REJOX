# Rejox — A Complete Guide to the Backend

*A teaching document for students who are new to programming, new to React, and
new to backend engineering.*

---

## How to read this document

This document explains **everything** about the backend of a real system called
Rejox: what it does, how it is built, why it is built that way, what is good
about it, and what is wrong with it.

It assumes **no prior knowledge**. Every term is explained the first time it
appears. If you already know a term, skip the explanation box — but the boxes
are short on purpose.

The document is organised so that each part builds on the previous one:

| Part | Question it answers |
| --- | --- |
| 1 | What problem does Rejox solve? |
| 2 | What background do I need? (React, React Native, backend, AST…) |
| 3 | What is the overall shape of the system? |
| 4 | What happens, step by step, when a user uses it? |
| 5 | How is each stage actually built? |
| 6 | How does the AI part work, and why is it so small? |
| 7 | How does the system prove its output works? |
| 8 | How does the web server work? |
| 9 | How is it kept safe? |
| 10 | How is it deployed and operated? |
| 11 | What design principles run through all of it? |
| 12 | What are the strengths and weaknesses? |
| 13 | What could break, and what should be built next? |

At the end there is a glossary and a conclusion.

---

# Part 1 — What Rejox Is

## 1.1 The problem

A company has a website built with **React**. The website works well in a web
browser. Now the company wants a **mobile app** — a real app that people install
from the App Store or Google Play.

They have three options:

1. **Write the mobile app from scratch.** Expensive and slow. All the business
   logic that already exists gets rewritten by hand.
2. **Wrap the website in an app shell.** Cheap, but the result feels like a
   website in a box, not a real app.
3. **Rewrite the website's code into React Native.** React Native is a
   technology that lets you write mobile apps using the same language and the
   same mental model as React. Much of the code is *nearly* reusable — but
   "nearly" is doing a lot of work in that sentence, and doing this by hand
   across hundreds of files is slow and error-prone.

Rejox automates option 3.

> **What is React?**
> A tool (a "library") made by Meta for building user interfaces. You describe
> what the screen should look like, and React puts it on the page. Its main idea
> is the **component**: a reusable piece of interface, like a button or a product
> card, written as a function.
>
> **What is React Native?**
> The same idea, but the output is a real mobile app instead of a web page.
> The language is the same, the components are similar, but the building blocks
> are different: web React draws `<div>` and `<img>`; React Native draws `<View>`
> and `<Image>`.

## 1.2 What Rejox actually is

**Rejox is an AI-assisted migration system that converts a React web project
into a React Native mobile project.**

The most important sentence in the whole project is this one, and it is written
at the top of the project's own instructions file:

> **Resolve by rules whatever rules can resolve. Invoke AI only where genuine
> reasoning is required.**

This deserves unpacking, because it is the entire design philosophy.

A naive approach would be: "take the whole file, send it to an AI model, ask it
to convert the file to React Native." This works sometimes. But it has four
serious problems:

1. **It is not repeatable.** Ask an AI the same question twice and you can get
   two different answers. For a tool that rewrites a company's codebase, this is
   unacceptable.
2. **It is expensive.** Every file costs money in API fees.
3. **It cannot explain itself.** If the AI changed something, you cannot ask it
   "which rule made you do that?" — there was no rule.
4. **It hides what it does not know.** An AI will produce confident-looking code
   for a case it does not understand.

Rejox does the opposite. It converts as much as possible with **deterministic
rules** — code that always produces the same output for the same input — and it
uses AI only for the small remainder where a genuine judgement call is needed.

> **What does "deterministic" mean?**
> Same input → same output, every single time. A calculator is deterministic:
> `2 + 2` is always `4`. Rolling a dice is not. Most of Rejox is a calculator.

On the project's own benchmark app, this design produces **exactly one AI call**
for a whole project migration. Everything else is rules.

## 1.3 What Rejox is not

The project's instructions explicitly forbid one description:

> Never describe Rejox as a "code converter".

The reason is that a "converter" implies a dumb text-substitution tool. Rejox
*understands* the project first — it builds a model of what the project contains
and how the pieces relate — and only then converts. It also *reports* on what it
did, what it could not do, and how confident it is. That reporting is as much the
product as the converted code.

## 1.4 Scope: what it supports on purpose

Rejox deliberately supports a **narrow** set of technologies. This is a design
decision, not a limitation of effort. A tool that claims to convert everything
converts nothing well.

**Supported:**

| Area | What is supported |
| --- | --- |
| Components | Function components (the modern React style) |
| Logic | React hooks (`useState`, `useEffect`, custom hooks) |
| Navigation | React Router → React Navigation |
| Data fetching | `axios`, `fetch` |
| Styling | CSS Modules, Tailwind (via NativeWind) |

**Explicitly not supported** (and *reported*, never silently ignored): Redux,
Three.js/WebGL, `<canvas>`, Electron, server-side rendering, Next.js, and the
reverse direction (React Native → web).

> **Why announce what you cannot do?**
> Because the alternative is worse. If a tool silently produces broken output for
> an unsupported feature, the user discovers the problem weeks later. If it says
> "I found Redux, and I do not support Redux," the user can decide what to do in
> the first five minutes. This idea — **fail loudly, never silently** — appears
> again and again in this document.

---

# Part 2 — Background Concepts You Need

This part explains the general ideas used throughout the system. If you find a
term later that you do not recognise, it is probably defined here or in the
glossary at the end.

## 2.1 Frontend and backend

A **frontend** is the part of a system a user sees and touches — the buttons,
the pages, the forms. It runs on the user's device.

A **backend** is the part that runs on a server somewhere else. It does the work
that must be trusted or that is too heavy for a user's device: storing data,
running long computations, talking to other services.

Rejox has both. The frontend is a website where you upload your project and watch
progress. **This document is about the backend** — the part that does the actual
analysis and conversion.

## 2.2 What a "server" and an "API" are

A **server** is a program that waits for requests and answers them. When your
browser loads a page, it sends a request to a server, and the server sends a
response.

An **API** (Application Programming Interface) is the list of requests a server
understands. For example, Rejox's backend understands:

- `POST /api/upload` — "here is a zip file of my project"
- `POST /api/analyze` — "tell me about this project"
- `POST /api/migrate` — "convert it"

> **What do `POST` and `GET` mean?**
> They are HTTP *methods* — the verb of a request. `GET` means "give me
> something" and changes nothing. `POST` means "here is some data, do something
> with it." Reading a report is a `GET`; uploading a file is a `POST`.

Each response carries a **status code**, a number saying how it went:

| Code | Meaning | Example in Rejox |
| --- | --- | --- |
| `200` | OK | Here is your analysis |
| `202` | Accepted | Migration started, it will take a while |
| `400` | Bad request | Your zip file is invalid |
| `401` | Unauthorised | You did not send an API key |
| `422` | Unprocessable | Your upload has no React components in it |
| `429` | Too many requests | You are going too fast, slow down |
| `500` | Server error | We have a bug |
| `503` | Service unavailable | The server is not configured correctly |

Notice that these codes carry meaning about *whose fault* something is. `4xx`
means "the problem is in what you sent." `5xx` means "the problem is ours." Rejox
takes this distinction seriously, and we will see a place where it deliberately
chose `422` over `500` for exactly this reason.

## 2.3 Source code, parsing, and the AST

When you write code, you write **text**. But text is very hard for a program to
edit safely. Consider this:

```javascript
const message = "the <div> tag is common";
```

If a program searched the text for `<div>` and replaced it with `<View>`, it
would corrupt this string — the `<div>` here is just text inside a message, not
an actual element.

The solution is **parsing**. A parser reads the text and builds a **tree**
structure that represents what the code *means*, not just what it *looks like*.
This tree is called an **AST** — an **A**bstract **S**yntax **T**ree.

> **A simple analogy.**
> The sentence "The cat sat on the mat" is text. A grammar teacher would draw it
> as a tree: subject (*the cat*), verb (*sat*), prepositional phrase (*on the
> mat*). The tree tells you the *structure*. Now you can safely say "replace the
> subject" without accidentally editing the word "the" inside "the mat".

Rejox never edits code as text. It parses code into an AST, changes nodes in the
tree, and writes the tree back out as code. This is called a **codemod** (a
*code modification*), and it is why Rejox can be trusted with real codebases.

The library that does this in Rejox is called **ts-morph**, which is a friendly
wrapper around the official TypeScript compiler's parser.

## 2.4 TypeScript

**TypeScript** is JavaScript with **types**. A type says what kind of value
something is:

```typescript
let age: number = 25;        // must be a number
let name: string = "Sara";   // must be text
```

The benefit is that mistakes are caught **before** the program runs. If you try
`age = "twenty-five"`, TypeScript refuses to compile.

This matters enormously for Rejox: after converting a project, Rejox runs the
TypeScript compiler on the output. If the compiler is happy, that is real
evidence the conversion produced valid code — not a guess, a *proof*.

> **`.ts` vs `.tsx`, `.js` vs `.jsx`**
> The `x` means the file contains JSX — the HTML-looking syntax React uses. So
> `.tsx` is "TypeScript with React syntax". Remember this: it becomes important
> in Part 12, where a single check on these file extensions caused the system's
> largest known bug.

## 2.5 What a "pipeline" is

A **pipeline** is a series of stages where the output of one stage becomes the
input of the next. Like a factory production line.

```
[raw material] → [stage 1] → [stage 2] → [stage 3] → [finished product]
```

The benefits are:

- **Each stage does one job**, so each is simple enough to understand.
- **Each stage can be tested alone**, by giving it fake input.
- **Stages can be replaced** without rewriting the others.

Rejox is built as a pipeline of eight stages, which Part 4 walks through.

## 2.6 Data models and validation

When one part of a program passes data to another, both sides must agree on the
shape of that data. If the parser says a component has a field called `name` and
the analyser looks for `componentName`, everything breaks.

Rejox solves this with **pydantic**, a Python library where you *declare* the
shape of your data as a class:

```python
class Component(KGBase):
    id: str
    name: str
    file: str
    props: list[PropInfo] = Field(default_factory=list)
```

This says: a Component must have an `id` that is text, a `name` that is text, a
`file` that is text, and a list of props. If data arrives that does not match,
pydantic raises an error immediately.

Rejox goes one step further. Its base class says:

```python
model_config = ConfigDict(extra="forbid")
```

`extra="forbid"` means: **reject data that contains fields we did not declare.**

> **Why is rejecting unknown fields a good idea?**
> Imagine the parser is updated to send `componentName` instead of `name`. Without
> `forbid`, the extra field is silently ignored, `name` is missing, and something
> breaks confusingly three stages later. With `forbid`, the error happens
> instantly, at the boundary, with a clear message. This is called **failing
> fast**, and it is one of the most valuable habits in engineering.

## 2.7 Contracts and boundaries

A **boundary** is a place where one part of a system hands data to another. A
**contract** is the agreement about what crosses it.

Rejox has several important boundaries:

- Node parser worker → Python (the Knowledge Graph, as JSON)
- Python → Node codemod worker (a file plus options, as JSON)
- Backend → frontend (API responses, as JSON)
- API process → worker process (a job, through a queue)

Every one of these is a pydantic model. The project's own coding rules require
it: *"All data crossing a boundary is a pydantic model."* This is a system-design
principle called **explicit contracts** — the shape of data between components is
written down and enforced, not assumed.

## 2.8 Separation of concerns

**Separation of concerns** means each part of a system should be responsible for
one kind of thing.

In Rejox:

- `intelligence.py` only *understands* code. It never changes it.
- `analyzer.py` only *judges* the understanding. It never parses or changes code.
- `transformer.py` only *changes* code. It never judges.
- `validator.py` only *checks* the result. It never fixes it.

This is why the system is comprehensible despite being large. When something goes
wrong, the failure has an address.

## 2.9 A "seam"

A **seam** is a single, deliberate place in the code where a decision is made, so
that changing the decision means editing one file rather than fifty.

Rejox has three important seams, all built the same way:

| Seam | Decision it owns |
| --- | --- |
| `ai/provider.py` | Which AI vendor do we call? |
| `pipeline/sandbox.py` | How do we safely run untrusted code? |
| `queue.py` | Where does a long job actually run? |

Each has multiple *implementations* behind one interface. This is the
**Strategy pattern**, and it is what makes the system testable: tests plug in a
fake AI provider and never touch the network.

---

# Part 3 — The Architecture

## 3.1 The big picture

```
                        ┌─────────────────────┐
   User's browser  ───► │   Frontend (React)  │
                        └──────────┬──────────┘
                                   │ HTTP
                        ┌──────────▼──────────┐
                        │   API  (FastAPI)    │  main.py
                        │  auth · rate limits │  security.py
                        └──────────┬──────────┘
                                   │ enqueue
                        ┌──────────▼──────────┐
                        │   Queue  (Redis)    │  queue.py
                        └──────────┬──────────┘
                                   │
                        ┌──────────▼──────────┐
                        │  Worker process     │  worker.py
                        │  runs the pipeline  │  jobs.py
                        └──────────┬──────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
  ┌───────────┐            ┌──────────────┐          ┌────────────────┐
  │  Node:    │            │   Python     │          │  Sandbox       │
  │  parser   │            │   pipeline   │          │  container     │
  │  codemod  │            │   stages     │          │  npm/tsc/Metro │
  └───────────┘            └──────────────┘          └────────────────┘
```

Three different runtimes cooperate:

1. **Python** — the pipeline logic, the scoring, the web API. Chosen because it
   is excellent for orchestration and data modelling.
2. **Node.js** — the two workers that parse and transform JavaScript/TypeScript.
   Chosen because the best tool for understanding TypeScript is the TypeScript
   compiler itself, and that is written in TypeScript.
3. **A throw-away container** — where the *user's* code is executed during
   validation. Explained fully in Part 9.

> **Why not do everything in Python?**
> Python has no first-class TypeScript parser. You could write one, but you would
> be reimplementing a compiler that Microsoft maintains full-time and that
> already handles every edge case of a huge language. The project's rule is
> explicit: *"The worker is the single source of parsing truth — Python never
> parses JS/TS itself."* Using the right tool for each job, even at the cost of
> a second language, is usually correct.

## 3.2 The engines

The project describes itself as a set of focused **engines**. Here they are with
the file that implements each:

| Engine | File | Responsibility |
| --- | --- | --- |
| Project Intelligence Engine | `pipeline/intelligence.py` + `parser-worker/` | Read the project, build a Knowledge Graph |
| Analyzer | `pipeline/analyzer.py` + `pipeline/rules/` | Judge the graph: findings and scores |
| Library Detector | `pipeline/rules/libraries.py` | Map dependencies to RN equivalents |
| Migration Planner | `pipeline/planner.py` | Turn findings into an ordered plan + questions |
| Deterministic Transformer | `pipeline/transformer.py` + `codemod-worker/` | Rewrite one file, by rules |
| AI Resolution Engine | `ai/` | Resolve the residue rules cannot |
| Emitter | `pipeline/emit.py` | Assemble the whole output project |
| Validator | `pipeline/validator.py` | Prove it works with real tools |
| Repair loop | `pipeline/repair.py` | One targeted AI fix, then stop |
| Reporter | `pipeline/reporter.py` | Human-readable reports |
| Sandbox | `pipeline/sandbox.py` | Safely execute untrusted code |
| Queue | `queue.py`, `jobs.py`, `worker.py` | Where long jobs run |
| Security | `security.py` | Who may call, and how often |
| Retention | `retention.py` | Delete user data on a schedule |

## 3.3 The directory layout

```
rejox/
├── backend/
│   ├── app/
│   │   ├── main.py           the HTTP API
│   │   ├── cli.py            the terminal interface
│   │   ├── jobs.py           job state
│   │   ├── queue.py          job dispatch
│   │   ├── worker.py         the worker process
│   │   ├── security.py       API keys + rate limits
│   │   ├── retention.py      data deletion
│   │   ├── models/           pydantic contracts
│   │   ├── pipeline/         the eight stages
│   │   │   ├── rules/        the Analyzer's rule modules
│   │   │   └── templates/    the scaffold's file templates
│   │   └── ai/               the AI Resolution Engine
│   │       ├── css/          CSS Module resolver
│   │       ├── styling/      Tailwind resolver (3 tiers)
│   │       └── navigation/   navigator resolver
│   ├── parser-worker/        Node: code → Knowledge Graph
│   ├── codemod-worker/       Node: React → React Native
│   └── tests/                ~290 automated tests
├── frontend/                 the React web interface
├── docs/                     architecture, rules, security, PRD
└── docker-compose.yml        the deployment
```

Notice that `models/` sits *beside* `pipeline/`, not inside it. That is
deliberate: the data contracts are shared by every stage, so they belong to
nobody in particular.

---

# Part 4 — The Eight-Stage Pipeline

Every migration flows through the same eight stages, in order. This part is the
narrative; Part 5 goes inside each one.

```
1. Upload  →  2. Intelligence  →  3. Report  →  4. Plan
                                                   ↓
8. Download ←  7. Review  ←  6. Migrate  ←  5. Ask
```

**Stage 1 — Upload.** The user sends a zip file or a public GitHub link. Rejox
extracts it into an isolated folder called a *run workspace* and finds the React
project inside it.

**Stage 2 — Intelligence.** Rejox reads every source file and builds a
**Knowledge Graph**: a structured description of the whole project. This stage
only *understands*; it changes nothing.

**Stage 3 — Report.** Rejox walks the graph and produces findings and three
scores: Coverage, Confidence, and Risk. The user sees what their project uses and
how migratable it is — *before* anything is converted.

**Stage 4 — Plan.** The findings become an ordered list of steps: set up the
project, map the routes, port the state, convert components in dependency order,
handle styling, copy assets, validate.

**Stage 5 — Ask.** Some decisions cannot be made from evidence alone. Rejox asks
the user — but only when a real finding justifies a question.

**Stage 6 — Migrate.** The conversion. The Deterministic Transformer runs first
over every file; the AI Resolution Engine handles only the leftovers.

**Stage 7 — Review.** Rejox runs the *real* TypeScript compiler and the *real*
mobile bundler against the output. Not a simulation — the actual tools.

**Stage 8 — Download.** The user receives a zip of a working React Native
project, plus a report explaining every decision.

> **Why does "Ask" come after "Plan" and not before?**
> Because a question you can answer from evidence is not a question worth asking.
> By planning first, Rejox knows exactly which decisions remain genuinely open,
> and asks only those. Respecting the user's attention is a design feature.

---

# Part 5 — Inside Each Stage

## 5.1 Stage 1 — Upload and the trust boundary

**File:** `pipeline/ingest.py` (356 lines) and `pipeline/workspace.py`

This is where a stranger's data enters the system. The file's own documentation
calls it **"the trust boundary"**, and the code is written defensively.

### The run workspace

Every migration gets an isolated folder:

```
.rejox-workspaces/
└── a3f9c2e1…/            ← the runId, a random hex string
    ├── source/           ← the user's uploaded project
    ├── output/           ← the generated React Native project
    ├── ingest.json       ← what we extracted
    └── job.json          ← the live job state
```

The `runId` is a random 32-character hex string. It is validated on *every*
lookup against a strict pattern:

```python
_RUN_ID_RE = re.compile(r"^[0-9a-f]{8,64}$")
```

> **Why validate an ID you generated yourself?**
> Because it does not stay yours. The user sends it back in a URL like
> `/api/runs/{runId}/download`. If someone sent `../../etc/passwd` as a runId and
> the code joined it to a path, they could read files anywhere on the server.
> This attack is called **path traversal**, and validating the ID at every lookup
> is what stops it. **Never trust input just because it originally came from you.**

### Four defences against a hostile zip file

A zip file uploaded by a stranger can be an attack. Rejox defends against four
distinct ones:

**1. Path traversal.** A zip entry can be named `../../../etc/cron.d/evil`.
Extracting it naively writes outside the intended folder. Rejox rejects any entry
that is absolute or contains `..`:

```python
if ".." in pure.parts:
    raise IngestError(f"Rejected archive: path traversal ('..') in entry '{name}'.")
```

**2. Malicious symlinks.** A **symlink** is a file that points at another file. A
zip can contain a symlink pointing to `/etc/passwd`. Rejox rejects any symlink
resolving outside the extraction root.

**3. Zip bombs.** A **zip bomb** is a small file that expands enormously — a few
kilobytes becoming many gigabytes, filling the disk. Naive code checks the size
the zip file *claims*. Rejox does something better: it streams each entry through
a *running byte counter* and aborts the moment the **actual** total crosses the
limit.

> **Why does that distinction matter?**
> Because the header is written by the attacker. It can lie. The bytes actually
> written to disk cannot. This is a general security rule: **verify the reality,
> not the claim.**

**4. Size and count limits.** Compressed size (100 MB), uncompressed size
(500 MB), and file count (20,000) each have a ceiling, all configurable.

Additionally, `node_modules`, `.git`, `dist` and `build` are skipped entirely —
they are never source code and would dominate the limits.

### Finding the React project

An uploaded zip rarely has the project at the top. It might be
`my-app-main/frontend/package.json`. So Rejox searches for every `package.json`
that declares React as a dependency, and sorts the results shallowest-first:

```python
candidates.sort(key=lambda c: (_depth(c), c.path))
```

If none is found, ingestion fails with a clear message. All candidates are
returned, so a user with a *monorepo* (one repository containing several
projects) can choose which one to migrate.

## 5.2 Stage 2 — The Project Intelligence Engine

**Files:** `pipeline/intelligence.py` + the Node `parser-worker/`

This stage answers: *what is in this project?*

### How the two languages cooperate

Python does not parse the code itself. It runs the Node worker as a **subprocess**
— a separate program — and reads what it prints:

```python
proc = _run([node, str(WORKER_ENTRY), str(project_path)], WORKER_DIR, PARSE_TIMEOUT_SECONDS)
raw = json.loads(proc.stdout)
return KnowledgeGraph.model_validate(raw)
```

Three lines, three ideas:

1. **Run** the worker, giving it the project path.
2. **Parse** its standard output as JSON.
3. **Validate** that JSON against the pydantic contract.

That third line is the important one. The Node worker could send anything. The
Python side does not trust it — it validates. And because of `extra="forbid"`,
if the two sides ever disagree about the schema, the error is immediate and
precise instead of mysterious and delayed.

> **What is standard output (`stdout`)?**
> Every program has two output channels: `stdout` for results and `stderr` for
> error messages. Keeping them separate means a program can print progress
> messages to `stderr` without corrupting the JSON on `stdout`. Rejox relies on
> this: the worker's data goes to `stdout`, its diagnostics to `stderr`.

### The Knowledge Graph

The output is a **Knowledge Graph** — the central data structure of the whole
system, defined in `models/knowledge_graph.py`.

> **What is a graph?**
> In computing, a graph is a set of **nodes** (things) connected by **edges**
> (relationships). A social network is a graph: people are nodes, friendships are
> edges. Here, files and components are nodes, and "this component renders that
> one" is an edge.

The graph contains:

| Part | What it holds |
| --- | --- |
| `project` | Name, language (`ts`/`js`/`mixed`), bundler, dependencies |
| `files` | Every file, its type, its line count |
| `components` | Every component, in detail (see below) |
| `hooks` | Custom hooks and who uses them |
| `routes` | The URL → screen table |
| `stateManagement` | Zustand stores and their keys |
| `apiLayer` | HTTP clients and endpoints |
| `assets` | Images, icons, fonts |
| `edges` | Relationships: `renders`, `imports`, `uses-hook`, `uses-store`, `calls-api` |
| `warnings` | Files the parser could not fully read |

The `Component` record is the richest, and reading it tells you what the system
cares about:

```python
class Component(KGBase):
    name: str
    file: str
    props: list[PropInfo]              # what it accepts
    hooksUsed: list[str]               # useState, useEffect, …
    childComponents: list[str]         # what it renders
    jsxElements: dict[str, int]        # {"div": 4, "img": 1}
    eventHandlers: list[str]           # onClick, onSubmit, …
    stylingApproach: list[...]         # tailwind / css-module / inline
    tailwindClasses: list[str]         # every class used
    webApis: list[str]                 # localStorage, window, …
    textNodes: list[TextNodeInfo]      # bare text needing <Text>
    layoutHints: list[LayoutHint]      # flex direction, grid usage
    images: list[ImageInfo]            # sized? where does src come from?
    inlineStyles: list[InlineStyleInfo]
```

Look at the last four fields. They are labelled in the source as
**"Conversion facts (feed the Deterministic Transformer)"**. This is a beautiful
piece of design: the parser does not just describe the code, it records
*precisely the facts the converter will need later*.

For example, `textNodes` records whether a piece of text is "bare" — not already
inside a text element. In React Native, all text must be inside `<Text>`. Because
the parser noted this during understanding, the transformer does not have to
re-derive it during conversion.

> **The principle here is "understand once, use many times."**
> Parsing is expensive. Deriving facts during parsing and storing them in the
> graph means every later stage reads a cheap lookup instead of re-analysing
> source code. This is a form of **caching**, and also of **separation of
> concerns**: the parser owns knowing, everyone else owns using.

### The warnings field

If the parser cannot fully read a file, it does not crash and it does not pretend.
It adds a message to `warnings`. Those warnings become findings in the report, so
the user learns that a file was only partially understood.

## 5.3 Stage 3 — The Analyzer

**Files:** `pipeline/analyzer.py` + `pipeline/rules/*.py`

This stage answers: *how migratable is this project, and why?*

It is **pure**: it reads the graph and returns a report. It touches no files, no
network, no AI. Given the same graph it always produces the same report.

### The rules modules

The analysis is split into small rule files:

| File | Job |
| --- | --- |
| `components.py` | Per-component issues: web-only elements, events, browser APIs |
| `libraries.py` | Map each dependency to an RN verdict |
| `styling.py` | Tailwind and CSS Module problems |
| `routing.py` | The route table and router issues |
| `domains.py` | What the app *does*: auth, payments, maps |
| `parsing.py` | Turn parser warnings into findings |
| `scoring.py` | Compute the three scores |
| `codes.py` | The issue-code vocabulary |

### Data-driven rules

Notice how the component rules are written. They are not long `if/else` chains —
they are **tables**:

```python
ELEMENT_MAP: dict[str, tuple[str, str]] = {
    "img":    ("Image", "info"),
    "button": ("Pressable", "info"),
    "select": ("@react-native-picker/picker", "warning"),
    "table":  ("—", "blocker"),
    "canvas": ("—", "blocker"),
}
```

Each entry maps a web element to its React Native equivalent and a **severity**:

- `info` — a real but mechanical change
- `warning` — needs a library swap or human review
- `blocker` — no equivalent exists in the supported scope

> **Why is a table better than code?**
> Adding support for a new element means adding one line of data, not writing
> new logic. Data is easier to read, easier to review, easier to test, and much
> harder to get subtly wrong. This is called **data-driven design**, and Rejox
> uses it everywhere: elements, events, libraries, domains, and CSS properties
> are all tables.

There is also a `TRIVIAL_ELEMENTS` set — `div`, `span`, `p`, headings, and so on.
Elements in this set produce **no issue at all**, because they convert by a
trivial rename. Deliberately staying silent about the easy cases is what keeps
the report readable.

### Domain risk: a different level of abstraction

`domains.py` does something the other rules do not. Instead of asking "what
elements does this component use?", it asks **"what does this application
do?"** — is it handling authentication? payments? maps?

This matters because a payment screen that converts perfectly is still riskier
than a settings screen that converts perfectly. The consequences of a subtle bug
differ.

The detection is strictly evidence-based, and the code is explicit about the
distinction:

- **Triggering signals**: a dependency (`@stripe/…`) or an API endpoint/route
  pattern (`/checkout`). One of these is required.
- **Corroborating signals**: component names, browser API usage. These are
  *recorded as evidence* but can **never** trigger a domain alone.

> **Why the two-tier distinction?**
> Because a component called `PaymentCard` might be a UI card with a picture of a
> credit card. Guessing from names produces false alarms, and a tool that cries
> wolf gets ignored. Requiring a hard signal, then adding names as supporting
> detail, gives both accuracy and a readable explanation.

### The three scores

Rejox reports three **independent** numbers. The code comments stress that they
are never combined:

**Coverage (0–100): how much of the project can be migrated.**

It is built as a list of signed contributions that sum *exactly* to the final
number. Each area has a budget:

```python
AREA_BUDGETS = {
    "components": 40.0,
    "libraries":  25.0,
    "styling":    20.0,
    "routing":    10.0,
    "api":         5.0,
}
```

Positive rows grant budget; negative rows deduct for problems. The output looks
like this:

```
+40.00  Functional components   All 21 components use the supported architecture
+20.00  Styling surface         Tailwind's mechanical majority maps 1:1
+10.00  Routing (react-router)  The route table is graph-resolved
 -4.00  Hover styling           HOVER_STATE has no clean RN mapping
 -0.57  CSS grid layout         CSS_GRID reduces per-component convertibility
```

> **Why must the rows sum exactly to the score?**
> Because it makes the number **auditable**. A user who distrusts "82%" can read
> the rows and check the arithmetic. A score you cannot decompose is a score you
> must take on faith — and this project's whole value proposition is not asking
> for faith. This is the principle of **explainability**.

**Confidence (0–100): how sure we are that what migrated is correct.**

This is the subtlest idea in the system. Confidence is computed **from
provenance** — from *how* something was converted, not from a guess:

| How it was converted | Confidence value |
| --- | --- |
| Deterministic rule, no warning | 100 |
| Deterministic rule with a warning | 80 |
| AI-resolved and the validator passed | 65 |
| AI-resolved and the validator failed | 0 |
| Residue (not converted at all) | *excluded* |

Notice the last row. Unconverted residue is **excluded from Confidence** and
counts against **Coverage** instead.

> **Why exclude it rather than score it zero?**
> Because the two questions are genuinely different. Coverage asks *"how much
> did we do?"* Confidence asks *"how good is what we did?"* A file we did not
> touch should lower the first and have no opinion about the second. Mixing them
> would produce one number that answers neither question — which is exactly what
> the code comment says the old single `migrationScore` did, and why it was
> "therefore dishonest."

**Risk (low/medium/high): the worst detected domain risk.** Low when no risky
domain is detected — and that rule is documented, not implicit.

## 5.4 Stage 4 — The Planner

**File:** `pipeline/planner.py` (674 lines)

The Planner turns findings into an ordered plan, and decides which questions to
ask. It is deterministic and calls no AI.

### Ordering by dependency waves

Components depend on each other. A `ProductPage` renders a `ProductCard`, which
renders a `Button`. Converting the page before the button means converting
against something that does not exist yet.

So the Planner sorts components into **waves** using the graph's `renders` edges
and an algorithm called **Kahn's algorithm** for **topological sorting**.

> **What is a topological sort?**
> Given a set of things where some must come before others, it produces a valid
> order. Getting dressed is the classic example: socks before shoes, shirt before
> jacket. Kahn's algorithm works by repeatedly taking everything with no
> remaining prerequisites, removing it, and repeating.
>
> Here, wave 0 is the leaf components that render nothing else (buttons, badges);
> the last wave is the pages that render everything. Shared, low-level pieces are
> converted first.

### Questions only when justified

The Planner's documentation states the rule precisely:

```
project-type   : always (we always scaffold a target app).
styling-engine : any Tailwind usage (styling.tailwindClassCount > 0).
navigation-lib : react-router detected (routing.library set).
icons          : an icon library present in dependencies.
storage        : localStorage/sessionStorage in any component's webApis.
```

A project with no Tailwind is never asked about Tailwind. Exactly one option per
question is marked recommended, and the reason is documented at each rule.

> **This is a user-experience principle expressed in code.**
> Every unnecessary question costs the user attention and reduces the credibility
> of the necessary ones. Asking only evidence-backed questions is a form of
> respect — and, usefully, it is also *testable*: you can assert that a project
> without icons produces no icons question.

## 5.5 Stage 6 — The Migration Engine

This is the largest part, and it has three sub-parts that run in order.

### 5.5.1 The Deterministic Transformer

**Files:** `pipeline/transformer.py` + the Node `codemod-worker/`

Same architecture as the parser: Python orchestrates, Node transforms. The
codemod worker has one module per kind of change:

```
transforms/
├── elements.ts     div → View, span → Text, img → Image, button → Pressable
├── events.ts       onClick → onPress, onChange → onChangeText
├── images.ts       src="…" → source={{ uri: '…' }}
├── imports.ts      react-router-dom → @react-navigation/native
├── navigation.ts   <Link to> → navigation.navigate()
├── propsTypes.ts   ButtonHTMLAttributes → PressableProps
├── styles.ts       className handling, inline style objects
└── text.ts         wrap bare text in <Text>
```

Every transform works on the AST, never on text.

**Options are graph-resolved, not guessed.** Python builds an options object from
the Knowledge Graph and passes it to the worker. For example, the route table is
included, which is what turns `<Link to="/products/5">` into
`navigation.navigate('ProductDetail', { id: 5 })` — a **rule**, because the graph
already knows which screen `/products/:id` belongs to.

> **Notice what just happened.**
> Navigation conversion sounds like it needs intelligence. It does not — it needs
> *information*. Because an earlier stage built a route table, a later stage can
> resolve links mechanically. **Most things that look like they need AI actually
> need better data.** This is the single most important lesson in the Rejox
> architecture.

**The worker self-checks.** Before returning, it parses its own output and counts
syntax errors. If the transform produced invalid code, it says so rather than
emitting broken files.

**Residue.** Anything the rules cannot safely resolve is not guessed at. It is
recorded in an `unhandled` list and marked in the file with a comment:

```javascript
// REJOX-TODO(HOVER_STATE)
```

That list is described in the source as *"the input contract of the AI Resolution
Engine"*. The handoff between rules and AI is an explicit, typed contract — not a
vague fallback.

### 5.5.2 The Emitter

**File:** `pipeline/emit.py` (403 lines)

The transformer converts one file. The Emitter assembles a whole project:

1. **Scaffold** the Expo skeleton — `package.json`, `tsconfig.json`,
   `babel.config.js`, and so on (`scaffold.py`).
2. **Transform every source file** through the codemod worker and place it in the
   RN tree. Layout is preserved 1:1 so relative imports keep working; the only
   remap is `pages/` → `screens/`, and both sit one level under `src/` so
   `../components/X` still resolves.
3. **Generate the navigator** from the route table, plus an `App.tsx` wiring it.
4. **Copy real assets**, skipping web-only ones (favicons, `index.html`) *with a
   recorded reason*.
5. **Write `REJOX-REPORT.md`** with per-file provenance.

Every emitted file carries its provenance:

```python
def _provenance(result: TransformResult) -> ConfidenceSource:
    if result.unhandled:
        return ConfidenceSource.UNHANDLED
    if result.warnings:
        return ConfidenceSource.DETERMINISTIC_WARNING
    return ConfidenceSource.DETERMINISTIC
```

Three lines that make honest scoring possible later.

Note also `SkippedFile`, which records *why* a file was not emitted. Skipping
without a reason would be a silent decision; recording the reason makes it an
auditable one.

### 5.5.3 Dependency version safety

`scaffold.py` copies a few dependency versions from the user's `package.json`.
Only two libraries are allowed through at all:

```python
_CARRY_OVER = ("zustand", "axios")
```

And the version string is validated against a strict pattern:

```python
_SEMVER_RANGE_RE = re.compile(r"^[\^~]?\d+(\.\d+){0,2}(-[0-9A-Za-z.-]+)?$")
```

> **Why validate a version number?**
> Because npm accepts far more than version numbers in that position. It accepts
> `https://evil.com/package.tgz`, `git+ssh://…`, and `file:../../`. An attacker
> who put a URL there could make the server download and install code of their
> choosing. Only plain registry ranges are accepted; anything else is dropped.
> This is an example of an **allow-list** — permit the known-good and reject
> everything else, rather than trying to list the bad.

---

# Part 6 — The AI Resolution Engine

**Directory:** `app/ai/`

This is where Rejox's philosophy is most visible. The AI is not the engine — it
is the *scalpel*.

## 6.1 The provider seam

`ai/provider.py` defines one interface:

```python
class LLMProvider(ABC):
    @abstractmethod
    def complete(self, system: str, user: str, *, max_tokens: int) -> LLMResponse:
        ...
```

Two implementations:

- **`GeminiProvider`** — the real Google Gemini API. Imported *lazily*, meaning
  the import happens inside the function rather than at the top of the file, so
  tests never need the SDK installed.
- **`FakeProvider`** — offline and deterministic. Answers are keyed by a hash of
  the prompt.

> **Why does a fake provider matter so much?**
> Because tests that call a real AI are slow, cost money, need network access, and
> are **not repeatable** — the same test could pass today and fail tomorrow. With
> a fake provider, the entire test suite runs offline and gives the same answer
> every time. This is called **dependency injection**: instead of a component
> creating what it needs, it is *given* what it needs, so a test can hand it
> something else.

The `LLMResponse` is normalised — `text`, `tokensIn`, `tokensOut`, `model`,
`latencyMs` — so no vendor's response shape leaks into the rest of the codebase.

## 6.2 The three-tier ladder

The styling resolver (`ai/styling/resolver.py`) is the clearest example. Every
unresolved piece of Tailwind runs **down a ladder**:

```
Tier 1: static_map  →  Tier 2: pattern  →  Tier 3: llm
```

- **Tier 1 — static map.** A lookup table of known answers.
  `hover:bg-blue-500` → a `Pressable` pressed state. No thinking required.
- **Tier 2 — pattern.** A rule with a variable in it. Any `grid-cols-N` becomes a
  flex-wrap layout with the right width, for any `N`.
- **Tier 3 — the LLM.** Only what tiers 1 and 2 genuinely could not answer.

The module's own comment states the goal:

> *"The LLM is the residue of the residue. The lower its call count, the better
> the design — that is the whole point of the tiers above it."*

On the benchmark project the split is:

```
Static map (rule)     12
Pattern (rule)        15
Direct rule            2
LLM (reasoning)        1
```

**29 of 30 residue items resolved by rules. One AI call.**

> **Why is a ladder better than "just use the AI"?**
> Every rung you add makes the system faster, cheaper, more repeatable, and more
> explainable. And crucially, the ladder is a **ratchet**: when the AI resolves
> something new and useful, you can promote that answer into tier 1 and never pay
> for it again. The system gets more deterministic over time, not less.

## 6.3 The cache

**File:** `ai/cache.py`

The same residue appears many times in a project — `hover:bg-indigo-500` might be
in seven files. Resolving it once is the difference between roughly 100 AI calls
and roughly 8.

The clever part is the **key**. It is a hash of the issue code, the snippet, and
the options — but the snippet is **normalised** first:

- File paths → `<PATH>`
- Line numbers → `<LINE>`
- Component names → `<COMP>` (except React Native primitives like `View` and
  `Text`, which are part of the meaning)
- Whitespace canonicalised

> **Why normalise before hashing?**
> Because the same problem in two different files produces two different-looking
> snippets. Without normalisation they would be two cache misses. With it, they
> collide onto one key and the second is free. This idea is called
> **content-addressed caching**, and choosing the right normalisation is what
> makes it effective.

The cache is SQLite behind an abstract `CacheBackend` class, so swapping to Redis
or Postgres later means writing one new class. It also records hits and misses so
the hit rate reported to the user is measured, not estimated.

## 6.4 Guardrails on AI output

AI output is never trusted. Every response is:

1. **Stripped** of markdown code fences.
2. **Re-parsed by the codemod worker** — if the returned code does not parse,
   it is retried once with the error message, then abandoned.
3. **Allowed to refuse.** The model may return the sentinel `UNRESOLVABLE`, which
   keeps the `REJOX-TODO` marker in place.
4. **Counted.** Tokens in and out are logged.

> **Point 3 is the most interesting.**
> Most systems force a model to produce *something*. Rejox gives it a way to say
> "I do not know" — and treats that as a valid, useful answer. A visible TODO is
> far better than confident wrong code, because a human can see it.

## 6.5 The one genuine judgement call

There is exactly one decision Rejox considers true design work: **the navigator
shape**.

A web app has URLs. A mobile app has a navigation structure — bottom tabs, a
stack, or a drawer. Which one suits an app is a *product* decision, not a
mechanical one. Three top-level links suggest tabs; a linear flow suggests a
stack. There is no correct answer derivable from the code.

So Rejox asks the AI to *propose* a shape with a rationale, presents it to the
user as a question with the evidence and the reasoning shown, and the user
decides. Once the shape is chosen, generating the actual navigator code is
mechanical — a rule.

This is the model for the whole system: **isolate the genuine judgement, make it
visible, and mechanise everything around it.**

---

# Part 7 — Stage 7: Proving It Works

**File:** `pipeline/validator.py` (666 lines)

A conversion tool that says "done" without evidence is asking for trust. Rejox
runs the real toolchain.

## 7.1 Three real stages

1. **Install** — `npm install` in the generated project. Are the dependencies
   coherent?
2. **Typecheck** — the project's own `tsc --noEmit`. Does the code type-check?
3. **Bundle** — `npx expo export`, which runs **Metro**, React Native's real
   bundler. Does it actually build into an app?

> **What is a bundler?**
> A tool that takes hundreds of source files and combines them into the packaged
> form the platform can run, resolving every import along the way. If Metro
> succeeds, every import in the project resolved — strong evidence the project is
> genuinely runnable.

Note a small but telling detail: the code invokes the project's *local* TypeScript
binary rather than `npx tsc`, because `npx` would happily download an unrelated
package called `tsc` from the internet if the local one were missing. Someone hit
that bug and wrote the reason down in a comment.

## 7.2 Structured diagnostics

Raw compiler output is text. The Validator parses it with regular expressions
into structured records:

```python
Diagnostic(
    source="typecheck",
    file="src/components/Card.tsx",
    line=42,
    column=7,
    code="TS2322",
    severity="error",
    message="Type 'string' is not assignable to type 'number'.",
)
```

Structure makes the next step possible.

## 7.3 Mapping errors back to residue

This is the cleverest idea in the Validator. Remember that unresolved residue
leaves a marker: `// REJOX-TODO(HOVER_STATE)`.

When an error appears, the Validator looks for a nearby TODO marker. If it finds
one, the error is **explained** — it is a known consequence of a known
limitation. If it finds none, the error is **unexplained**, which means a
**codemod bug**.

The integration test asserts exactly this:

```python
assert unexplained_diagnostics == []
```

> **Why is this such a strong test?**
> It does not assert "zero errors" — that would be unrealistic and would make the
> test brittle. It asserts **"zero surprises."** Every remaining error must trace
> to a limitation the system already knows about and already told the user about.
> A new, unexplained error means a regression, and the test fails loudly.
>
> This is a genuinely excellent testing idea: assert on the *category* of
> failure, not the *count*.

## 7.4 The repair loop

**File:** `pipeline/repair.py`

If errors remain and they map to a *resolvable* residue code, Rejox tries one
targeted AI repair. The constraints are strict:

- Only the **offending line** and its diagnostic are sent — never the whole file.
- Only errors matching a known resolvable code are eligible.
- **At most two rounds**, then it stops and reports honestly.

And crucially:

```python
# An *unexplained* diagnostic (no residue) is a codemod bug —
# we do NOT paper over it with the LLM.
```

> **This is a discipline worth internalising.**
> The tempting design is "if anything fails, throw it at the AI until it passes."
> That converts *bugs in your own code* into *invisible AI patches*, and your
> deterministic engine silently rots. Rejox refuses: an unexplained error must be
> fixed in the rules, by a human.

Provenance stays truthful throughout. A file the AI touched that then validates
is `ai-validated` (Confidence 65). One that still fails is `ai-failed` (0).

## 7.5 Validated scores

After validation, Rejox recomputes the scores from **what actually happened**,
and reports coverage through two named lenses:

| Lens | A file counts when it… | Role |
| --- | --- | --- |
| **Strict** | migrated with **zero** residue — no TODO survives | **the headline** |
| Compiles + bundles | type-checks and bundles; soft residue allowed | the comparison figure |

On the benchmark these are **58%** and **100%**.

> **Why publish the lower number as the headline?**
> Because 100% is true but misleading. It means "everything runs", which is real
> and valuable — but a file with an unresolved `hover:` still runs, and still is
> not finished. Leading with the strict figure means the number Rejox advertises
> is the one that **cannot flatter it**. Both are always shown, each labelled with
> what it measures.
>
> This is a decision about honesty rather than engineering, and it is the kind of
> decision that determines whether a tool is trusted.

## 7.6 The empty-population rule

There is a rule in this system that deserves a section of its own, because it
came from a real bug found in three places at once.

> **An empty population is never a perfect score.**

Consider computing coverage as `migrated / total`. What if `total` is zero?

The original code said:

```python
coverage = round(100.0 * migrated / total, 1) if total else 100.0
```

Read that carefully. **If nothing was measured, report 100%.**

The consequences were severe and all in the same direction:

| Where | The bug | What it meant |
| --- | --- | --- |
| `validated_scores` | `100.0` when nothing was emitted | A migration that produced **no files** reported **100% coverage** |
| `analyze_graph` | Area budgets granted for having no findings | An **empty folder** scored Coverage 95, Confidence 100, Risk low |
| `compute_confidence` | `100.0` when every component was blocked | "Not one component can convert" reported **total certainty** |

None of these was a rounding choice. Each turned *an absence of evidence* into
*evidence of success* — the most dangerous class of bug a measurement system can
have, because it fails in the flattering direction and therefore nobody
investigates.

The fix has three levels:

1. **Refuse what cannot be scored.** A graph with no components raises
   `NothingToMigrate` and returns **422** — not 500, because it is a statement
   about the upload, not a defect in Rejox.
2. **Report `None` for an empty population.** The score fields became
   `Optional[float]`.
3. **Render `None` as "n/a".** Never a number, never a `%` sign.

> **The general lesson: any division whose denominator can be zero is a design
> question, not an arithmetic one.** Ask what the answer *means* when there is
> nothing to measure. Usually the honest answer is "no answer", and inventing one
> is how measurement systems start lying.

---

# Part 8 — The Web Layer

## 8.1 The API

**File:** `app/main.py` (470 lines), built on **FastAPI**.

> **What is FastAPI?**
> A Python framework for building APIs. Its distinctive feature is that it uses
> your pydantic models to validate requests, serialise responses, and generate
> API documentation automatically. One definition, three uses.

The endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Is the server alive? (No key needed) |
| `POST /api/upload` | Upload a zip |
| `POST /api/upload/github` | Clone a public repo |
| `POST /api/parse` | Build the Knowledge Graph |
| `POST /api/analyze` | Produce the report |
| `POST /api/plan` | Produce the plan |
| `POST /api/migrate` | Start a migration (returns `202`) |
| `GET /api/jobs/{id}` | Full job state |
| `GET /api/jobs/{id}/events` | Live event stream |
| `GET /api/runs/{id}/download` | Download the result |

## 8.2 Synchronous and asynchronous work

Most endpoints answer immediately. `/api/migrate` cannot — a migration takes
minutes, and an HTTP request that hangs for minutes will be killed by browsers,
proxies, and load balancers.

So `/api/migrate` returns **`202 Accepted`** with a job ID, and the work continues
in the background.

> **`200 OK` vs `202 Accepted`**
> `200` means "done, here is the result." `202` means "I have accepted this; it
> is not done yet." Using the right one tells the client what to do next.

## 8.3 Watching progress: SSE

The client then needs updates. Rejox uses **Server-Sent Events (SSE)**.

> **What is SSE?**
> A normal HTTP response the server keeps open, pushing new lines as things
> happen. Simpler than WebSockets, and enough when data flows one way.

Each event carries a sequence number, so a client that disconnects can reconnect
with a `Last-Event-ID` header and receive exactly what it missed.

The design note in the code is important:

> *"The stream is a convenience over `GET /api/jobs/{id}` — never the source of
> truth."*

The full state is always reconstructible from a single request. The stream is an
optimisation.

> **This is a valuable pattern.** Streams are unreliable: connections drop,
> proxies buffer, clients reload. If your stream is the only source of truth, any
> of those becomes data loss. Keep an authoritative, re-readable state, and treat
> the stream as a faster path to the same information.

## 8.4 Job state that survives

**File:** `app/jobs.py`

Job state lives in two places:

- **In memory**, in the process running the job — fast.
- **On disk**, as `{run}/job.json` — durable, and readable by other processes.

The file is written **atomically**: to a temporary file, then renamed.

> **What is an atomic write, and why?**
> `rename` is an operation the operating system guarantees happens completely or
> not at all. Writing directly to `job.json` means a reader could catch it
> half-written and see invalid JSON. Writing elsewhere and renaming means readers
> see either the old file or the new one — never a broken one.

The module's documentation is refreshingly blunt about its own limits:

> *"A job still running when the process dies does NOT survive — its thread is
> gone. We do not resurrect running jobs."*

This is exactly what the queue exists to fix.

## 8.5 The queue

**Files:** `queue.py`, `worker.py`

Where a migration runs is a **deployment** decision, so it is made in one place.

| Backend | How it works | For |
| --- | --- | --- |
| `thread` | A thread inside the API process | Development, CLI, tests |
| `rq` | Enqueued to **Redis**, run by separate `rejox-worker` processes | Production |

> **What is a job queue?**
> A list of work waiting to be done. Producers add jobs; workers take them. The
> benefits: work survives a restart (it is in the queue, not in a dying process),
> you can add workers to scale, and a deploy does not kill in-flight work.
>
> **Redis** is a fast in-memory data store often used to hold such queues.

The unit of work is a module-level function:

```python
def run_job(job_id, *, source_root, run_id, out_dir, answers, install, run_bundle):
```

It is module-level because a worker process resolves it *by import path* — it
never saw the original request. Both backends call the **same function**, so
there is exactly one migration code path regardless of where it runs.

**And there is no fallback.** If Redis is unreachable, the API returns `503`. It
does *not* quietly run the job in a thread:

```python
# Never fall back to a thread: that would silently turn a durable job
# into one that dies with this process, exactly when the queue is the
# thing that was supposed to keep it alive.
```

> **This is a recurring theme, and it is worth stating as a principle: a fallback
> that silently removes the guarantee you configured is worse than an error.**
> The operator asked for durability. Giving them non-durability without telling
> them is a lie by omission.

---

# Part 9 — Security

**Document:** `docs/SECURITY.md`

## 9.1 The core danger

Here is the uncomfortable truth at the centre of this product:

**To validate a migration, Rejox must run `npm install`, `tsc` and Metro against
a project a stranger uploaded. That is arbitrary code execution, by design.**

`npm install` runs *lifecycle scripts* — arbitrary commands a package author can
put in their `package.json`. A malicious upload could take over the server.

## 9.2 The sandbox

**File:** `pipeline/sandbox.py`

Every external command goes through **one function** and nowhere else. Two modes:

**`docker` — the only real sandbox.** Each command runs in a throw-away
container with:

| Flag | What it does |
| --- | --- |
| `--cap-drop ALL` | Remove every special operating-system privilege |
| `--security-opt no-new-privileges` | Cannot regain privileges |
| `--user=uid:gid` | Never runs as root |
| `--memory` + `--memory-swap` | A real memory ceiling (without the swap cap it is a soft one) |
| `--cpus`, `--pids-limit` | Cannot exhaust CPU or spawn unlimited processes |
| `--read-only` | The container's filesystem cannot be modified |
| `--network none` | **No network at all** — except during install |

> **What is a container?**
> A way to run a program in an isolated environment with its own filesystem and
> its own view of the system. It shares the machine's kernel but cannot normally
> see or affect anything outside itself. Docker is the common tool for this.

The **per-stage network control** is elegant. `npm install` needs the internet;
typechecking and bundling do not. So only install gets a network:

```python
"--network", "bridge" if network else "none",
```

Even if malicious code runs during bundling, it cannot phone home.

**`direct` — not a sandbox.** Runs as the Rejox process. Its own documentation
says so plainly, and the API **refuses to start a migration** in this mode unless
an operator explicitly sets `REJOX_ALLOW_UNSANDBOXED=1`.

> **Making the unsafe path require a deliberate action is a design pattern worth
> naming: "secure by default, unsafe by declaration."** The risky option still
> exists — developers need it — but nobody can reach it by accident, and choosing
> it leaves a trace in the configuration.

## 9.3 Defence in depth

Sandboxing is not the only layer. `npm install` also runs with:

```
--ignore-scripts
```

This alone kills the lifecycle-script attack — **even without Docker**. Rejox
only needs the package *files* to typecheck and bundle, not their install hooks.
This was verified: the whole Expo toolchain installs, type-checks and bundles
cleanly without them.

> **Defence in depth** means not relying on a single protection. If the sandbox
> were misconfigured, `--ignore-scripts` still blocks the most common attack. If
> `--ignore-scripts` were somehow bypassed, the sandbox still contains it.

## 9.4 Who may call, and how often

**File:** `app/security.py`

**Identity.** A shared API key sent as `Authorization: Bearer <key>` or
`X-API-Key`. Keys are compared as hashes using `hmac.compare_digest`.

> **Why compare hashes in "constant time"?**
> A normal string comparison stops at the first different character. That means a
> wrong guess starting with the right letter takes *very slightly* longer to
> reject. An attacker measuring thousands of requests can use that to guess a key
> one character at a time. This is a **timing attack**, and constant-time
> comparison — always taking the same time regardless of where the difference is
> — defeats it.

**With no keys configured, the API returns `503` and explains what to set.** It
does not serve everyone.

**Budgets.** Fixed-window rate limits, per identity, separated by cost:

| Bucket | Limit / minute | Why |
| --- | --- | --- |
| `read` | 300 | Cheap |
| `pipeline` | 20 | CPU-heavy |
| `upload` | 10 | Disk and CPU |
| `migrate` | 3 | Costs real money (AI + compute) |

Plus a **concurrency cap** on simultaneous migrations, counted from *live worker
threads* rather than stored status — because a job whose thread died but whose
status still says "running" would otherwise block the endpoint forever.

## 9.5 Data retention

**File:** `app/retention.py`

A run workspace holds a stranger's source code. Keeping it forever is a data
protection problem before it is a disk problem.

Runs older than `REJOX_RUN_TTL_SECONDS` (24 hours by default) are deleted, either
by a sweeper the API runs on a schedule or by `rejox sweep` from cron.

> **A cautionary tale worth remembering.**
> The function that reaps old runs existed for a long time and was documented as
> if it ran. Nothing ever called it. When the caller was finally written, the very
> first run found **72 abandoned workspaces** on disk.
>
> **Dead code that describes a policy is worse than no code**, because it makes
> reviewers believe the policy is enforced. Whenever you read a comment saying
> "X happens automatically", check who calls X.

## 9.6 Honest documentation of gaps

`docs/SECURITY.md` contains a section titled **"What is NOT contained — known
gaps"**, introduced with:

> *"Stated plainly, because a security document that only lists wins is
> marketing."*

The listed gaps include: rate limits are per-process so multiple API replicas
multiply the limit; a shared API key is not user accounts; workspace data is not
encrypted at rest; the sandbox image is not pinned by digest by default; and the
worker's Docker socket mount effectively grants host root.

> **Why write down your own weaknesses?**
> Because the operator deploying this must decide whether the risks are
> acceptable *for their situation*. A document that hides them makes that decision
> impossible. Also, honestly: an attacker will find these anyway. The only person
> a flattering security document fools is your own user.

---

# Part 10 — Deployment and Operations

## 10.1 The container image

`backend/Dockerfile` uses a **multi-stage build**:

- **Stage 1** compiles the Node workers.
- **Stage 2** is the runtime: Python, Node, the compiled workers, and the Docker
  CLI (so the sandbox can start sibling containers).

> **What is a multi-stage build?**
> You build in one image and copy only the results into a smaller final image.
> The compilers and build tools stay behind. Smaller images deploy faster and
> have less attack surface — every tool you ship is a tool an attacker can use.

The image runs as a **non-root user** (`uid 10001`) and has a **healthcheck** so
the orchestrator can tell whether it is actually serving.

Note what the image deliberately does **not** contain: the toolchain for
validating a migrated project. That work happens in the separate sandbox
container.

## 10.2 The composition

`docker-compose.yml` defines three services:

| Service | Role |
| --- | --- |
| `redis` | The durable queue (with persistence on) |
| `api` | Accepts uploads, analyses, plans, enqueues. **Never runs a migration.** |
| `worker` | Runs migrations. Scale with `--scale worker=3`. No ports at all. |

The split *is* the architecture. The API stays responsive because it never does
slow work. The workers scale independently because they are stateless consumers.

The worker mounts the host's Docker socket so it can start sandbox containers.
The compose file names this trade-off explicitly and points at the security
document, rather than burying it.

## 10.3 Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

| Job | What it checks |
| --- | --- |
| Backend (fast) | Everything except the tests that npm-install and run Metro (~5 min) |
| Backend (integration) | The full emit → install → tsc → Metro run |
| Frontend | Lint, typecheck, build |
| Docker | The image still builds |

> **What is CI?**
> **Continuous Integration** — a system that automatically runs your tests every
> time code changes. Its purpose is to make broken code visible immediately,
> instead of days later when someone happens to run the tests locally.

The fast/slow split matters: a pull request gets a verdict in minutes rather than
a quarter of an hour, while the expensive real-toolchain run still has to pass
before anything is merged.

## 10.4 The CLI

**File:** `app/cli.py` (817 lines)

```bash
rejox migrate ./my-react-app --yes
```

The CLI is a **thin face over the same pipeline functions** the API calls — never
over HTTP, never a reimplementation.

> **Why does that matter?**
> If the CLI reimplemented the pipeline, you would have two systems that drift
> apart, and a bug fixed in one would persist in the other. Sharing the core and
> varying only the interface is the correct structure. The API and the CLI are
> two *faces*, not two *products*.

---

# Part 11 — Design Principles Running Through Everything

By now the same ideas have appeared repeatedly. Here they are, gathered.

## 11.1 Rules first, AI last

Every capability is attempted deterministically first. AI handles only the
residue. The result: one AI call for a whole project migration.

## 11.2 Fail loudly, never silently

This appears in a dozen places:

- Unknown fields in data → rejected (`extra="forbid"`)
- Unknown sandbox mode → error, not a default
- Redis unreachable → `503`, not a silent thread
- Docker missing in docker mode → error, never a fallback
- A file the parser could not read → a recorded warning
- A skipped file → a recorded reason
- Nothing to measure → `n/a`, not `100%`

> **Why is a loud failure better than a quiet workaround?**
> Because a quiet workaround does not remove the problem, it removes your
> *knowledge* of the problem. The system now behaves differently than configured
> and nobody knows. Every silent fallback in this codebase was deliberately
> replaced with an error and a message explaining what to set.

## 11.3 Everything is traceable

- Coverage decomposes into rows that sum to it exactly.
- Confidence is computed from provenance, never estimated.
- Every issue carries `Evidence` — a file and a detail.
- Every emitted file records how it was produced.
- Every AI call is counted, and its tokens logged.

## 11.4 Seams for every external decision

AI vendor, sandbox mode, queue backend, cache storage — each is one interface
with multiple implementations, chosen by configuration. This is what makes the
system testable offline and portable across deployments.

## 11.5 Data over code

Element maps, event maps, library tables, domain specs, CSS property maps. Adding
a capability is usually adding a row.

## 11.6 The single source of truth

- The Node workers are the only place code is parsed.
- `sandbox.run()` is the only place untrusted code is executed.
- `docs/CONVERSION-RULES.md` is the only place conversion rules are defined —
  and the project rule is that a missing rule must be **added to the table
  first**, then implemented.

## 11.7 Honesty as an engineering requirement

The strict coverage figure leads even though it is lower. The security document
lists its own gaps. The job module documents that running jobs do not survive a
crash. The empty-population rule exists because flattering arithmetic was found
and removed.

> **This is not modesty; it is engineering.** A measurement that can only move in
> your favour is not a measurement. A system that cannot report its own failures
> cannot be debugged, and cannot be trusted with anyone's codebase.

---

# Part 12 — Strengths, Weaknesses, and Risks

## 12.1 Strengths

**1. The architecture is genuinely sound.** Clear stages, explicit contracts,
single sources of truth. A newcomer can find where a given thing happens.

**2. Determinism is a real property, not a slogan.** One AI call per project
migration is a measured number.

**3. Validation is real.** Running the actual TypeScript compiler and the actual
Metro bundler is far stronger evidence than any heuristic.

**4. The `unexplained_diagnostics == []` test is excellent.** Asserting "zero
surprises" rather than "zero errors" is a sophisticated and durable idea.

**5. Security is taken seriously.** Layered defences, a single execution seam,
secure-by-default with explicit opt-outs, and an honest gap list.

**6. The documentation explains *why*.** Comments record the reasoning behind
decisions — including painful ones, like why `npx tsc` is avoided.

**7. It refuses to lie.** The honesty work described in Part 7.6 is unusual and
valuable.

## 12.2 Weaknesses

**1. The JavaScript gap — the most serious functional limitation.**

The emitter only transforms `.ts` and `.tsx` files:

```python
and f.path.endswith((".ts", ".tsx"))
```

But the parser reads `.js` and `.jsx` perfectly well. So for a plain JavaScript
project, the Knowledge Graph is correct, the report is correct, the plan is
correct — and **zero files are converted**.

When this was tested against eight real-world React projects collected from the
internet, **all eight were JavaScript**, and all eight produced empty output. And
because of the empty-population bug (now fixed), each reported 100% coverage.

> **Two lessons here, and both are important.**
>
> First: **one line can be a product-level bug.** A three-word condition in a
> file-selection loop silently disabled the entire product for the majority of
> real projects.
>
> Second: **test against reality, not only your own fixture.** The benchmark
> project is TypeScript, so every test passed. The gap was invisible until
> someone ran the system on projects it did not create. A test suite that only
> tests your own sample tests your assumptions, not your product.

**2. The coverage denominator is still measured on output, not input.**

Coverage counts *emitted* files, not *source* files. So a project where 3 of 40
files converted measures its coverage over 3, not 40. The empty case now reports
`n/a`, which is a real improvement, but the partial case still flatters.

**3. A shared API key is not user accounts.** Every key holder is the same
principal. There is no per-user isolation, quota, or audit trail. And a browser
frontend cannot hold a secret key at all — so a public web deployment needs real
user sessions, which do not exist yet.

**4. The API cannot scale horizontally.** Rate-limit counters are per process, so
N API replicas mean N times the limit. Workers scale; the API does not.

**5. The Docker socket mount is a large trust grant.** Giving the worker control
of the host's Docker daemon is effectively host root. It is documented, and it is
the price of containment, but it is real.

**6. Docker sandbox mode has not been verified end to end.** The container flags
are unit-tested; a live run on a host with a Docker daemon has not been done.

**7. Metro passing can mean less than it appears.** If a project produces no
navigator, Metro may bundle a single trivial file and pass. A passing bundle is
not by itself proof of a substantial app.

**8. Narrow scope.** Redux, Next.js, Canvas, and much else are unsupported. This
is deliberate, but it limits the addressable set of real projects — and the
JavaScript gap compounds it.

## 12.3 Things that could go wrong

| Risk | Likely cause | Mitigation status |
| --- | --- | --- |
| A malicious upload escapes the sandbox | Docker misconfiguration | Layered: `--ignore-scripts`, cap-drop, no-network. **Not verified live.** |
| A scoring bug flatters the product | A denominator that can be zero | Rule + tests now in place |
| A codemod produces broken code | An unhandled AST shape | Worker self-check + unexplained-diagnostic test |
| The AI returns nonsense | Model behaviour | Re-parsed, retried once, may return `UNRESOLVABLE` |
| A job is lost | Process restart | Fixed by the queue (in `rq` mode) |
| Disk fills with user data | No retention | Fixed: TTL sweeper + `rejox sweep` |
| A user's data is over-retained | 24h window | Reduced, not eliminated; not encrypted at rest |
| Rate limits are ineffective | Multiple API replicas | **Open** — run one API container |

## 12.4 Suggestions for what comes next

**In priority order:**

1. **Fix the JavaScript gap.** Accept `.js`/`.jsx` in the emitter. This is the
   single change that most increases the number of real projects the product can
   serve. It requires deciding what the output should be — plain JavaScript, or
   TypeScript with relaxed settings — because a strict-TypeScript scaffold fed
   untyped JavaScript produces a flood of type errors.

2. **Measure coverage against source files.** The denominator should be what the
   user gave you, not what you managed to produce.

3. **Verify Docker sandbox mode end to end** on a host with a running daemon,
   before any public deployment.

4. **Replace the shared API key with real user accounts** if the product is to be
   publicly hosted, and move rate-limit state to Redis so the API can scale.

5. **Make Metro's verdict meaningful** — assert that a substantial number of
   modules were bundled, not merely that the command exited zero.

6. **Grow tier 1 of the ladder from tier 3's answers.** Every AI resolution worth
   keeping should be promoted into the static map, so cost and non-determinism
   fall over time.

---

# Part 13 — What a Student Should Take Away

If you remember five things from this document, make them these.

**1. Understand before you change.**
Rejox builds a complete model of a project before touching a single file. Almost
every hard software problem gets easier when you separate *understanding* from
*acting*.

**2. Most problems that look like they need intelligence need better data.**
Converting `<Link to="/products/5">` sounds like it needs reasoning. It does not
— it needs a route table. Before reaching for a model, ask what information would
make the problem mechanical.

**3. Make failure loud.**
Every silent fallback is a lie your program tells you. Unknown data, unreachable
services, missing tools, empty measurements — all of them should raise their
hand, not shrug.

**4. Measure honestly, especially against yourself.**
The empty-population bug reported 100% for doing nothing. It survived because it
failed in the flattering direction, and nobody investigates good news. Design
your metrics so they can hurt.

**5. Write down why.**
The best parts of this codebase are the comments explaining a decision — why
`npx` is avoided, why `preexec_fn` was removed, why an unexplained diagnostic is
never sent to the AI. Code says what; comments should say why. The why is what
survives.

---

# Conclusion

Rejox is a system for converting React web applications into React Native mobile
applications. Its defining choice is to solve as much as possible with
deterministic rules and to use artificial intelligence only for the small
remainder that genuinely requires judgement — one AI call for an entire project
migration.

Architecturally it is a pipeline of eight stages, each with one responsibility
and an explicit typed contract to the next. It cooperates across three runtimes,
using Node for parsing because the best TypeScript parser is written in
TypeScript, and Python for orchestration and modelling. It isolates its risky
decisions behind seams — AI vendor, sandbox mode, queue backend — so each can be
swapped or faked.

What distinguishes it is not any single technique but a consistent commitment to
**honesty as an engineering property**. It proves its output with the real
toolchain rather than heuristics. It leads with the coverage figure that cannot
flatter it. It documents its own security gaps. It refuses to convert an
unexplained compiler error into an invisible AI patch, because doing so would
hide a bug in its own rules. And when it was discovered that three separate
calculations reported perfection for having measured nothing, the response was
not to adjust the numbers but to make "nothing to measure" an answer the system
can give.

It is not finished. Its most serious limitation — that it does not convert plain
JavaScript projects, which is most real React projects — is a small condition in
one file with a large consequence, and it is the clearest reminder in the whole
system that architecture and correctness are different things. A beautifully
structured pipeline that skips your files is still a pipeline that skips your
files.

For a student, that is perhaps the most useful thing here: a system good enough
that its remaining flaws are interesting. The structure is worth imitating. The
honesty is worth imitating more. And the gap between the two is where real
engineering actually happens.

---

# Glossary

| Term | Meaning |
| --- | --- |
| **API** | The set of requests a server understands |
| **AST** | Abstract Syntax Tree — code represented as a structured tree |
| **Atomic write** | Writing to a temp file then renaming, so readers never see a partial file |
| **Boundary** | A place where one part of a system hands data to another |
| **Bundler** | A tool that combines many source files into a runnable package |
| **Cache** | Storing a computed answer so it need not be computed again |
| **CI** | Continuous Integration — tests that run automatically on every change |
| **Codemod** | A programmatic, AST-based modification of source code |
| **Component** | A reusable piece of user interface in React |
| **Constant-time comparison** | Comparing secrets so timing reveals nothing |
| **Container** | An isolated environment for running a program |
| **Contract** | The agreed shape of data crossing a boundary |
| **Defence in depth** | Multiple independent layers of protection |
| **Dependency injection** | Giving a component what it needs instead of it creating it |
| **Deterministic** | Same input always produces the same output |
| **Endpoint** | One address in an API |
| **Expo** | A toolkit that simplifies building React Native apps |
| **Fail fast** | Report an error at the earliest possible point |
| **Graph** | Nodes connected by edges; a way to model relationships |
| **JSX** | The HTML-like syntax React uses inside JavaScript |
| **Kahn's algorithm** | A method for topological sorting |
| **LLM** | Large Language Model — the kind of AI used here |
| **Metro** | React Native's bundler |
| **Monorepo** | One repository containing several projects |
| **NativeWind** | Tailwind CSS for React Native |
| **Path traversal** | An attack using `..` to escape an intended folder |
| **Pipeline** | Stages where each one's output feeds the next |
| **Provenance** | The record of how something was produced |
| **pydantic** | A Python library for declaring and validating data shapes |
| **Queue** | A list of work waiting for a worker to take it |
| **Rate limiting** | Capping how many requests one caller may make |
| **Redis** | A fast in-memory data store, often used for queues |
| **Residue** | Code that deterministic rules could not convert |
| **Sandbox** | An isolated environment for running untrusted code |
| **Seam** | One deliberate place where a decision is made |
| **Separation of concerns** | Each part responsible for one kind of thing |
| **SSE** | Server-Sent Events — a one-way stream of updates over HTTP |
| **Status code** | The number in an HTTP response saying how it went |
| **stdout / stderr** | A program's result channel and its message channel |
| **Subprocess** | A separate program run by your program |
| **Symlink** | A file that points at another file |
| **Topological sort** | Ordering items so prerequisites come first |
| **ts-morph** | The library Rejox uses to read and edit TypeScript ASTs |
| **TypeScript** | JavaScript with types checked before the program runs |
| **TTL** | Time To Live — how long data is kept before deletion |
| **Zip bomb** | A small archive that expands to an enormous size |
