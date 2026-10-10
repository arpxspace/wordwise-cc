// The text work of wordwise-cc, with no drawing in it: find the glossary
// block at the top of a reply, split the rest into blocks, mark each term,
// and plan where every hover card goes.

export type Term = { term: string; meaning: string }

export type Glossary = { terms: Term[]; body: string }

export type Style = {
  bold?: true
  italic?: true
  code?: true
  link?: true
  strike?: true
}

export type Run = { text: string; style: Style }

export type Piece = { text: string; style: Style; occ?: number }

export type Match = { start: number; end: number; term: number }

export type Card = {
  occ: number
  term: string
  lines: string[]
  width: number
  height: number
  placement: 'above' | 'below'
  left: number
}

export type PlanItem = { parts: Piece[]; cards: Card[] }

export type PlanLine = PlanItem[]

export type PlanBlock =
  | { kind: 'raw'; text: string }
  | { kind: 'para'; heading: boolean; lines: PlanLine[]; below: Card[] }
  | {
      kind: 'list'
      items: { indent: number; marker: string; lines: PlanLine[] }[]
      below: Card[]
    }

export type Plan = { blocks: PlanBlock[]; terms: Term[] }

// Rows of the message the transcript shows now, as `onScreen` reports them.
export type Visible = { first: number; last: number }

const CARD_MAX = 48
const MAX_NESTED = 10

const RULE = /^\s*-{3,}\s*$/
const TERM_LINE = /^(?:[-*+]\s+)?(\*\*|\*|__|_)(.+?)\1\s*:\s*(.*)$/
const FENCE = /^\s*(`{3,}|~{3,})/
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/
const TABLE = /^\s*\|/
const QUOTE = /^\s*>/
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const HTML = /^\s*<\/?[A-Za-z]/

/**
 * The glossary block at the top of a reply and the reply without it: a `---`
 * line, `*term*: meaning` lines, a `---` line. Null when the reply opens with
 * no such block, or while the closing line has not streamed in yet.
 */
export function splitGlossary(text: string): Glossary | null {
  const lines = text.split('\n')
  let start = 0
  while (start < lines.length && (lines[start] ?? '').trim() === '') start++
  if (start >= lines.length || !RULE.test(lines[start] ?? '')) return null
  let end = start + 1
  while (end < lines.length && !RULE.test(lines[end] ?? '')) end++
  if (end >= lines.length) return null

  const terms: Term[] = []
  for (const line of lines.slice(start + 1, end)) {
    if (line.trim() === '') continue
    const m = TERM_LINE.exec(line.trim())
    if (m) {
      terms.push({ term: plain(m[2] ?? '').trim(), meaning: plain(m[3] ?? '').trim() })
    } else {
      const last = terms[terms.length - 1]
      if (last) last.meaning = `${last.meaning} ${plain(line).trim()}`.trim()
    }
  }
  const named = terms.filter(t => t.term !== '')
  if (named.length === 0) return null

  let rest = end + 1
  while (rest < lines.length && (lines[rest] ?? '').trim() === '') rest++
  return { terms: named, body: lines.slice(rest).join('\n') }
}

/** Markdown text with its links, code ticks and stars taken out. */
export function plain(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`+/g, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/\*(\S(?:.*?\S)?)\*/g, '$1')
}

/**
 * Every place a term shows up in `text`, longest term first, in order: any
 * case, a plural `s` included, never inside a longer word.
 */
export function findTerms(text: string, terms: readonly string[]): Match[] {
  const order = terms
    .map((t, i) => ({ t: t.trim(), i }))
    .filter(x => x.t !== '')
    .sort((a, b) => b.t.length - a.t.length)
  if (order.length === 0) return []

  const source = order
    .map(x => `(${x.t.split(/\s+/).map(escapeRegExp).join('\\s+')})s?`)
    .join('|')
  const pattern = new RegExp(source, 'gi')
  const out: Match[] = []
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    const start = m.index
    const end = start + m[0].length
    if (end === start) {
      pattern.lastIndex = start + 1
      continue
    }
    const isInside =
      (start > 0 && isWordChar(text.charAt(start - 1))) ||
      (end < text.length && isWordChar(text.charAt(end)))
    if (isInside) {
      pattern.lastIndex = start + 1
      continue
    }
    let group = 1
    while (m[group] === undefined) group++
    out.push({ start, end, term: order[group - 1]?.i ?? 0 })
  }
  return out
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch) || (ch > '\x7f' && ch.toLowerCase() !== ch.toUpperCase())
}

/** One line of markdown as styled runs: bold, italic, code, links, strikes. */
export function parseInline(src: string): Run[] {
  const out: Run[] = []
  inline(src, {}, out)
  return out.filter(r => r.text !== '')
}

const DELIMITERS: readonly (readonly [string, keyof Style])[] = [
  ['**', 'bold'],
  ['__', 'bold'],
  ['~~', 'strike'],
  ['*', 'italic'],
  ['_', 'italic'],
]

function inline(src: string, style: Style, out: Run[]): void {
  let buf = ''
  const flush = () => {
    if (buf !== '') out.push({ text: buf, style })
    buf = ''
  }
  let i = 0
  outer: while (i < src.length) {
    const c = src[i]
    if (c === '\\' && i + 1 < src.length && /[!-/:-@[-`{-~]/.test(src.charAt(i + 1))) {
      buf += src[i + 1]
      i += 2
      continue
    }
    if (c === '`') {
      let n = 1
      while (src[i + n] === '`') n++
      const close = closingTicks(src, i + n, n)
      if (close >= 0) {
        flush()
        let code = src.slice(i + n, close)
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ')) code = code.slice(1, -1)
        out.push({ text: code, style: { ...style, code: true } })
        i = close + n
        continue
      }
      buf += '`'.repeat(n)
      i += n
      continue
    }
    for (const [mark, key] of DELIMITERS) {
      if (!src.startsWith(mark, i)) continue
      const after = src[i + mark.length]
      if (after === undefined || /\s/.test(after)) continue
      if (mark[0] === '_' && i > 0 && isWordChar(src.charAt(i - 1))) continue
      const close = closingMark(src, mark, i + mark.length)
      if (close < 0) continue
      flush()
      inline(src.slice(i + mark.length, close), { ...style, [key]: true }, out)
      i = close + mark.length
      continue outer
    }
    if (c === '[') {
      const mid = src.indexOf('](', i + 1)
      const end = mid < 0 ? -1 : src.indexOf(')', mid + 2)
      if (mid > i && end > mid) {
        flush()
        inline(src.slice(i + 1, mid), { ...style, link: true }, out)
        i = end + 1
        continue
      }
    }
    buf += c
    i += 1
  }
  flush()
}

function closingTicks(src: string, from: number, n: number): number {
  let j = from
  while (j < src.length) {
    if (src[j] !== '`') {
      j++
      continue
    }
    let run = 0
    while (src[j + run] === '`') run++
    if (run === n) return j
    j += run
  }
  return -1
}

function closingMark(src: string, mark: string, from: number): number {
  let j = src.indexOf(mark, from)
  while (j > from) {
    const before = src.charAt(j - 1)
    const doubled = mark.length === 1 && (src[j + 1] === mark || before === mark)
    const wordAfter = mark[0] === '_' && j + mark.length < src.length && isWordChar(src.charAt(j + mark.length))
    if (!/\s/.test(before) && !doubled && !wordAfter) return j
    j = src.indexOf(mark, j + 1)
  }
  return -1
}

/** Runs cut at each term's edges; a piece inside a term carries its `occ`. */
export function markTerms(runs: readonly Run[], matches: readonly Match[], firstOcc: number): Piece[] {
  const pieces: Piece[] = []
  let pos = 0
  for (const run of runs) {
    const runStart = pos
    const runEnd = pos + run.text.length
    let cut = runStart
    matches.forEach((m, k) => {
      if (m.end <= cut || m.start >= runEnd) return
      const s = Math.max(m.start, cut)
      const e = Math.min(m.end, runEnd)
      if (s > cut) pieces.push({ text: run.text.slice(cut - runStart, s - runStart), style: run.style })
      pieces.push({ text: run.text.slice(s - runStart, e - runStart), style: run.style, occ: firstOcc + k })
      cut = e
    })
    if (cut < runEnd) pieces.push({ text: run.text.slice(cut - runStart), style: run.style })
    pos = runEnd
  }
  return pieces
}

/**
 * Pieces grouped into the words the line wraps between. A term stays one
 * word, spaces and all, so it never breaks across two rows.
 */
export function toWords(pieces: readonly Piece[]): Piece[][] {
  const words: Piece[][] = []
  let parts: Piece[] = []
  const end = () => {
    if (parts.length > 0) words.push(parts)
    parts = []
  }
  for (const p of pieces) {
    if (p.occ !== undefined) {
      parts.push({ ...p, text: p.text.replace(/\s+/g, ' ') })
      continue
    }
    for (const bit of p.text.split(/(\s+)/)) {
      if (bit === '') continue
      if (/^\s+$/.test(bit)) end()
      else parts.push({ text: bit, style: p.style })
    }
  }
  end()
  return words
}

/** Cells a string takes in the terminal: wide CJK and emoji count two. */
export function textWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    const isZero =
      c === 0x200d || (c >= 0x300 && c <= 0x36f) || (c >= 0xfe00 && c <= 0xfe0f) || (c >= 0x200b && c <= 0x200f)
    if (isZero) continue
    const isWide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x1f300 && c <= 0x1faff) ||
      (c >= 0x20000 && c <= 0x3fffd)
    w += isWide ? 2 : 1
  }
  return w
}

/** Plain text cut into lines no wider than `width`, at spaces when it can. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(w => w !== '')) {
    let rest = word
    while (textWidth(rest) > width) {
      if (line !== '') {
        lines.push(line)
        line = ''
      }
      lines.push(rest.slice(0, width))
      rest = rest.slice(width)
    }
    if (line === '') line = rest
    else if (textWidth(line) + 1 + textWidth(rest) <= width) line += ` ${rest}`
    else {
      lines.push(line)
      line = rest
    }
  }
  if (line !== '') lines.push(line)
  return lines.length > 0 ? lines : ['']
}

/** A line of text padded with spaces to exactly `width` cells. */
export function padTo(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - textWidth(s)))
}

type Source =
  | { kind: 'raw'; text: string }
  | { kind: 'para'; heading: boolean; lines: string[]; text: string }
  | { kind: 'list'; items: { indent: number; marker: string; lines: string[] }[]; text: string }

/** The reply cut into code fences, tables, headings, lists and paragraphs. */
export function parseBlocks(body: string): Source[] {
  const lines = body.split('\n')
  const blocks: Source[] = []
  const isStart = (l: string) =>
    FENCE.test(l) || HEADING.test(l) || TABLE.test(l) || QUOTE.test(l) || HR.test(l) || LIST.test(l)
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (line.trim() === '') {
      i++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      const mark = fence[1] ?? '```'
      let j = i + 1
      while (j < lines.length && !isFenceClose(lines[j] ?? '', mark)) j++
      blocks.push({ kind: 'raw', text: lines.slice(i, j + 1).join('\n') })
      i = j + 1
      continue
    }
    if (HR.test(line)) {
      blocks.push({ kind: 'raw', text: line })
      i++
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ kind: 'para', heading: true, lines: [heading[1] ?? ''], text: line })
      i++
      continue
    }
    if (TABLE.test(line) || QUOTE.test(line) || HTML.test(line)) {
      const same = TABLE.test(line) ? TABLE : QUOTE.test(line) ? QUOTE : null
      let j = i + 1
      while (j < lines.length && (lines[j] ?? '').trim() !== '' && (same === null || same.test(lines[j] ?? ''))) j++
      blocks.push({ kind: 'raw', text: lines.slice(i, j).join('\n') })
      i = j
      continue
    }
    if (LIST.test(line)) {
      const items: { indent: number; marker: string; lines: string[] }[] = []
      let j = i
      while (j < lines.length && (lines[j] ?? '').trim() !== '') {
        const next = lines[j] ?? ''
        const item = LIST.exec(next)
        if (item) {
          items.push({ indent: Math.floor((item[1] ?? '').replace(/\t/g, '    ').length / 2), marker: item[2] ?? '-', lines: [item[3] ?? ''] })
        } else if (isStart(next)) {
          break
        } else {
          items[items.length - 1]?.lines.push(next.trim())
        }
        j++
      }
      blocks.push({ kind: 'list', items, text: lines.slice(i, j).join('\n') })
      i = j
      continue
    }
    let j = i
    while (j < lines.length && (lines[j] ?? '').trim() !== '' && (j === i || !isStart(lines[j] ?? ''))) j++
    blocks.push({ kind: 'para', heading: false, lines: lines.slice(i, j).map(l => l.trim()), text: lines.slice(i, j).join('\n') })
    i = j
  }
  return blocks
}

function isFenceClose(line: string, mark: string): boolean {
  const t = line.trim()
  return t.length >= mark.length && [...t].every(ch => ch === mark[0])
}

type Flow = { rows: number; at: { row: number; col: number }[] }

/** Where each word lands when a row of `width` cells wraps them, one cell apart. */
export function flow(widths: readonly number[], width: number): Flow {
  let row = 0
  let col = 0
  const at: { row: number; col: number }[] = []
  for (const raw of widths) {
    const w = Math.max(1, raw)
    if (col > 0 && col + 1 + w > width) {
      row++
      col = 0
    } else if (col > 0) {
      col += 1
    }
    at.push({ row, col })
    col += w
    if (col > width) {
      row += Math.ceil(col / width) - 1
      col = col % width || width
    }
  }
  return { rows: row + 1, at }
}

function estimateRows(text: string, width: number): number {
  return text
    .split('\n')
    .reduce((rows, line) => rows + Math.max(1, Math.ceil(textWidth(line) / Math.max(1, width))), 0)
}

/**
 * The drawing's plan: each block, each word, and each hover card with the
 * side it opens on. `width` is the cells a line of text has; `visible` the
 * message's rows on screen now, so a card near an edge opens the other way.
 */
export function plan(glossary: Glossary, width: number, visible: Visible | null): Plan {
  const names = glossary.terms.map(t => t.term)
  const cardWidth = Math.max(16, Math.min(CARD_MAX, width))
  let occ = 0
  let nested = 0
  // Row 0 is the blank row above the message; the text starts on row 1.
  let row = 1
  const top = visible?.first ?? 0
  const bottom = visible?.last ?? Number.POSITIVE_INFINITY
  const blocks: PlanBlock[] = []

  const makeCard = (piece: Piece, termIndex: number): Card => {
    const t = glossary.terms[termIndex] ?? { term: '', meaning: '' }
    const lines = wrapText(t.meaning, cardWidth - 4)
    return {
      occ: piece.occ ?? 0,
      term: t.term,
      lines,
      width: cardWidth,
      height: lines.length + 3,
      placement: 'above',
      left: 0,
    }
  }

  // One line of text as words with their cards, and how many rows it takes.
  const layLine = (src: string, lineWidth: number, rowAt: number, colAt: number, below: Card[]) => {
    const runs = parseInline(src)
    const text = runs.map(r => r.text).join('')
    const matches = findTerms(text, names)
    const pieces = markTerms(runs, matches, occ)
    const first = occ
    occ += matches.length
    const words = toWords(pieces)
    const placed = flow(words.map(w => w.reduce((n, p) => n + textWidth(p.text), 0)), lineWidth)
    const seen = new Set<number>()
    const line: PlanLine = words.map((parts, k) => {
      const cards: Card[] = []
      for (const p of parts) {
        if (p.occ === undefined || seen.has(p.occ)) continue
        seen.add(p.occ)
        const card = makeCard(p, matches[p.occ - first]?.term ?? 0)
        const at = placed.at[k] ?? { row: 0, col: 0 }
        const termRow = rowAt + at.row
        const col = at.col
        const roomAbove = termRow - top
        const blockEnd = rowAt + placed.rows
        const roomBelow = bottom - blockEnd
        const isAbove = roomAbove >= card.height || roomAbove >= roomBelow
        if (isAbove) {
          const shift = Math.min(col, Math.max(0, col + card.width - lineWidth))
          cards.push({ ...card, placement: 'above', left: -shift })
        } else {
          below.push({ ...card, placement: 'below', left: Math.max(0, Math.min(colAt + col, colAt + lineWidth - card.width)) })
        }
      }
      return { parts, cards }
    })
    return { line, rows: placed.rows, terms: matches.length }
  }

  const sources = parseBlocks(glossary.body)
  sources.forEach((src, index) => {
    if (index > 0) row += 1
    if (src.kind === 'raw') {
      blocks.push({ kind: 'raw', text: src.text })
      row += estimateRows(src.text, width)
      return
    }
    const below: Card[] = []
    const occBefore = occ
    let rows = 0
    let block: PlanBlock
    if (src.kind === 'para') {
      const lines = src.lines.map(l => {
        const laid = layLine(l, width, row + rows, 0, below)
        rows += laid.rows
        return laid.line
      })
      block = { kind: 'para', heading: src.heading, lines, below }
    } else {
      const items = src.items.map(item => {
        const indent = item.indent * 2
        const markerWidth = textWidth(item.marker) + 1
        const lines = item.lines.map(l => {
          const laid = layLine(l, Math.max(1, width - indent - markerWidth), row + rows, indent + markerWidth, below)
          rows += laid.rows
          return laid.line
        })
        return { indent, marker: item.marker, lines }
      })
      block = { kind: 'list', items, below }
    }
    row += rows
    if (occ === occBefore) {
      blocks.push({ kind: 'raw', text: src.text })
      return
    }
    if (below.length > 0) {
      if (nested >= MAX_NESTED) {
        flipAbove(block)
      } else {
        nested++
      }
    }
    blocks.push(block)
  })

  return { blocks: mergeRaw(blocks), terms: glossary.terms }
}

// Past the nesting cap, a block's below cards open above their term instead.
function flipAbove(block: PlanBlock): void {
  if (block.kind === 'raw') return
  const lines = block.kind === 'para' ? block.lines : block.items.flatMap(i => i.lines)
  for (const card of block.below.splice(0)) {
    for (const line of lines) {
      const item = line.find(w => w.parts.some(p => p.occ === card.occ))
      if (item) item.cards.push({ ...card, placement: 'above', left: 0 })
    }
  }
}

function mergeRaw(blocks: PlanBlock[]): PlanBlock[] {
  const out: PlanBlock[] = []
  for (const b of blocks) {
    const last = out[out.length - 1]
    if (b.kind === 'raw' && last?.kind === 'raw') {
      out[out.length - 1] = { kind: 'raw', text: `${last.text}\n\n${b.text}` }
    } else {
      out.push(b)
    }
  }
  return out
}

/** A short, steady name for a message, for its cards' hover scopes. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
