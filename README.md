# Agent knowledge base starter

A small Markdown vault that AI agents read for context and a person keeps
correct. It has three layers: immutable `sources/`, a `wiki/` of pages written
from them, and rules in `AGENTS.md`. Two scripts check it: a linter for the
vault and a checker for the files an agent cites. There are no dependencies.
Node 20 or later is enough.

**Everything in the sample vault is invented.** Northern Build is a fictional
company. The people, figures and e-mails do not exist.

## Layout

```
agent-knowledge-base-starter/
├── AGENTS.md          rules every agent follows here
├── CLAUDE.md          one line: @AGENTS.md (Claude Code import)
├── README.md
├── LICENSE
├── package.json       scripts: lint, check-answer, test
├── schema.md          frontmatter field reference
├── log.md             append-only change log
├── sources/           immutable inputs; agents never edit them
├── wiki/
│   ├── index.md       one line per page: link + description
│   ├── projects/
│   ├── areas/
│   ├── resources/
│   └── archive/
├── inbox/             agent proposals waiting for a person
├── evals/
│   ├── questions.json
│   └── answers/example-q1.md
├── scripts/
│   ├── lint.mjs
│   └── check-answer.mjs
└── test/
    └── lint.test.mjs
```

## Quick start

```bash
git clone https://github.com/evilkels/agent-knowledge-base-starter.git
cd agent-knowledge-base-starter
npm run lint
```

1. Open the folder as a vault in Obsidian (optional; any editor works).
2. Start an agent in the folder. Claude Code reads `CLAUDE.md`, which imports
   `AGENTS.md`. Codex reads `AGENTS.md` directly.
3. Ask it the first question in `evals/questions.json`. A good answer cites
   `wiki/resources/pricing-arguments.md` and
   `sources/2026-10-09-pricing-email.md`.

`npm run lint` compares `review_after` and draft ages with today's date. The
sample dates are fixed in October 2026, so pass a date to get the same result
every time:

```bash
npm run lint -- --today 2026-10-18
```

## The loop

1. **Ingest:** a person adds a file to `sources/`. The agent reads it and
   writes a proposal in `inbox/`.
2. **Approve:** a person reads the proposal and asks the agent to apply it by
   name.
3. **Apply:** the agent edits `wiki/`, updates `wiki/index.md` if a page was
   added, and appends a line to `log.md`.
4. **Query:** the agent starts at `wiki/index.md`, follows links, checks
   `sources/`, and answers with file paths.
5. **Lint:** run `npm run lint`. Fix every ERROR. Read every WARN.

## Lint

`npm run lint` prints one line per problem, then a summary. It exits with 1 if
there is any error.

Errors: a wiki page misses a required field or has no frontmatter; a `sources`
entry is neither an existing path nor an `https://` URL; a relative link points
to a missing file; a wiki page is not listed in `wiki/index.md`; a file in
`sources/` is modified compared with `HEAD` (skipped with a note outside a git
repository); a date is not `YYYY-MM-DD`.

Warnings: `review_after` has passed; no other wiki page links to a page;
a `draft` page was last updated more than 30 days ago.

Example output (the sample vault with a deliberate mistake):

```text
ERROR wiki/areas/sales.md: link target "../resources/pricing.md" does not exist
lint: 1 errors, 0 warnings
```

The fields are described in [schema.md](schema.md).

## Check an answer

```bash
npm run check-answer -- q1 evals/answers/example-q1.md
```

The script reads `evals/questions.json`, finds the file paths the answer cites,
and prints `cited`, `missing` and `extra`. It exits with 1 when an expected
source is missing. A question with no expected sources, such as `q5`, expects
the answer "not in the vault". The script checks citations only. A person still
judges whether the content of the answer is right.

To test an agent: ask it each question, save the answer, run the script, and
record the model and the date.

## Links in Obsidian

The vault uses standard relative Markdown links, such as
`[Pilot](../projects/northern-build-pilot.md)`, so that Obsidian, GitHub and
agents resolve the same path. In Obsidian, open Settings, then Files and links,
turn off **Use [[Wikilinks]]**, and set **New link format** to
**Relative path to file**.

## Tests

```bash
npm test
```

Runs `test/lint.test.mjs` with `node --test`. The tests build temporary vaults
and check each lint rule.

## Credits

- The sources → wiki → rules layout follows Andrej Karpathy's LLM wiki idea:
  <https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>.
- The wiki folders follow PARA by Tiago Forte.
- `AGENTS.md` is an open format for agent instructions: <https://agents.md/>.
- The guide that explains this repository:
  <https://ai-brain.ernesto.lv/agent-knowledge-base>.

## Licence

MIT. See [LICENSE](LICENSE).
