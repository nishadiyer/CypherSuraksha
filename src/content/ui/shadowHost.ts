import { render, type ComponentChild } from 'preact';
import css from './ui.css?inline';

export interface ShadowUI {
  mount(node: ComponentChild): void;
  /** Position the host (fixed) — used to anchor to a video/preview element. */
  place(style: Partial<CSSStyleDeclaration>): void;
  destroy(): void;
}

let sheet: CSSStyleSheet | undefined;
function getSheet(): CSSStyleSheet {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
  }
  return sheet;
}

/**
 * Creates a host element with a *closed* shadow root. The root reference lives
 * only in this closure, so page scripts cannot reach it via element.shadowRoot.
 * Styles go through adoptedStyleSheets, which page CSP cannot block.
 * Hosts are inert to clicks (pointer-events: none) except for the UI itself,
 * and use max z-index to resist overlay click-jacking.
 */
export function createShadowUI(parent: Element = document.documentElement): ShadowUI {
  const host = document.createElement('div');
  Object.assign(host.style, {
    all: 'initial',
    position: 'fixed',
    zIndex: '2147483647',
    pointerEvents: 'none',
    inset: '0 auto auto 0',
  } satisfies Partial<CSSStyleDeclaration>);
  const root = host.attachShadow({ mode: 'closed' });
  root.adoptedStyleSheets = [getSheet()];
  const container = document.createElement('div');
  container.style.pointerEvents = 'auto';
  root.appendChild(container);
  parent.appendChild(host);

  return {
    mount: (node) => render(node, container),
    place: (style) => Object.assign(host.style, style),
    destroy: () => {
      render(null, container);
      host.remove();
    },
  };
}
