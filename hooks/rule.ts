// What Claude reads: the rule to start each reply with a glossary block, in
// the shape splitGlossary in hooks/glossary.ts finds.

/** The rule, as it goes in the system prompt. */
export const GLOSSARY_RULE = `Start every reply with a short glossary block. In the fullscreen terminal, wordwise-cc hides the block, underlines each term in the reply, and shows the term's meaning in a card when the mouse rests on it.

The block comes first, with nothing before it, and looks like this:

---

*loader script*: the Python file that reads offers from the CSV file and writes them into the database.

*CSV*: a plain text file where commas split each row into columns.

---

- Put a line with only --- above the block, and another below it.
- Write each term on its own line as *term*: meaning, with the term in single stars.
- Put a blank line after the opening ---, between terms, and before the closing ---.
- List only terms used in this reply, written the way the reply writes them, so each one can be found and underlined.
- Pick terms the user may not know or may read two ways: jargon, acronyms, tool, file and function names, plain words with two meanings, and names you picked for a thing.
- Each meaning is one sentence of 25 words or fewer. Say what the term means in this reply, not its dictionary meaning.
- Most replies need 2 to 6 terms. Skip the block only when a reply has no term worth a meaning, like a one-line "Done."`
