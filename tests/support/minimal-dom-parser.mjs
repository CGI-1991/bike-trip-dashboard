// Minimal XML DOM shim so `src/gpx/parser.ts` (which calls the browser's
// `DOMParser`) can run unmodified under plain Node in tests. Implements only
// the small subset actually used by `parseGpxDocument`: documentElement,
// children, localName, textContent, getAttribute, getElementsByTagName(NS).
// GPX files here have no element prefixes, only a default namespace, so a
// namespace-blind localName match is sufficient.

function decodeEntities(text) {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

function stripPrefix(name) {
  const index = name.indexOf(':')
  return index === -1 ? name : name.slice(index + 1)
}

class MiniElement {
  constructor(localName) {
    this.localName = localName
    this.attributes = new Map()
    this.children = []
    this.ownText = ''
  }

  cloneNode(deep = false) {
    return { ...this, rawXml: deep ? this.rawXml : `<${this.tagName}${this.rawAttributes}/>` }
  }

  get textContent() {
    return this.ownText + this.children.map((child) => child.textContent).join('')
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null
  }

  getElementsByTagNameNS(_namespace, localName) {
    const results = []
    const walk = (element) => {
      for (const child of element.children) {
        if (localName === '*' || child.localName === localName) results.push(child)
        walk(child)
      }
    }
    walk(this)
    return results
  }

  getElementsByTagName(localName) {
    return this.getElementsByTagNameNS('*', localName)
  }
}

class MiniDocument {
  constructor(root) {
    this.documentElement = root
  }

  getElementsByTagName(localName) {
    return this.documentElement === null ? [] : this.documentElement.getElementsByTagNameNS('*', localName)
  }

  getElementsByTagNameNS(namespace, localName) {
    return this.documentElement === null ? [] : this.documentElement.getElementsByTagNameNS(namespace, localName)
  }
}

const TOKEN_PATTERN = /<(\/?)([a-zA-Z_][\w:.-]*)((?:\s+[a-zA-Z_][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
const ATTRIBUTE_PATTERN = /([a-zA-Z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

export class MinimalDOMParser {
  parseFromString(xmlText) {
    const cleaned = xmlText.replace(/<\?xml[^>]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '')
    const stack = []
    let root = null
    let match

    TOKEN_PATTERN.lastIndex = 0
    while ((match = TOKEN_PATTERN.exec(cleaned)) !== null) {
      const [, closing, rawTagName, rawAttributes, selfClosing, textNode] = match

      if (textNode !== undefined) {
        if (stack.length > 0) stack[stack.length - 1].ownText += decodeEntities(textNode)
        continue
      }

      if (closing === '/') {
        const element = stack.pop()
        if (element) element.rawXml = cleaned.slice(element.sourceStart, TOKEN_PATTERN.lastIndex)
        continue
      }

      const element = new MiniElement(stripPrefix(rawTagName))
      element.tagName = rawTagName
      element.prefix = rawTagName.includes(':') ? rawTagName.split(':')[0] : null
      element.rawAttributes = rawAttributes
      element.sourceStart = match.index
      element.namespaces = { ...(stack.at(-1)?.namespaces ?? {}) }
      if (rawAttributes) {
        let attributeMatch
        ATTRIBUTE_PATTERN.lastIndex = 0
        while ((attributeMatch = ATTRIBUTE_PATTERN.exec(rawAttributes)) !== null) {
          const value = attributeMatch[2] !== undefined ? attributeMatch[2] : attributeMatch[3]
          element.attributes.set(stripPrefix(attributeMatch[1]), decodeEntities(value ?? ''))
          if (attributeMatch[1] === 'xmlns') element.namespaces[''] = value
          else if (attributeMatch[1].startsWith('xmlns:')) element.namespaces[attributeMatch[1].slice(6)] = value
        }
      }

      element.namespaceURI = element.namespaces[element.prefix ?? ''] ?? null
      if (selfClosing === '/') element.rawXml = match[0]
      if (stack.length > 0) stack[stack.length - 1].children.push(element)
      else root = element

      if (selfClosing !== '/') stack.push(element)
    }

    return new MiniDocument(root)
  }
}

export function installMinimalDOMParser() {
  globalThis.DOMParser = MinimalDOMParser
}
