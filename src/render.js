'use strict';
// LaTeX -> standalone SVG using MathJax, packaged as a data: URI that a
// VS Code hover can show as an image.

const { mathjax } = require('mathjax-full/js/mathjax.js');
const { TeX } = require('mathjax-full/js/input/tex.js');
const { SVG } = require('mathjax-full/js/output/svg.js');
const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js');

let doc, adaptor;

function init() {
  if (doc) return;
  adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  doc = mathjax.document('', {
    InputJax: new TeX({ packages: AllPackages }),
    // fontCache 'none' keeps every glyph inline, so the SVG works on its own as an <img>
    OutputJax: new SVG({ fontCache: 'none' }),
  });
}

const EX_TO_PX = 8; // roughly one ex at the editor's default font size

/**
 * Render LaTeX to an SVG string.
 * @param {string} latex
 * @param {{color?: string, scale?: number}} opts
 */
function renderSvg(latex, { color = '#000', scale = 1 } = {}) {
  init();
  const node = doc.convert(latex, { display: true });
  let svg = adaptor.innerHTML(node); // the <svg> inside <mjx-container>
  if (svg.includes('data-mjx-error') || svg.includes('merror')) {
    throw new Error(`MathJax could not render: ${latex}`);
  }
  // Images don't inherit the editor colour, so bake it in.
  svg = svg.replace(/currentColor/g, color);
  // Give the image a fixed pixel size; hovers size <img> from these attributes.
  svg = svg.replace(/(width|height)="([\d.]+)ex"/g,
    (_, attr, ex) => `${attr}="${(Number(ex) * EX_TO_PX * scale).toFixed(2)}px"`);
  // Drop the vertical-align style meant for inline text.
  svg = svg.replace(/ style="vertical-align:[^"]*"/, '');
  if (!svg.includes('xmlns=')) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  return svg;
}

function renderDataUri(latex, opts) {
  return `data:image/svg+xml;base64,${Buffer.from(renderSvg(latex, opts)).toString('base64')}`;
}

/**
 * Render LaTeX for drawing inside an editor line.
 *  - display false: inline style (limits beside the Σ), sized to the font
 *  - display true: stacked limits, scaled to `maxHeight` px
 * Returns the SVG plus its pixel size and how far below the text baseline it reaches.
 */
function renderInline(latex, { color = '#000', fontSize = 14, maxHeight = 20, display = false } = {}) {
  init();
  const node = doc.convert(latex, { display });
  let svg = adaptor.innerHTML(node);
  if (svg.includes('data-mjx-error') || svg.includes('merror')) {
    throw new Error(`MathJax could not render: ${latex}`);
  }
  const ex = attr => Number((new RegExp(`${attr}="([\\d.]+)ex"`).exec(svg) || [])[1]);
  const valign = Number((/vertical-align:\s*(-?[\d.]+)ex/.exec(svg) || [0, 0])[1]);
  // MathJax assumes 1ex = half the font size
  let pxPerEx = fontSize / 2;
  const h = ex('height');
  if (h * pxPerEx > maxHeight) pxPerEx = maxHeight / h;
  const width = ex('width') * pxPerEx, height = h * pxPerEx;

  svg = svg.replace(/currentColor/g, color)
    .replace(/(width|height)="([\d.]+)ex"/g, (_, a, v) => `${a}="${(Number(v) * pxPerEx).toFixed(2)}px"`)
    .replace(/ style="vertical-align:[^"]*"/, '');
  if (!svg.includes('xmlns=')) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  return { svg, width, height, descent: -valign * pxPerEx };
}

module.exports = { renderSvg, renderDataUri, renderInline };
