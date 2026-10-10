import { expect, test } from 'claude-code/testing'

import { findTerms, parseInline, plan, splitGlossary } from '../hooks/glossary'

const REPLY = [
  '---',
  '',
  '*loader script*: the Python file that reads offers from the CSV file.',
  '',
  '*CSV*: a plain text file where commas split each row into columns.',
  '',
  '---',
  '',
  'The loader script stopped. It read a **CSV** file, then two loader scripts ran.',
  '',
  '- Open the CSV in a text editor.',
  '- Check the header row.',
  '',
  '```',
  'python loader script.py',
  '```',
  '',
  'Nothing here has a term.',
].join('\n')

const FULLSCREEN = { columns: 100, rows: 40, isFullscreen: true }

test('splits the glossary block from the reply', () => {
  const g = splitGlossary(REPLY)
  expect(g?.terms).toEqual([
    { term: 'loader script', meaning: 'the Python file that reads offers from the CSV file.' },
    { term: 'CSV', meaning: 'a plain text file where commas split each row into columns.' },
  ])
  expect(g?.body.startsWith('The loader script stopped.')).toBe(true)
})

test('finds no glossary in a reply without one, or before its closing line', () => {
  expect(splitGlossary('Done.')).toBeNull()
  expect(splitGlossary('---\n\n*CSV*: a file')).toBeNull()
  expect(splitGlossary('---\n\nJust a rule.\n\n---\n\nText')).toBeNull()
})

test('finds every term, plurals too, and never inside a longer word', () => {
  const text = 'A mod, two mods, a modern mod-like thing, and the Mod.'
  const found = findTerms(text, ['mod']).map(m => text.slice(m.start, m.end))
  expect(found).toEqual(['mod', 'mods', 'mod', 'Mod'])
})

test('prefers the longest term', () => {
  const text = 'the loader script and the script'
  const found = findTerms(text, ['script', 'loader script']).map(m => text.slice(m.start, m.end))
  expect(found).toEqual(['loader script', 'script'])
})

test('reads bold, italic, code and links as styled runs', () => {
  expect(parseInline('a **b** *c* `d` [e](https://x.y) snake_case_name')).toEqual([
    { text: 'a ', style: {} },
    { text: 'b', style: { bold: true } },
    { text: ' ', style: {} },
    { text: 'c', style: { italic: true } },
    { text: ' ', style: {} },
    { text: 'd', style: { code: true } },
    { text: ' ', style: {} },
    { text: 'e', style: { link: true } },
    { text: ' snake_case_name', style: {} },
  ])
})

test('marks a term inside bold text and leaves code fences to markdown', () => {
  const g = splitGlossary(REPLY)
  if (g === null) throw new Error('no glossary')
  const { blocks } = plan(g, 97, null)
  expect(blocks.map(b => b.kind)).toEqual(['para', 'list', 'raw'])
  const raw = blocks[2] ?? { kind: 'para', heading: false, lines: [], below: [] }
  expect(raw.kind === 'raw' && raw.text.includes('python loader script.py')).toBe(true)
  expect(raw.kind === 'raw' && raw.text.includes('Nothing here has a term.')).toBe(true)
  const para = blocks[0]
  if (para?.kind !== 'para') throw new Error('not a paragraph')
  const marked = (para.lines[0] ?? []).flatMap(w => w.parts).filter(p => p.occ !== undefined)
  expect(marked.map(p => [p.text, p.style.bold === true])).toEqual([
    ['loader script', false],
    ['CSV', true],
    ['loader scripts', false],
  ])
})

test('opens each card on the side of its term with more room', () => {
  const g = splitGlossary(REPLY)
  if (g === null) throw new Error('no glossary')
  // The message's rows 0 to 4 are on screen: the paragraph on row 1 has room
  // below it, the list on row 3 has room above it.
  const { blocks } = plan(g, 97, { first: 0, last: 4 })
  const para = blocks[0]
  if (para?.kind !== 'para') throw new Error('not a paragraph')
  expect(para.below.map(c => c.term)).toEqual(['loader script', 'CSV', 'loader script'])
  const list = blocks[1]
  if (list?.kind !== 'list') throw new Error('not a list')
  const above = list.items.flatMap(i => i.lines.flat()).flatMap(w => w.cards)
  expect(above.map(c => [c.term, c.placement])).toEqual([['CSV', 'above']])
})

// Every element of a drawn tree, outermost first.
type Node = { type: string; props?: Record<string, unknown>; hover?: { scope?: string; display?: string }; children?: unknown[] }
function walk(node: unknown, out: Node[] = []): Node[] {
  if (typeof node !== 'object' || node === null) return out
  const n = node as Node
  out.push(n)
  for (const child of n.children ?? []) walk(child, out)
  return out
}
const textOf = (n: Node): string => (n.children ?? []).map(c => (typeof c === 'string' ? c : textOf(c as Node))).join('')

// Stands in for the engine's own drawing of the reply.
const ENGINE = { type: 'engine', ref: 0 } as const

test('draws terms underlined, with a hidden card, in the fullscreen terminal', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, () => ENGINE)
  const ui = await $.ui.mount({
    plugin: 'wordwise-claude-code',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: REPLY, isFirstOfReply: true },
    viewport: FULLSCREEN,
  })
  const nodes = walk(await ui.drawn())
  const terms = nodes.filter(n => n.type === 'Text' && n.props?.underline === true && textOf(n).startsWith('loader script'))
  expect(terms).toHaveLength(2)
  const scope = terms[0]?.hover?.scope
  const cards = nodes.filter(n => n.type === 'Box' && n.hover?.scope === scope)
  expect(cards).toHaveLength(1)
  const card = cards[0] ?? { type: 'none' }
  expect(card.props?.display).toBe('none')
  expect(card.hover?.display).toBe('flex')
  expect(textOf(card)).toContain('the Python file that reads offers')
  expect(nodes.some(n => n.type === 'Text' && textOf(n).includes('*loader script*'))).toBe(false)
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain('python loader script.py')
})

test('leaves the reply to the engine outside fullscreen', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, () => ENGINE)
  const ui = await $.ui.mount({
    plugin: 'wordwise-claude-code',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: REPLY, isFirstOfReply: true },
    viewport: { ...FULLSCREEN, isFullscreen: false },
  })
  expect(await ui.drawn()).toMatchObject({ type: 'engine' })
})

test('leaves a reply with no glossary block to the engine', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, () => ENGINE)
  const ui = await $.ui.mount({
    plugin: 'wordwise-claude-code',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: 'Done.', isFirstOfReply: true },
    viewport: FULLSCREEN,
  })
  expect(await ui.drawn()).toMatchObject({ type: 'engine' })
})
