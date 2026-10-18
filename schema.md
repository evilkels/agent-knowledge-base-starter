# Frontmatter schema

Every page starts with a frontmatter block between two `---` lines. The lint
script reads a small subset of YAML: `key: value` scalars, `- item` lists and
`[a, b]` lists. Do not use nested mappings.

## Wiki pages (`wiki/**/*.md`)

| Field | Required | Meaning |
|---|---|---|
| `type` | yes | `project`, `area`, `resource` or `index` |
| `title` | yes | Human title |
| `description` | yes | One sentence. Also used in `wiki/index.md` |
| `updated` | yes | ISO date (`YYYY-MM-DD`) of the last content change |
| `sources` | yes (may be `[]` only for `index`) | Paths into `sources/`, relative to the page, or `https://` URLs |
| `status` | no | `draft` or `reviewed` |
| `review_after` | no | ISO date. Lint warns when it has passed |
| `tags` | no | List |

Example:

```yaml
---
type: resource
title: Pricing arguments
description: Why quotes are priced the way they are.
updated: 2026-10-09
sources:
  - ../../sources/2026-10-09-pricing-email.md
status: reviewed
review_after: 2027-01-15
tags: [sales, pricing]
---
```

## Source files (`sources/*.md`)

| Field | Required | Meaning |
|---|---|---|
| `type` | yes | `source` |
| `title` | yes | Human title |
| `captured` | yes | ISO date the input was captured |
| `origin` | yes | A URL, or a plain description such as `call notes` |

Source files are immutable. Add a new file instead of editing an old one.

## Proposals (`inbox/*.md`)

Proposals are written by agents and approved by a person. The file name is
`YYYY-MM-DD-topic.md`.

| Field | Required | Meaning |
|---|---|---|
| `type` | yes | `proposal` |
| `title` | yes | What the proposal changes |
| `created` | yes | ISO date |
| `target` | yes | The wiki page to change, relative to the vault root |
| `sources` | yes | Paths into `sources/`, relative to the proposal |

The body has three sections: what to change, the exact new text, and the
sources.

## Links

Use standard relative Markdown links, for example
`[Pilot](../projects/northern-build-pilot.md)`. Do not use `[[wikilinks]]`.
Obsidian, GitHub and agents then resolve the same path.

## Required body sections for wiki pages

Each page ends with a `## Decisions` list (dated entries, each linked to its
source) and a `## Open questions` list.
