/// <reference types="zotero-types" />

// Bootstrap sandbox globals
declare const rootURI: string;
declare const __env__: string;

// XPCOM Components (available in Zotero's Mozilla environment)
declare const Components: {
  classes: { [contractID: string]: any };
  interfaces: { [name: string]: any };
};

declare const Services: {
  scriptloader: {
    loadSubScript(url: string, scope?: object): void;
  };
  [key: string]: any;
};

// Extend Window with Zotero-specific properties
interface Window {
  ZoteroPane?: _ZoteroTypes.ZoteroPane;
}

// Extend Document with createXULElement
interface Document {
  createXULElement(tagName: string): XUL.Element;
}

// XUL namespace
declare namespace XUL {
  interface Element extends HTMLElement {
    id: string;
  }
}
