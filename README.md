# wordwise-claude-code

A Claude Code mod. It hides the glossary block at the top of a reply. It
underlines each glossary term in the reply. When your mouse rests on a term,
a card shows the term's meaning.

## The glossary block it reads

The reply must start with this block. `~/.claude/CLAUDE.md` tells Claude to
write it.

```
---

*loader script*: the Python file that reads offers from the CSV file.

*CSV*: a plain text file where commas split each row into columns.

---
```

A reply without this block is drawn the normal way.

## Where it works

- Only in the fullscreen terminal layout (`"tui": "fullscreen"`). Only that
  layout sees the mouse. Anywhere else the reply is drawn the normal way,
  glossary block and all.
- Code boxes, tables, and quotes get no underlines. The Markdown renderer
  draws them.
- The mod changes only the screen. The saved reply keeps the glossary block.
  Press ctrl+o to see it.

## How it loads

`~/.claude/settings.json` names this folder in `env.CLAUDE_CODE_PLUGIN_DIRS`.
Every new Claude Code session loads it. A session reloads it when a file here
changes.

## Files

- `hooks/register.tsx` draws the reply.
- `hooks/glossary.ts` finds the glossary block and the terms, and picks the
  side each card opens on.
- `tests/glossary.test.ts` holds the tests.

## Check it

```
claude plugin validate .
claude plugin test .
tsc -p .
```

`tsc -p .` needs the types the engine writes into `.claude-plugin/types/` the
first time it loads the mod.
