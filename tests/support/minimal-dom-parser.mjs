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
        stack.pop()
        continue
      }

      const element = new MiniElement(stripPrefix(rawTagName))
      if (rawAttributes) {
        let attributeMatch
        ATTRIBUTE_PATTERN.lastIndex = 0
        while ((attributeMatch = ATTRIBUTE_PATTERN.exec(rawAttributes)) !== null) {
          const value = attributeMatch[2] !== undefined ? attributeMatch[2] : attributeMatch[3]
          element.attributes.set(stripPrefix(attributeMatch[1]), decodeEntities(value ?? ''))
        }
      }

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
