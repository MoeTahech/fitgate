import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** Element node of server-rendered markup, for asserting structure and attributes without a DOM. */
export type MarkupElement = {
  tag: string;
  attrs: Record<string, string>;
  children: MarkupNode[];
  parent: MarkupElement | null;
};
export type MarkupNode = MarkupElement | string;

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#x27": "'", "#39": "'", nbsp: " " };
const TOKEN = /<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)((?:\s+[^\s=/>]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)|(<!--[\s\S]*?-->)/g;
const ATTR = /([^\s=/>]+)(?:="([^"]*)")?/g;

function decode(value: string): string {
  return value.replace(/&(#x27|#39|amp|lt|gt|quot|nbsp);/g, (_match, name: string) => ENTITIES[name]);
}

export function parseMarkup(html: string): MarkupElement {
  const root: MarkupElement = { tag: "#root", attrs: {}, children: [], parent: null };
  let current = root;
  for (const [, closing, opening, rawAttrs, text] of html.matchAll(TOKEN)) {
    if (closing) {
      if (current.tag !== closing) throw new Error(`Unexpected </${closing}> inside <${current.tag}>`);
      current = current.parent ?? root;
    } else if (opening) {
      const attrs: Record<string, string> = {};
      for (const [, name, value] of (rawAttrs ?? "").matchAll(ATTR)) attrs[name] = decode(value ?? "");
      const element: MarkupElement = { tag: opening, attrs, children: [], parent: current };
      current.children.push(element);
      if (!VOID.has(opening)) current = element;
    } else if (text) {
      current.children.push(decode(text));
    }
  }
  if (current !== root) throw new Error(`Unclosed <${current.tag}>`);
  return root;
}

export function renderMarkup(element: ReactElement): MarkupElement {
  return parseMarkup(renderToStaticMarkup(element));
}

export function elements(node: MarkupElement): MarkupElement[] {
  return node.children.filter((child): child is MarkupElement => typeof child !== "string");
}

/** All descendants matching `predicate`, in document order. */
export function findAll(node: MarkupElement, predicate: (element: MarkupElement) => boolean): MarkupElement[] {
  return elements(node).flatMap((child) => [...(predicate(child) ? [child] : []), ...findAll(child, predicate)]);
}

export function find(node: MarkupElement, predicate: (element: MarkupElement) => boolean): MarkupElement | undefined {
  return findAll(node, predicate)[0];
}

export const byTag = (tag: string) => (element: MarkupElement) => element.tag === tag;
export const byAttr = (name: string, value?: string) => (element: MarkupElement) =>
  value === undefined ? name in element.attrs : element.attrs[name] === value;

export function textOf(node: MarkupNode): string {
  return typeof node === "string" ? node : node.children.map(textOf).join("");
}

export function classesOf(node: MarkupElement | undefined): string[] {
  return (node?.attrs.class ?? "").split(/\s+/).filter(Boolean);
}
