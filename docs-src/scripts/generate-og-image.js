import { readFileSync, writeFileSync } from 'fs'
import { Resvg } from '@resvg/resvg-js'

const svg = readFileSync(new URL('../public/og-image.svg', import.meta.url), 'utf-8')
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1200 },
  font: {
    loadSystemFonts: true,
  },
})
const png = resvg.render().asPng()
writeFileSync(new URL('../../docs/og-image.png', import.meta.url), png)
console.log('Generated og-image.png')
