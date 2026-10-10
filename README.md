# Wordwise for Claude Code

A Claude Code mod. Claude starts each reply with a short glossary of the terms
it uses. Wordwise hides that glossary block. It underlines each term in the
reply. When your mouse rests on a term, a card shows the term's meaning.

What Claude writes:

```
---

*loader script*: the Python file that reads offers from the CSV file.

---

The loader script stopped.
```

What you see, with the mouse on "loader script":

```
⏺ The loader script stopped.
      ‾‾‾‾‾‾‾‾‾‾‾‾‾
      ╭─────────────────────────────────────╮
      │ loader script                       │
      │ the Python file that reads offers   │
      │ from the CSV file.                  │
      ╰─────────────────────────────────────╯
```

## Install

Plugins with code of their own, like this one, are early access in Claude
Code. Wordwise was tested on Claude Code 2.1.296.

1. In Claude Code, run:

   ```
   /plugin marketplace add arpxspace/wordwise-cc
   /plugin install wordwise-cc@wordwise-cc
   ```

2. Turn on the fullscreen layout. Add this line to `~/.claude/settings.json`:

   ```json
   "tui": "fullscreen"
   ```

3. Start a new session.

Wordwise needs the fullscreen layout, because only that layout sees the
mouse. In any other layout, the reply is drawn the normal way, glossary block
and all.

## Settings

Wordwise tells Claude to write the glossary block. It adds that rule to
Claude's system prompt in every session.

Does your own `CLAUDE.md` already ask for a glossary? Then turn off
wordwise-cc's `askForGlossary` in `/config`. Claude then follows only your
rule. Your rule must still write the block in the shape below.

## The glossary block it reads

The reply must start with this block:

```
---

*loader script*: the Python file that reads offers from the CSV file.

*CSV*: a plain text file where commas split each row into columns.

---
```

A reply without this block is drawn the normal way.

## Where it works

- Only in the fullscreen layout (`"tui": "fullscreen"`).
- Code boxes, tables, and quotes get no underlines. The Markdown renderer
  draws them.
- The mod changes only the screen. The saved reply keeps the glossary block.
  Press ctrl+o to see it.

## Files

- `hooks/register.tsx` adds the rule to the system prompt and draws the reply.
- `hooks/rule.ts` holds the rule that tells Claude to write the glossary block.
- `hooks/glossary.ts` finds the glossary block and the terms, and picks the
  side each card opens on.
- `tests/glossary.test.ts` holds the tests.

## Develop

```sh
git clone https://github.com/arpxspace/wordwise-cc
cd wordwise-cc
claude --plugin-dir .            # a session with the mod loaded from here
```

In that session, saving a file reloads the mod.

```sh
claude plugin validate .          # checks the manifest and the hooks module
claude plugin test .              # the tests in tests/
tsc -p .                          # checks the types
```

`tsc -p .` needs TypeScript 5.4 or newer. It also needs the types Claude Code
writes into `.claude-plugin/types/` the first time it loads the mod.

## License

MIT. See [LICENSE](LICENSE).
