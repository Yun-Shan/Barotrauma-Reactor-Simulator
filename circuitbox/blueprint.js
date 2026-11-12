'use strict';

const catalog = require('./catalog.js');
const START = '<<<STRINGSTART>>>', END = '<<<STRINGEND>>>';
const reserved = new Set(['id', 'position', 'backingitemid', 'usedresource', 'item', 'class']);
const metadata = Symbol('blueprint document');

function decodeEntities(text) {
  const latin = ['nbsp','iexcl','cent','pound','curren','yen','brvbar','sect','uml','copy','ordf','laquo','not','shy','reg','macr','deg','plusmn','sup2','sup3','acute','micro','para','middot','cedil','sup1','ordm','raquo','frac14','frac12','frac34','iquest'];
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, key) => {
    if (key[0] === '#') {
      const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      if (code > 0x10ffff) throw new SyntaxError('Invalid character reference ' + entity);
      return code === 13 ? '\n' : String.fromCodePoint(code);
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[key] ?? (latin.includes(key) ? String.fromCharCode(160 + latin.indexOf(key)) : entity);
  });
}
function escapeXml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/\r/g, '&#xD;').replace(/\n/g, '&#xA;').replace(/\t/g, '&#x9;');
}
function encodeString(value) {
  return START + String(value ?? '').replace(/<<<STRING(?:START|END)>>>/g, value => '\\' + value) + END;
}

// Blueprints .txt is not XML: unquoted delimiter strings can contain XML syntax.
// Tokenize it before interpreting tags, rather than replacing strings with a regex.
function parseDocument(source) {
  if (typeof source !== 'string') throw new TypeError('Blueprint must be text');
  source = source.replace(/^\uFEFF/, '');
  let i = 0;
  const root = { name: '#document', attributes: {}, children: [] }, stack = [root];
  function fail(message) { throw new SyntaxError(`${message} at offset ${i}`); }
  function whitespace() { while (/\s/.test(source[i] || '') && i < source.length) i++; }
  function identifier() {
    const m = /^[A-Za-z_][\w.:-]*/.exec(source.slice(i));
    if (!m) fail('Expected name');
    i += m[0].length; return m[0];
  }
  function stringValue() {
    i += START.length;
    let value = '';
    while (i < source.length) {
      if (source[i] === '\\' && (source.startsWith(START, i + 1) || source.startsWith(END, i + 1))) {
        const delimiter = source.startsWith(START, i + 1) ? START : END;
        value += delimiter; i += delimiter.length + 1;
      } else if (source.startsWith(END, i)) { i += END.length; return value; }
      else value += source[i++];
    }
    fail('Unterminated blueprint string');
  }
  while (i < source.length) {
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4); if (end < 0) fail('Unterminated comment');
      stack.at(-1).children.push({ raw: source.slice(i, end + 3) }); i = end + 3; continue;
    }
    if (source.startsWith('<?', i)) {
      const end = source.indexOf('?>', i + 2); if (end < 0) fail('Unterminated instruction');
      stack.at(-1).children.push({ raw: source.slice(i, end + 2) }); i = end + 2; continue;
    }
    if (source.startsWith('<![CDATA[', i)) {
      const end = source.indexOf(']]>', i + 9); if (end < 0) fail('Unterminated CDATA');
      stack.at(-1).children.push({ raw: source.slice(i, end + 3) }); i = end + 3; continue;
    }
    if (source.startsWith('<!', i)) fail('Document type declarations are not supported');
    if (source[i] !== '<') {
      const end = source.indexOf('<', i), stop = end < 0 ? source.length : end;
      const raw = source.slice(i, stop);
      if (raw.trim()) stack.at(-1).children.push({ raw });
      i = stop; continue;
    }
    i++;
    if (source[i] === '/') {
      i++; const name = identifier(); whitespace();
      if (source[i++] !== '>' || stack.length < 2 || stack.at(-1).name !== name) fail('Mismatched closing tag ' + name);
      stack.pop(); continue;
    }
    const node = { name: identifier(), attributes: Object.create(null), children: [] };
    let closed = false;
    while (i < source.length) {
      whitespace();
      if (source.startsWith('/>', i)) { i += 2; closed = true; break; }
      if (source[i] === '>') { i++; break; }
      const key = identifier(); whitespace(); if (source[i++] !== '=') fail('Expected equals'); whitespace();
      const quote = source[i] === '"' || source[i] === "'" ? source[i++] : null;
      let value;
      if (source.startsWith(START, i)) value = stringValue();
      else if (quote) {
        const end = source.indexOf(quote, i); if (end < 0) fail('Unterminated attribute');
        value = decodeEntities(source.slice(i, end)); i = end;
      } else fail('Expected quoted or delimiter string');
      if (quote && source[i++] !== quote) fail('Expected closing quote');
      if (Object.hasOwn(node.attributes, key)) fail('Duplicate attribute ' + key);
      node.attributes[key] = value;
    }
    stack.at(-1).children.push(node);
    if (!closed) stack.push(node);
  }
  if (stack.length !== 1) fail('Unclosed tag ' + stack.at(-1).name);
  return root;
}
function attr(node, key, fallback = '') {
  const actual = Object.keys(node.attributes).find(k => k.toLowerCase() === key.toLowerCase());
  return actual === undefined ? fallback : node.attributes[actual];
}
function descendants(node, name) {
  return (node.children || []).flatMap(n => n.name ? [...(n.name.toLowerCase() === name.toLowerCase() ? [n] : []), ...descendants(n, name)] : []);
}
function child(node, name) { return node.children.find(n => n.name?.toLowerCase() === name.toLowerCase()); }
function vector(text, fallback = { x: 0, y: 0 }) {
  const v = text.split(',').map(Number);
  return v.length === 2 && v.every(Number.isFinite) ? { x: v[0], y: v[1] } : { ...fallback };
}
function unsigned(value, description) {
  if (!/^\d+$/.test(String(value)) || Number(value) > 65535) throw new SyntaxError('Invalid ' + description + ': ' + value);
  return Number(value);
}
function nodeInfo(node, position) {
  return { position: node ? vector(attr(node, 'pos'), position) : position, labels: Object.fromEntries((node?.children || [])
    .filter(n => n.name === 'ConnectionLabelOverride').map(n => [attr(n, 'name'), attr(n, 'value')])) };
}
function parseBlueprint(source, options = {}) {
  const doc = parseDocument(source), items = descendants(doc, 'Item');
  const boxes = descendants(doc, 'CircuitBox');
  const box = options.itemId === undefined ? boxes[0] : boxes.find(b => items.some(n => n.children.includes(b) && attr(n, 'ID') === String(options.itemId)));
  if (!box) throw new SyntaxError('No CircuitBox found');
  if (boxes.length > 1 && options.itemId === undefined) throw new SyntaxError('Multiple circuit boxes: specify itemId');
  const item = items.find(n => n.children.includes(box));
  const components = box.children.filter(n => n.name === 'Component').map(node => {
    let prefab = attr(node, 'item'), className = attr(node, 'Class'), properties = Object.fromEntries(Object.entries(node.attributes).filter(([k]) => !reserved.has(k.toLowerCase())));
    // Standard game XML stores instance values on the backing item instead.
    if (!prefab && item) {
      const slot = attr(node, 'backingitemid').split(',').map(Number);
      const container = item.children.filter(n => n.name === 'ItemContainer')[0];
      const backingId = attr(container || { attributes: {} }, 'contained').split(',')[slot[0]]?.split(';')[slot[1]];
      const backing = items.find(n => attr(n, 'ID') === backingId);
      if (backing) {
        prefab = attr(backing, 'identifier'); className = catalog[prefab]?.className || '';
        const instance = child(backing, className); if (instance) properties = { ...instance.attributes, ...properties };
      }
    }
    return { id: unsigned(attr(node, 'id'), 'component ID'), prefab, className: className || catalog[prefab]?.className,
      properties, position: vector(attr(node, 'position')), backingItemId: attr(node, 'backingitemid'), usedResource: attr(node, 'usedresource', 'fpgacircuit') };
  });
  const wires = box.children.filter(n => n.name === 'Wire').map(node => {
    function endpoint(name) {
      const n = child(node, name); if (!n) throw new SyntaxError('Wire missing ' + name);
      const target = attr(n, 'target');
      return { name: attr(n, 'name'), target: target === '' ? null : unsigned(target, 'wire target') };
    }
    return { id: unsigned(attr(node, 'id'), 'wire ID'), prefab: attr(node, 'prefab', 'redwire'), backingItemId: attr(node, 'backingitemid'), from: endpoint('From'), to: endpoint('To') };
  });
  const panel = item && child(item, 'ConnectionPanel');
  const portNames = direction => panel ? panel.children.filter(n => n.name === direction).map(n => attr(n, 'name')) : Array.from({ length: 10 }, (_, i) => `signal_${direction === 'input' ? 'in' : 'out'}${i}`);
  const blueprint = { components, wires, inputPorts: portNames('input'), outputPorts: portNames('output'), inputNode: nodeInfo(child(box, 'InputNode'), { x: -512, y: 0 }), outputNode: nodeInfo(child(box, 'OutputNode'), { x: 512, y: 0 }),
    labels: box.children.filter(n => n.name === 'Label').map(n => ({ ...n.attributes })), itemId: item ? attr(item, 'ID') : '' };
  Object.defineProperty(blueprint, metadata, { value: { doc, box, source, original: JSON.stringify(blueprint) } });
  return blueprint;
}
function makeNode(name, attributes = {}, children = []) { return { name, attributes, children }; }
function serializeNode(node, depth = 0) {
  if (node.raw !== undefined) return '  '.repeat(depth) + node.raw;
  if (node.name === '#document') return node.children.map(n => serializeNode(n, depth)).join('\n') + '\n';
  const attrs = Object.entries(node.attributes).map(([key, value]) => {
    if (node.name === 'Component' && !['id', 'position', 'backingitemid', 'usedresource'].includes(key.toLowerCase())) return ` ${key}=${encodeString(value)}`;
    return ` ${key}="${escapeXml(value)}"`;
  }).join('');
  const pad = '  '.repeat(depth);
  return node.children.length ? `${pad}<${node.name}${attrs}>\n${node.children.map(n => serializeNode(n, depth + 1)).join('\n')}\n${pad}</${node.name}>` : `${pad}<${node.name}${attrs} />`;
}
function writeBlueprint(blueprint, options = {}) {
  const meta = blueprint[metadata];
  if (meta && !options.canonical && meta.original === JSON.stringify(blueprint)) return meta.source;
  const doc = meta ? structuredClone(meta.doc) : makeNode('#document', {}, [makeNode('Root', {}, [makeNode('Item', { identifier: 'circuitbox', ID: blueprint.itemId || '1' }, [makeNode('CircuitBox')])])]);
  const box = descendants(doc, 'CircuitBox')[meta ? descendants(meta.doc, 'CircuitBox').indexOf(meta.box) : 0];
  if (!meta) {
    const item = descendants(doc, 'Item')[0];
    item.children.unshift(makeNode('ConnectionPanel', {}, [
      ...(blueprint.inputPorts || Array.from({ length: 10 }, (_, i) => 'signal_in' + i)).map(name => makeNode('input', { name })),
      ...(blueprint.outputPorts || Array.from({ length: 10 }, (_, i) => 'signal_out' + i)).map(name => makeNode('output', { name }))
    ]));
  } else {
    const item = descendants(doc, 'Item').find(n => n.children.includes(box));
    if (item) {
      let panel = child(item, 'ConnectionPanel');
      if (!panel) { panel = makeNode('ConnectionPanel'); item.children.unshift(panel); }
      for (const [direction, names] of [['input', blueprint.inputPorts], ['output', blueprint.outputPorts]]) {
        if (!names || JSON.stringify(panel.children.filter(n => n.name === direction).map(n => attr(n, 'name'))) === JSON.stringify(names)) continue;
        const existing = new Map(panel.children.filter(n => n.name === direction).map(n => [attr(n, 'name'), n]));
        const pins = names.map(name => existing.get(name) || makeNode(direction, { name }));
        const index = panel.children.findIndex(n => n.name === direction);
        panel.children = panel.children.filter(n => n.name !== direction);
        panel.children.splice(index < 0 ? panel.children.length : index, 0, ...pins);
      }
    }
  }
  const preserved = box.children.filter(n => !['InputNode', 'OutputNode', 'Component', 'Wire', 'Label'].includes(n.name));
  function io(name, info, fallback) {
    info ||= { position: fallback, labels: {} };
    return makeNode(name, { pos: `${info.position.x},${info.position.y}` }, Object.entries(info.labels || {}).map(([name, value]) => makeNode('ConnectionLabelOverride', { name, value })));
  }
  box.children = [io('InputNode', blueprint.inputNode, { x: -512, y: 0 }), io('OutputNode', blueprint.outputNode, { x: 512, y: 0 }), ...preserved,
    ...blueprint.components.map(c => makeNode('Component', { id: c.id, position: `${c.position?.x || 0},${c.position?.y || 0}`, backingitemid: c.backingItemId ?? `${c.id},0`, usedresource: c.usedResource || 'fpgacircuit',
      Class: c.className || catalog[c.prefab]?.className, ...c.properties, item: c.prefab })),
    ...blueprint.wires.map(w => makeNode('Wire', { id: w.id, backingitemid: w.backingItemId ?? (w.from.target != null && w.to.target != null ? `${w.id},0` : ''), prefab: w.prefab || 'redwire' },
      ['from', 'to'].map(key => makeNode(key === 'from' ? 'From' : 'To', { name: w[key].name, target: w[key].target ?? '' })))),
    ...(blueprint.labels || []).map(attrs => makeNode('Label', attrs))];
  return serializeNode(doc);
}

function readBlueprintFile(path, options) { return parseBlueprint(require('node:fs').readFileSync(path, 'utf8'), options); }
function writeBlueprintFile(path, blueprint, options) { require('node:fs').writeFileSync(path, writeBlueprint(blueprint, options), 'utf8'); }
module.exports = { parseBlueprint, writeBlueprint, readBlueprintFile, writeBlueprintFile, parseDocument, encodeString, decodeEntities };
