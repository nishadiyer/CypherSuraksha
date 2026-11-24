const pptxgen = require('pptxgenjs');
const sharp = require('sharp');
const { applyTheme } = require('/Users/nishadiyer/.claude/skills/synced/83578a0e-4d83-40ea-84dd-79e75b2f5042_e0f1b683-79da-4363-a279-6533afd2e9e8/pptx/scripts/apply_theme.js');

// ---- palette = the extension's dark mode ----
const BG = '080C18', CARD = '0F172B', CARD2 = '0B1324', LINE = '1C2842', TEXT = 'E9EEFB', MUTED = '8794B3', TEAL = '3FE0C1', BLUE = '4DA3FF', AMBER = 'F6A94A', GREEN = '3DDC97', RED = 'FF6B73';
const THEME = { name: 'CypherSuraksha Dark', headFontFace: 'Arial', bodyFontFace: 'Arial',
  colors: { dk1: BG, lt1: TEXT, dk2: CARD, lt2: MUTED, accent1: TEAL, accent2: BLUE, accent3: AMBER, accent4: GREEN, accent5: RED, accent6: LINE, hlink: BLUE, folHlink: MUTED } };

// ---- icons (same stroke style as the popup), rasterised to PNG ----
const ICONS = {
  text: '<path d="M5 7h14M5 12h9M5 17h12"/><path d="m17 14 2 2 3-3.5"/>',
  face: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="11" r="3"/><path d="M7.5 18c.8-2 2.5-3 4.5-3s3.700 1 4.500 3"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="m16 10.500 5-3v9l-5-3"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.4 3 7.9 7.5 9.5 4.5-1.600 7.500-5.100 7.500-9.500V6L12 3Z"/><path d="m9 12 2.200 2.200L15.500 10"/>',
  lock: '<rect x="5" y="10.500" width="14" height="10" rx="2.500"/><path d="M8 10.500V8a4 4 0 0 1 8 0v2.500M12 14.500v2.500"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.500 2.700 3.800 5.700 3.800 9S14.500 18.300 12 21c-2.500-2.700-3.800-5.700-3.800-9S9.500 5.700 12 3Z"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.500" y="9.500" width="5" height="5" rx="1"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><circle cx="12" cy="14" r="2.500"/><path d="m14 16 2.500 2.500"/>',
  store: '<path d="M4 9.500 5.500 4h13L20 9.500"/><path d="M4 9.500a2.800 2.800 0 0 0 5.300 0 2.800 2.800 0 0 0 5.400 0 2.800 2.800 0 0 0 5.300 0"/><path d="M5.500 12v8h13v-8M10 20v-4.500h4V20"/>',
  user: '<circle cx="12" cy="8" r="3.500"/><path d="M5 20c.8-3.500 3.500-5.500 7-5.500s6.200 2 7 5.500"/>',
  family: '<circle cx="8" cy="8" r="2.800"/><circle cx="17" cy="9.500" r="2.200"/><path d="M3 19c.6-3 2.600-4.800 5-4.800s4.400 1.800 5 4.800M14.500 18.500c.4-2.200 1.800-3.500 3.500-3.500s3 1.300 3.500 3.500"/>',
  brief: '<rect x="3" y="7" width="18" height="13" rx="2.500"/><path d="M9 7V5a1.500 1.500 0 0 1 1.500-1.500h3A1.500 1.500 0 0 1 15 5v2M3 13h18"/>',
  phone: '<path d="M6 3h3l1.500 4-2 1.500a11 11 0 0 0 6 6L16 12.500 20 14v3a2 2 0 0 1-2 2A15 15 0 0 1 4 5a2 2 0 0 1 2-2Z"/>',
  eye: '<path d="M2 12s3.500-6.500 10-6.500S22 12 22 12s-3.500 6.500-10 6.500S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  leak: '<path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11Z"/><path d="M12 12v4M12 18.500v.01"/>',
};
async function icon(name, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 24 24" fill="none" stroke="#${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return 'image/png;base64,' + (await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64');
}

const fs = require('fs'); const MB = {}; for (const f of ['face-detector.ultraface.onnx','people-deepfake.int8.onnx','people-deepfake.fp32.onnx','privacy-ner.int8.onnx','cloak-facenet-casia.onnx','cloak-facenet-vggface2.onnx','people-gend.fp16.onnx']) MB[f] = fs.statSync('/Users/nishadiyer/Desktop/Projects/CypherSuraksha/CypherKaavach/dist-demo/models/' + f).size / 1e6;
(async () => {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
  pres.title = 'CypherSuraksha'; pres.author = 'Team CypherSuraksha';
  const W = 13.33, M = 0.65;

  // one layout: dark background, small logo bottom-left, slide number bottom-right, named title placeholder
  const frame = (title) => ({
    title, background: { color: BG },
    objects: [
      { image: { path: 'logo.png', x: 0.45, y: 6.88, w: 0.4, h: 0.4, altText: 'CypherSuraksha logo' } },
      { text: { text: 'CypherSuraksha', options: { x: 0.92, y: 6.88, w: 3, h: 0.4, fontFace: 'Arial', fontSize: 11, color: MUTED, valign: 'middle', margin: 0 } } },
    ],
    slideNumber: { x: 12.1, y: 6.88, w: 0.6, h: 0.4, fontFace: 'Arial', fontSize: 11, color: MUTED, align: 'right' },
  });
  pres.defineSlideMaster({ ...frame('CS_CONTENT'),
    objects: [...frame('').objects, { placeholder: { options: { name: 'title', type: 'title', x: M, y: 0.45, w: W - 2 * M, h: 0.9, fontFace: 'Arial', fontSize: 38, bold: true, color: TEXT, align: 'left', valign: 'middle', margin: 0 }, text: '' } }] });
  pres.defineSlideMaster({ ...frame('CS_TITLE'),
    objects: [...frame('').objects, { placeholder: { options: { name: 'title', type: 'title', x: M, y: 1.0, w: 8, h: 1.0, fontFace: 'Arial', fontSize: 54, bold: true, color: TEXT, align: 'left', valign: 'middle', margin: 0 }, text: '' } }] });
  pres.defineSlideMaster({ ...frame('CS_CLOSE'),
    objects: [...frame('').objects, { placeholder: { options: { name: 'title', type: 'title', x: M, y: 2.35, w: 7.4, h: 1.2, fontFace: 'Arial', fontSize: 60, bold: true, color: TEXT, align: 'left', valign: 'middle', margin: 0 }, text: '' } }] });

  pres.addSection({ title: 'CypherSuraksha pitch' });
  const mk = (layout) => pres.addSlide({ masterName: layout, sectionTitle: 'CypherSuraksha pitch' });
  const card = (s, x, y, w, h, name, fill = CARD) => s.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.14, fill: { color: fill }, line: { color: LINE, width: 1 }, objectName: name });
  const badge = async (s, x, y, d, ic, color, name) => {
    s.addShape(pres.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color, transparency: 86 }, line: { color, width: 1, transparency: 55 }, objectName: name + ' badge' });
    s.addImage({ data: await icon(ic, color), x: x + d * 0.22, y: y + d * 0.22, w: d * 0.56, h: d * 0.56, altText: name, objectName: name + ' icon' });
  };
  const txt = (s, t, o) => s.addText(t, { isTextBox: true, fontFace: 'Arial', margin: 0, color: TEXT, ...o });
  const chip = (s, x, y, w, label, color) => {
    s.addShape(pres.ShapeType.roundRect, { x, y, w, h: 0.4, rectRadius: 0.2, fill: { color, transparency: 88 }, line: { color, width: 1, transparency: 50 }, objectName: 'chip ' + label });
    txt(s, label, { x, y, w, h: 0.4, fontSize: 13, bold: true, color, align: 'center', valign: 'middle' });
  };

  // ---------- 1. Title + team ----------
  {
    const s = mk('CS_TITLE');
    txt(s, 'ON-DEVICE AI PRIVACY ARMOR', { x: M, y: 0.6, w: 7, h: 0.35, fontSize: 14, bold: true, color: TEAL, charSpacing: 4 });
    s.addText('CypherSuraksha', { placeholder: 'title' });
    txt(s, 'Stops private details reaching AI chatbots, cloaks your photos, and flags AI-generated faces on video calls. Nothing ever leaves your device.', { x: M, y: 2.15, w: 7.2, h: 0.95, fontSize: 17, color: MUTED, valign: 'top' });
    chip(s, M, 3.3, 1.6, 'PromptGuard', AMBER); chip(s, M + 1.75, 3.3, 1.6, 'Pixel Cloak', BLUE); chip(s, M + 3.5, 3.3, 1.6, 'TruthLens', GREEN);
    const cx = 10.6, cy = 2.1;
    [[3.1, LINE, 2], [2.4, TEAL, 3], [1.7, BLUE, 2]].forEach(([d, c, w], i) => s.addShape(pres.ShapeType.ellipse, { x: cx - d / 2, y: cy - d / 2, w: d, h: d, fill: { color: BG, transparency: 100 }, line: { color: c, width: w, dashType: i === 2 ? 'dash' : 'solid', transparency: i === 0 ? 0 : 20 }, objectName: 'ring ' + i }));
    s.addShape(pres.ShapeType.ellipse, { x: cx - 0.75, y: cy - 0.75, w: 1.5, h: 1.5, fill: { color: CARD }, line: { color: LINE, width: 1 }, objectName: 'ring core' });
    s.addImage({ data: await icon('shield', TEAL), x: cx - 0.46, y: cy - 0.46, w: 0.92, h: 0.92, altText: 'shield', objectName: 'ring shield' });
    txt(s, 'THE TEAM', { x: M, y: 4.1, w: 3, h: 0.3, fontSize: 12, bold: true, color: MUTED, charSpacing: 3, valign: 'middle' });
    const team = [['Nishad', 'Team Leader and Coder', AMBER], ['Arjun', 'Main Features and App Idea', BLUE], ['Rohan', 'Tech Stack and Coder', GREEN], ['Kartiekya', 'Use Cases and Future Implementations', TEAL]];
    for (let i = 0; i < 4; i++) {
      const x = M + i * 3.07, [n, r, col] = team[i];
      card(s, x, 4.5, 2.8, 2.05, 'team card ' + n);
      s.addShape(pres.ShapeType.ellipse, { x: x + 0.25, y: 4.72, w: 0.8, h: 0.8, fill: { color: col, transparency: 84 }, line: { color: col, width: 2 }, objectName: 'avatar ' + n });
      txt(s, n[0], { x: x + 0.25, y: 4.72, w: 0.8, h: 0.8, fontSize: 26, bold: true, color: col, align: 'center', valign: 'middle' });
      txt(s, n, { x: x + 1.2, y: 4.72, w: 1.5, h: 0.8, fontSize: 19, bold: true, valign: 'middle' });
      txt(s, r, { x: x + 0.25, y: 5.7, w: 2.35, h: 0.75, fontSize: 14, color: MUTED, valign: 'top' });
    }
    s.addNotes('Welcome. CypherSuraksha is a Chrome extension that protects people from three AI-driven threats, entirely on their own device. Nishad leads and codes. Arjun came up with the app idea and core features. Rohan chose the tech stack and codes. Kartiekya owns use cases and the future roadmap.');
  }

  // ---------- 2. Problem + use cases ----------
  {
    const s = mk('CS_CONTENT');
    s.addText('Problem and use cases', { placeholder: 'title' });
    txt(s, 'THE PROBLEM', { x: M, y: 1.4, w: 5, h: 0.3, fontSize: 12, bold: true, color: RED, charSpacing: 3, valign: 'middle' });
    const pr = [['leak', AMBER, 'Real details pasted into AI chats', 'Names, emails, IDs and keys land in a third party\'s logs.'],
      ['eye', BLUE, 'Photos feed face recognition', 'A scraped selfie can be matched to you and carries location data.'],
      ['phone', GREEN, 'Faces on video calls can be fake', 'Scammers use AI faces to impersonate people you trust.']];
    for (let i = 0; i < 3; i++) {
      const y = 1.8 + i * 1.68, [ic, c, h, d] = pr[i];
      card(s, M, y, 5.6, 1.5, 'problem card ' + (i + 1));
      await badge(s, M + 0.25, y + 0.4, 0.7, ic, c, 'problem ' + (i + 1));
      txt(s, h, { x: M + 1.15, y: y + 0.18, w: 4.25, h: 0.45, fontSize: 17, bold: true, valign: 'middle' });
      txt(s, d, { x: M + 1.15, y: y + 0.68, w: 4.25, h: 0.7, fontSize: 14, color: MUTED, valign: 'top' });
    }
    txt(s, 'USE CASES', { x: 6.75, y: 1.4, w: 5, h: 0.3, fontSize: 12, bold: true, color: TEAL, charSpacing: 3, valign: 'middle' });
    const uc = [['user', AMBER, 'Students and everyday users', 'Summarise an email thread in ChatGPT without exposing names or numbers.'],
      ['family', BLUE, 'Families sharing photos', 'Post photos with location data removed and faces cloaked.'],
      ['phone', GREEN, 'Spotting scam calls', 'A "relative" asks for money; the pill warns the face may be AI-generated.'],
      ['brief', TEAL, 'Work and confidential projects', 'Codenames and account numbers in the vault never reach a chat.']];
    for (let i = 0; i < 4; i++) {
      const y = 1.8 + i * 1.26, [ic, c, h, d] = uc[i];
      card(s, 6.75, y, 5.93, 1.14, 'use case card ' + (i + 1));
      await badge(s, 6.95, y + 0.22, 0.7, ic, c, 'use case ' + (i + 1));
      txt(s, h, { x: 7.85, y: y + 0.12, w: 4.7, h: 0.38, fontSize: 16, bold: true, valign: 'middle' });
      txt(s, d, { x: 7.85, y: y + 0.5, w: 4.7, h: 0.58, fontSize: 14, color: MUTED, valign: 'top' });
    }
    s.addNotes('Left: the three problems. Right: who it helps. Most people have no tool for any of them.');
  }

  // ---------- 3. Features ----------
  {
    const s = mk('CS_CONTENT');
    s.addText('Features', { placeholder: 'title' });
    const f = [['text', AMBER, 'PromptGuard', 'PII', ['Swaps names, emails, IDs and keys for placeholders before you send', 'Shows real values again in replies, on your screen only', 'Never-share list kept as one-way hashes']],
      ['face', BLUE, 'Pixel Cloak', 'FACES', ['Adds an invisible change to faces in photos you upload', 'Strips location data (EXIF/GPS)', '"Bypass on this site" if you prefer the original']],
      ['video', GREEN, 'TruthLens', 'WEBRTC', ['Checks faces on Meet, Zoom and WhatsApp Web calls', 'Pill: No fake found, Unsure, Fake?', 'Clear warning on sustained red']]];
    for (let i = 0; i < 3; i++) {
      const x = M + i * 4.14, [ic, col, n, tag, bl] = f[i];
      card(s, x, 1.55, 3.84, 4.0, 'feature card ' + n);
      await badge(s, x + 0.28, 1.8, 0.7, ic, col, n);
      txt(s, n, { x: x + 1.12, y: 1.8, w: 2.5, h: 0.4, fontSize: 21, bold: true, valign: 'middle' });
      txt(s, tag, { x: x + 1.12, y: 2.2, w: 2.5, h: 0.3, fontSize: 12, bold: true, color: col, charSpacing: 3, valign: 'middle' });
      s.addText(bl.map((t, k) => ({ text: t, options: { bullet: { indent: 16 }, breakLine: k < bl.length - 1, paraSpaceAfter: 8 } })), { isTextBox: true, x: x + 0.28, y: 2.8, w: 3.3, h: 2.6, fontFace: 'Arial', fontSize: 14, color: MUTED, valign: 'top', margin: 0 });
    }
    txt(s, 'ALSO INCLUDED', { x: M, y: 5.78, w: 1.7, h: 0.4, fontSize: 12, bold: true, color: MUTED, charSpacing: 3, valign: 'middle' });
    [['Popup dashboard', 2.6, 1.95], ['Trusted sites', 4.7, 1.55], ['Page diagnostics', 6.4, 1.85], ['Dark and light themes', 8.4, 2.3], ['100% on-device', 10.85, 1.6]].forEach(([l, x, w]) => chip(s, x, 5.78, w, l, TEAL));
    s.addNotes('Three shields, each with its own switch in the popup. Everything runs locally: no accounts, no servers.');
  }

  // ---------- 4. Tech stack ----------
  {
    const s = mk('CS_CONTENT');
    s.addText('Tech stack', { placeholder: 'title' });
    const t = [['FRONT-END', 'chip', AMBER, ['Preact + Tailwind popup', 'Closed Shadow DOM for on-page UI', 'TypeScript']],
      ['MIDDLE-END', 'globe', BLUE, ['Content scripts watch each page', 'MV3 service-worker router', 'Offscreen page + one Web Worker per shield']],
      ['BACK-END', 'lock', GREEN, ['None, by design', 'No servers, accounts or telemetry', 'CSP blocks all network requests']],
      ['FRAMEWORK AND BUILD', 'shield', TEAL, ['Chrome Manifest V3', 'Vite + crxjs', 'Vitest (67 unit tests), Puppeteer end-to-end']],
      ['ML RUNTIME', 'chip', AMBER, ['onnxruntime-web', 'WebGPU first, WASM fallback', 'Buffers zeroed after every inference']],
      ['MODELS', 'face', BLUE, ['bert-base-NER (INT8): PII', 'FaceNet + UltraFace: cloaking', 'ViT detector + optional GenD: video']]];
    for (let i = 0; i < 6; i++) {
      const col = i % 3, row = Math.floor(i / 3), x = M + col * 4.14, y = 1.5 + row * 2.7, [h, ic, c, bl] = t[i];
      card(s, x, y, 3.84, 2.5, 'stack card ' + h);
      await badge(s, x + 0.25, y + 0.22, 0.55, ic, c, h);
      txt(s, h, { x: x + 0.95, y: y + 0.22, w: 2.75, h: 0.55, fontSize: 14, bold: true, color: c, charSpacing: 2, valign: 'middle' });
      s.addText(bl.map((x2, k) => ({ text: x2, options: { bullet: { indent: 14 }, breakLine: k < bl.length - 1, paraSpaceAfter: 5 } })), { isTextBox: true, x: x + 0.25, y: y + 0.95, w: 3.4, h: 1.45, fontFace: 'Arial', fontSize: 14, color: TEXT, valign: 'top', margin: 0 });
    }
    s.addNotes('The "back-end" is empty on purpose: privacy comes from never sending data anywhere. The extension\'s Content Security Policy sets connect-src to none.');
  }

  // ---------- 5. Live demo ----------
  {
    const s = mk('CS_CONTENT');
    s.addText('Live demo', { placeholder: 'title' });
    s.addShape(pres.ShapeType.roundRect, { x: M - 0.06, y: 1.44, w: 8.12, h: 4.62, rectRadius: 0.1, fill: { color: CARD }, line: { color: LINE, width: 1 }, objectName: 'video frame' });
    s.addMedia({ type: 'video', path: 'demo.mp4', cover: 'data:image/png;base64,' + require('fs').readFileSync('poster_ai.png').toString('base64'), x: M, y: 1.5, w: 8.0, h: 4.5, altText: 'Screen recording of CypherSuraksha flagging an AI-generated face on a demo video call' });
    card(s, 9.0, 1.44, 3.68, 4.62, 'demo notes card');
    txt(s, 'WHAT YOU SEE', { x: 9.3, y: 1.7, w: 3.1, h: 0.35, fontSize: 12, bold: true, color: TEAL, charSpacing: 3 });
    s.addText([
      { text: 'Real person', options: { bold: true, color: GREEN, breakLine: true } }, { text: 'Green pill: "No fake found"', options: { color: MUTED, breakLine: true, paraSpaceAfter: 12 } },
      { text: 'AI-generated face', options: { bold: true, color: RED, breakLine: true } }, { text: 'Pill turns red "Fake?", then the warning dialog appears', options: { color: MUTED, breakLine: true, paraSpaceAfter: 12 } },
      { text: 'Recorded on a demo page that plays still pictures as a call tile, using the real extension.', options: { color: MUTED, fontSize: 12 } }],
      { isTextBox: true, x: 9.3, y: 2.15, w: 3.1, h: 3.7, fontFace: 'Arial', fontSize: 15, valign: 'top', margin: 0 });
    s.addNotes('Play the clip: real face stays green, AI-generated face turns red and triggers the warning. Be honest that this is a demo page with still pictures; live calls behave differently.');
  }

  // ---------- Results ----------
  {
    const s = mk('CS_CONTENT');
    s.addText('Results', { placeholder: 'title' });
    const st = [['53 / 53', TEAL, 'PII entities redacted', 'names, places, organisations in 20 test prompts (regex alone: 47%)'],
      ['72 ms', AMBER, 'median per prompt', 'redaction with the NER model on WASM'],
      ['97.5% to 30%', BLUE, 'face match rate after cloaking', 'FaceNet identification; 8 to 15 s per photo'],
      ['53 ms', GREEN, 'per video frame', 'deepfake check on a real GPU (627 ms on CPU)']];
    for (let i = 0; i < 4; i++) {
      const col = i % 2, row = Math.floor(i / 2), x = M + col * 3.4, y = 1.5 + row * 2.35, [big, c, l, d] = st[i];
      card(s, x, y, 3.2, 2.15, 'stat card ' + (i + 1));
      txt(s, big, { x: x + 0.25, y: y + 0.2, w: 2.75, h: 0.75, fontSize: i === 2 ? 26 : 34, bold: true, color: c, valign: 'middle' });
      txt(s, l, { x: x + 0.25, y: y + 0.98, w: 2.75, h: 0.35, fontSize: 14, bold: true, valign: 'middle' });
      txt(s, d, { x: x + 0.25, y: y + 1.35, w: 2.75, h: 0.7, fontSize: 12, color: MUTED, valign: 'top' });
    }
    card(s, 7.6, 1.5, 5.08, 4.55, 'model sizes card');
    txt(s, 'MODEL SIZES (MB)', { x: 7.9, y: 1.68, w: 4.5, h: 0.3, fontSize: 12, bold: true, color: TEAL, charSpacing: 3, valign: 'middle' });
    const sizes = [['Face finder', MB['face-detector.ultraface.onnx']], ['Deepfake INT8', MB['people-deepfake.int8.onnx']], ['Deepfake FP32', MB['people-deepfake.fp32.onnx']], ['PII NER INT8', MB['privacy-ner.int8.onnx']], ['Cloak FaceNet x2', MB['cloak-facenet-casia.onnx'] + MB['cloak-facenet-vggface2.onnx']], ['Face-swap (optional)', MB['people-gend.fp16.onnx']]];
    const maxMB = Math.max(...sizes.map((x) => x[1])), barX = 9.95, barMax = 1.95;
    const colors = [TEAL, TEAL, TEAL, AMBER, BLUE, MUTED];
    sizes.forEach(([label, mb], i) => {
      const y = 2.2 + i * 0.64;
      txt(s, label, { x: 7.9, y, w: 2.0, h: 0.44, fontSize: 13, valign: 'middle' });
      const w = Math.max(0.06, (mb / maxMB) * barMax);
      s.addShape(pres.ShapeType.roundRect, { x: barX, y: y + 0.08, w, h: 0.28, rectRadius: 0.05, fill: { color: colors[i] }, line: { color: colors[i], width: 0 }, objectName: 'size bar ' + label });
      txt(s, (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + ' MB', { x: barX + w + 0.1, y, w: 0.95, h: 0.44, fontSize: 13, bold: true, color: TEXT, valign: 'middle' });
    });
    txt(s, 'Measured on our dev Mac (Apple GPU). 20-sentence PII test and 40-identity face test are small, so treat them as indicative. A different recogniser, ArcFace, was barely affected by the cloak (95% still matched).', { x: M, y: 6.28, w: 12.0, h: 0.5, fontSize: 12, color: MUTED, valign: 'top' });
    s.addNotes('All numbers come from our own tests in MODELS.md. PII: 53 of 53 entities with the model, 47% with regex alone. Cloak: FaceNet identification falls from 97.5% to about 30%, but ArcFace is barely affected, which is why we want our own cloaking models. Video: 53 ms per frame on Apple Metal vs 627 ms on CPU. Sizes are the real model files.');
  }

  // ---------- 8. Future ----------
  {
    const s = mk('CS_CONTENT');
    s.addText('Future implementations', { placeholder: 'title' });
    const f = [['chip', AMBER, 'Our own cloaking models', 'Train models built for cloaking, so photos resist more face-recognition systems and cloak faster.'],
      ['globe', BLUE, 'Works on any website', 'Detect chat boxes and uploads automatically, so protection works everywhere, not only on sites we hand-coded.'],
      ['doc', GREEN, 'More security features', 'Add new protections over time. For example, a terms and conditions checker that searches a site\'s terms for bad clauses, like data selling, and warns you.'],
      ['store', TEAL, 'Publish on the Chrome Web Store', 'Ship a real extension so everyone can install it in one click.']];
    for (let i = 0; i < 4; i++) {
      const col = i % 2, row = Math.floor(i / 2), x = M + col * 6.2, y = 1.55 + row * 2.55, [ic, c, h, d] = f[i];
      card(s, x, y, 5.93, 2.3, 'future card ' + (i + 1));
      await badge(s, x + 0.3, y + 0.32, 0.85, ic, c, 'future ' + (i + 1));
      txt(s, h, { x: x + 1.4, y: y + 0.3, w: 4.2, h: 0.55, fontSize: 20, bold: true, valign: 'middle' });
      txt(s, d, { x: x + 1.4, y: y + 0.95, w: 4.2, h: 1.2, fontSize: 15, color: MUTED, valign: 'top' });
    }
    s.addNotes('Today our cloak targets FaceNet-style recognisers and our chat-site support relies on hand-written selectors. The roadmap fixes both, adds more security features (for example a terms-and-conditions checker), and gets us onto the Chrome Web Store.');
  }

  // ---------- 9. Closing ----------
  {
    const s = mk('CS_CLOSE');
    s.addText('Thank you', { placeholder: 'title' });
    txt(s, 'Your data stays yours.', { x: M, y: 3.7, w: 7, h: 0.6, fontSize: 24, color: TEAL, bold: true });
    txt(s, 'Questions?', { x: M, y: 4.4, w: 7, h: 0.5, fontSize: 20, color: MUTED });
    txt(s, 'github.com/nishadiyer/CypherSuraksha', { x: M, y: 5.3, w: 7, h: 0.4, fontSize: 16, color: BLUE });
    const cx = 10.1, cy = 3.55;
    [[3.5, LINE, 2], [2.7, TEAL, 3], [1.9, BLUE, 2]].forEach(([d, c, w], i) => s.addShape(pres.ShapeType.ellipse, { x: cx - d / 2, y: cy - d / 2, w: d, h: d, fill: { color: BG, transparency: 100 }, line: { color: c, width: w, dashType: i === 2 ? 'dash' : 'solid', transparency: i === 0 ? 0 : 20 }, objectName: 'ring ' + i }));
    s.addShape(pres.ShapeType.ellipse, { x: cx - 0.9, y: cy - 0.9, w: 1.8, h: 1.8, fill: { color: CARD }, line: { color: LINE, width: 1 }, objectName: 'ring core' });
    s.addImage({ data: await icon('shield', TEAL), x: cx - 0.55, y: cy - 0.55, w: 1.1, h: 1.1, altText: 'shield', objectName: 'ring shield' });
  }

  await pres.writeFile({ fileName: 'CypherSuraksha.pptx' });
  await applyTheme('CypherSuraksha.pptx', THEME);
  console.log('written');
})().catch((e) => { console.error(e); process.exit(1); });
