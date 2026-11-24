#!/usr/bin/env python3
"""Builds the self-contained betadoc pages (betadoc/index.html, betadoc/documentation.html) from betadoc/src/.
Inlines the CSS and the logo so the pages need no external files. Run: python3 scripts/build-betadoc.py"""
import base64, pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
src = root / 'betadoc' / 'src'
css = (src / 'style.css').read_text()
logo = (root / 'src' / 'assets' / 'logo.svg').read_text()
logo = re.sub(r'<!--.*?-->', '', logo, flags=re.S).strip()
favicon = 'data:image/svg+xml;base64,' + base64.b64encode(logo.encode()).decode()
inline_logo = re.sub(r'<svg ', '<svg aria-hidden="true" ', logo, 1)

def page(title, desc, body, here):
    link = lambda href, label, key: f'<a class="l" href="{href}"' + (' aria-current="page" style="color:var(--ink)"' if key == here else '') + f'>{label}</a>'
    nav = (f'<nav><div class="wrap"><a class="brand" href="index.html">{inline_logo}CypherSuraksha</a><span class="sp"></span>'
           + link('index.html#product', 'Product', 'x') + link('index.html#matrix', 'Status', 'x') + link('documentation.html', 'Docs', 'doc')
           + '<a class="btn" style="padding:8px 14px;font-size:13px" href="index.html#demo">Try the demo</a></div></nav>')
    foot = '<footer><div class="wrap">CypherSuraksha beta. Everything runs on your device. Built on open-source models: bert-base-NER (MIT), FaceNet, UltraFace, CommunityForensics and GenD, each under its own licence (see MODELS.md).</div></footer>'
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>{title}</title><meta name="description" content="{desc}"><link rel="icon" href="{favicon}"><style>{css}</style></head><body>{nav}{body}{foot}</body></html>')

out = root / 'betadoc'
(out / 'index.html').write_text(page('CypherSuraksha — on-device AI privacy armor', 'Browser extension that redacts prompts, cloaks photos and flags AI-generated faces. Everything runs on your device.', (src / 'index.body.html').read_text(), 'home'))
(out / 'documentation.html').write_text(page('CypherSuraksha documentation', 'Install, user manual, architecture, limits and demo guide for the CypherSuraksha browser extension.', (src / 'documentation.body.html').read_text(), 'doc'))
print('built', [p.name for p in out.glob('*.html')])
