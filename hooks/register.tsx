import type { Register, RenderNode } from 'claude-code'

import { padTo, plan, shortHash, splitGlossary } from './glossary'
import type { Card, Piece, PlanBlock, PlanLine, Style } from './glossary'
import { GLOSSARY_RULE } from './rule'

// Draws a reply that opens with a glossary block without the block: each term
// in the text is underlined, and the pointer resting on one opens a card with
// its meaning. Only the fullscreen terminal reports the pointer, so every
// other drawing is left to the engine, glossary block and all.
export const register: Register = (on, options) => {
  // The rule goes in the system prompt, so Claude writes the block in every
  // session. Turned off in /config, Claude writes it only if CLAUDE.md asks.
  if (options.askForGlossary !== false) {
    on('prompt.compose', async ($, e, next) => {
      const composed = await next(e)
      return { sections: [...composed.sections, { id: 'wordwise-cc:glossary', text: GLOSSARY_RULE, scope: 'session' }] }
    })
  }

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.viewport?.isFullscreen !== true || e.props.isSummary) {
      return next(e)
    }
    const glossary = splitGlossary(e.props.text)
    if (glossary === null) {
      return next(e)
    }

    const { Box, Text, Markdown } = $.ui.resolve(e)
    // Two cells for the bullet, one spare so a line never touches the edge.
    const width = Math.max(20, e.viewport.columns - 3)
    const { blocks } = plan(glossary, width, e.props.onScreen ?? null)
    const prefix = `ww${shortHash(e.requestId)}-`

    // Only the styles a piece has: a prop left undefined is not sent.
    const textProps = (style: Style, isHeading: boolean) => {
      const props: { bold?: true; italic?: true; strikethrough?: true; color?: string } = {}
      if (style.bold || isHeading) props.bold = true
      if (style.italic) props.italic = true
      if (style.strike) props.strikethrough = true
      if (style.code) props.color = 'permission'
      else if (style.link) props.color = 'suggestion'
      return props
    }

    const card = (c: Card, top: number) => (
      <Box
        position="absolute"
        top={top}
        left={c.left}
        width={c.width}
        height={c.height}
        display="none"
        hover={{ display: 'flex', scope: prefix + c.occ }}
        flexDirection="column"
        borderStyle="round"
        borderColor="suggestion"
      >
        <Text bold color="suggestion" wrap="truncate">
          {` ${padTo(c.term, c.width - 4)} `}
        </Text>
        {c.lines.map(l => (
          <Text wrap="truncate">{` ${padTo(l, c.width - 4)} `}</Text>
        ))}
      </Box>
    )

    const piece = (p: Piece, isHeading: boolean) =>
      p.occ === undefined ? (
        <Text {...textProps(p.style, isHeading)}>{p.text}</Text>
      ) : (
        <Text
          {...textProps(p.style, isHeading)}
          underline
          hover={{ scope: prefix + p.occ, color: 'suggestion' }}
        >
          {p.text}
        </Text>
      )

    const line = (words: PlanLine, isHeading: boolean) => (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {words.map(w =>
          w.cards.length === 0 && w.parts.length === 1 && w.parts[0] ? (
            piece(w.parts[0], isHeading)
          ) : (
            <Box flexDirection="row" flexShrink={0}>
              {w.parts.map(p => piece(p, isHeading))}
              {w.cards.map(c => card(c, -c.height))}
            </Box>
          ),
        )}
      </Box>
    )

    const body = (b: PlanBlock): RenderNode => {
      if (b.kind === 'raw') {
        return <Markdown text={b.text} />
      }
      if (b.kind === 'para') {
        return <Box flexDirection="column">{b.lines.map(l => line(l, b.heading))}</Box>
      }
      return (
        <Box flexDirection="column">
          {b.items.map(item => (
            <Box flexDirection="row" paddingLeft={item.indent}>
              <Box flexShrink={0}>
                <Text>{`${item.marker} `}</Text>
              </Box>
              <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                {item.lines.map(l => line(l, false))}
              </Box>
            </Box>
          ))}
        </Box>
      )
    }

    // A block whose cards open below it holds every later block, its cards
    // last, so they paint over the text beneath and not the other way round.
    const draw = (from: number): RenderNode[] => {
      const out: RenderNode[] = []
      for (let i = from; i < blocks.length; i++) {
        const b = blocks[i]
        if (b === undefined) continue
        const marginTop = i === 0 ? 0 : 1
        if (b.kind !== 'raw' && b.below.length > 0) {
          out.push(
            <Box flexDirection="column" marginTop={marginTop}>
              {body(b)}
              <Box flexDirection="column">
                {draw(i + 1)}
                {b.below.map(c => card(c, 0))}
              </Box>
            </Box>,
          )
          return out
        }
        out.push(
          <Box flexDirection="column" marginTop={marginTop}>
            {body(b)}
          </Box>,
        )
      }
      return out
    }

    return (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row">
          <Box width={2} flexShrink={0}>
            <Text color="text">{e.props.isFirstOfReply ? '⏺' : ' '}</Text>
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            {draw(0)}
          </Box>
        </Box>
      </Box>
    )
  })
}
