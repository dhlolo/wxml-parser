import type { CstNode, IToken } from "chevrotain";
import { map, get, pick, sortBy } from "lodash";
import { BaseWxmlCstVisitor } from "../cst";
import {
  mergeLocation,
  sortCstChildren,
  parseInlineJS,
  convertLexerErrorToNode,
  convertParseErrorToNode,
  sortTokenChildren,
  sortASTNode,
} from "./util";

type ICtx = Record<string, CstNode[]>;

class CstToAstVisitor extends BaseWxmlCstVisitor {
  eslintMode: boolean;
  tokenVector: any[];

  constructor() {
    super();
  }

  setState({ tokenVector, eslintMode }) {
    this.tokenVector = tokenVector;
    this.eslintMode = eslintMode;
  }

  visit(cstNode, params = {}) {
    return super.visit(cstNode, { location: cstNode.location, ...params });
  }

  /**
   * AST - WXDocument
   */
  document(ctx: ICtx, { location, lexErrors, parseErrors }) {
    // sort child node first
    const child = sortCstChildren(ctx);
    // build root node
    const astNode = {
      type: "Program",
      body: child.map((node) => this.visit(node)),
      comments: [],
      errors: [
        ...(lexErrors || []).map(convertLexerErrorToNode),
        ...(parseErrors || []).map(convertParseErrorToNode),
      ],
      tokens: [],
    };
    mergeLocation(astNode, location);
    return astNode;
  }

  /**
   * AST - WXScript
   */
  wxs(ctx: Record<string, IToken[]>, { location }) {
    // process wxs inline js string first
    const astNode = {
      type: "WXScript",
      name: "wxs",
      value: null,
      startTag: null,
      endTag: null,
    };

    if (ctx.WXS_START?.[0] && (ctx.START_CLOSE?.[0] || ctx.SLASH_CLOSE?.[0])) {
      const startTagLocation = {
        ...pick(ctx.WXS_START?.[0], [
          "startOffset",
          "startLine",
          "startColumn",
        ]),
        ...pick(ctx.START_CLOSE?.[0] || ctx.SLASH_CLOSE?.[0], [
          "endOffset",
          "endLine",
          "endColumn",
        ]),
      };
      astNode.startTag = {
        type: "WXStartTag",
        name: "wxs",
        attributes: ctx.attribute
          ? map(ctx.attribute, this.visit.bind(this))
          : [],
        selfClosing: !!ctx.SLASH_CLOSE,
      };
      mergeLocation(astNode.startTag, startTagLocation);
    }

    if (ctx.WXS_SLASH_CLOSE?.[0]) {
      astNode.endTag = {
        type: "WXEndTag",
        name: "wxs",
      };
      const endTagLocation = pick(ctx.WXS_SLASH_CLOSE[0], [
        "startOffset",
        "startLine",
        "startColumn",
        "endOffset",
        "endLine",
        "endColumn",
      ]);
      mergeLocation(astNode.endTag, endTagLocation);
    }

    mergeLocation(astNode, location);
    // gen wxs content
    if (ctx.wxscontent?.[0]) {
      astNode.value = this.visit.bind(this)(ctx.wxscontent?.[0]);
      if (this.eslintMode) {
        parseInlineJS(astNode);
      }
    }
    return astNode;
  }

  /**
   * wxscontent
   */
  wxscontent(ctx, { location }) {
    let allTokens = [];
    if (ctx.SEA_WS !== undefined) {
      allTokens = allTokens.concat(ctx.SEA_WS);
    }
    if (ctx.INLINE_WXS_TEXT !== undefined) {
      allTokens = allTokens.concat(ctx.INLINE_WXS_TEXT);
    }
    const sortedTokens = sortBy(allTokens, ["startOffset"]);
    const fullText = map(sortedTokens, "image").join("");
    return fullText;
  }

  /**
   * AST - WXAttribute
   */
  attribute(ctx, { location }) {
    const attributeValue = ctx.attributeValue
      ? this.visit(ctx.attributeValue[0])
      : null;

    const astNode = {
      type: "WXAttribute",
      key: ctx.NAME[0].image,
      value: attributeValue,
    };
    mergeLocation(astNode, location);
    return astNode;
  }

  /**
   * AST - WXAttributeValue
   */
  attributeValue(ctx, { location }) {
    if (ctx.PURE_STRING !== undefined) {
      const raw = ctx.PURE_STRING[0].image;
      const astNode = {
        type: "WXAttributeValue",
        value: raw
          .split("")
          .slice(1, raw.length - 1)
          .join(""),
        raw: ctx.PURE_STRING[0].image,
        quote: raw?.length ? raw.slice(0, 1) : null,
      };
      mergeLocation(astNode, location);
      return astNode;
    } else if (ctx.doubleQuoteAttributeVal !== undefined) {
      return this.visit(ctx.doubleQuoteAttributeVal[0]);
    } else if (ctx.singleQuoteAttributeVal !== undefined) {
      return this.visit(ctx.singleQuoteAttributeVal[0]);
    }
  }

  doubleQuoteAttributeVal(ctx, { location }) {
    const interpolationASTS = map(
      ctx.attributeValInterpolation,
      this.visit.bind(this)
    );
    const quote = '"';
    let strASTs = map(ctx.PURE_STRING_IN_DOUBLE_QUOTE, (item) => {
      const astNode = {
        value: item.image,
        type: "WXText",
      };
      mergeLocation(astNode, item);
      return astNode;
    });
    const sortedValue = sortASTNode(interpolationASTS.concat(strASTs));
    const astNode = {
      type: "WXAttributeValue",
      value: sortedValue,
      interpolation: interpolationASTS,
      quote: quote,
    };
    mergeLocation(astNode, location);
    return astNode;
  }

  attributeValInterpolation(ctx, { location }) {
    const child = sortTokenChildren(ctx);
    // @ts-expect-error
    const value = (child || []).map((token) => token.image).join("");
    const astNode = {
      type: "WXAttributeValInterpolation",
      rawValue: value,
      value: value.replace(/^{{/, "").replace(/}}$/, ""),
    };
    mergeLocation(astNode, location);
    return astNode;
  }

  singleQuoteAttributeVal(ctx, { location }) {
    const interpolationASTS = map(
      ctx.attributeValInterpolation,
      this.visit.bind(this)
    );
    const quote = "'";
    let strASTs = map(ctx.PURE_STRING_IN_SINGLE_QUOTE, (item) => {
      const astNode = {
        value: item.image,
        type: "WXText",
      };
      mergeLocation(astNode, item);
      return astNode;
    });
    const sortedValue = sortASTNode(interpolationASTS.concat(strASTs));
    const astNode = {
      type: "WXAttributeValue",
      value: sortedValue,
      interpolation: interpolationASTS,
      quote: quote,
    };
    mergeLocation(astNode, location);
    return astNode;
  }

  /**
   * AST - WXInterpolation
   */
  interpolation(ctx, { location }) {
    const child = sortTokenChildren(ctx);
    // @ts-expect-error
    const value = (child || []).map((token) => token.image).join("");
    const astNode = {
      type: "WXInterpolation",
      rawValue: value,
      value: value.replace(/^{{/, "").replace(/}}$/, ""),
    };
    mergeLocation(astNode, location);
    return astNode;
  }

  content(ctx) {
    // sort child node first
    const child = sortCstChildren(ctx);
    return child.map((node) => this.visit(node));
  }

  comment(ctx, { location }) {
    const astNode = {
      type: "WXComment",
      value: (ctx.COMMENT[0].image || "")
        .replace(/^<!--/, "")
        .replace(/-->$/, ""),
    };
    mergeLocation(astNode, location);
    return astNode;
  }

  element(ctx, { location }) {
    const astNode = {
      type: "WXElement",
      name: ctx.NAME[0].image,
      children: [],
      startTag: null,
      endTag: null,
    };
    if (ctx.OPEN?.[0] && (ctx.START_CLOSE?.[0] || ctx.SLASH_CLOSE?.[0])) {
      astNode.startTag = {
        type: "WXStartTag",
        name: astNode.name,
        attributes: ctx.attribute
          ? map(ctx.attribute, this.visit.bind(this))
          : [],
        selfClosing: !!ctx.SLASH_CLOSE,
      };
      const startTagLocation = {
        ...pick(ctx.OPEN?.[0], ["startOffset", "startLine", "startColumn"]),
        ...pick(ctx.START_CLOSE?.[0] || ctx.SLASH_CLOSE?.[0], [
          "endOffset",
          "endLine",
          "endColumn",
        ]),
      };
      mergeLocation(astNode.startTag, startTagLocation);
    }

    if (ctx.SLASH_OPEN?.[0] && ctx.END?.[0]) {
      astNode.endTag = {
        type: "WXEndTag",
        name: get(ctx, "END_NAME[0].image"),
      };
      const endTagLocation = {
        ...pick(ctx.SLASH_OPEN[0], ["startOffset", "startLine", "startColumn"]),
        ...pick(ctx.END[0], ["endOffset", "endLine", "endColumn"]),
      };
      mergeLocation(astNode.endTag, endTagLocation);
    }

    if (ctx.content !== undefined) {
      astNode.children = this.visit(ctx.content[0]);
    }
    mergeLocation(astNode, location);
    return astNode;
  }

  chardata(ctx, { location }) {
    const astNode = {
      type: "WXText",
      value: null,
    };

    let allTokens = [];
    if (ctx.SEA_WS !== undefined) {
      allTokens = allTokens.concat(ctx.SEA_WS);
    }
    if (ctx.TEXT !== undefined) {
      allTokens = allTokens.concat(ctx.TEXT);
    }
    const sortedTokens = sortBy(allTokens, ["startOffset"]);
    const fullText = map(sortedTokens, "image").join("");
    astNode.value = fullText;
    mergeLocation(astNode, location);
    return astNode;
  }
}

const AstBuilder = new CstToAstVisitor();

export function buildAst(
  docCst,
  tokenVector,
  lexErrors,
  parseErrors,
  eslintMode?: boolean
) {
  AstBuilder.setState({ tokenVector, eslintMode });
  const wxmlDocAst = AstBuilder.visit(docCst, { lexErrors, parseErrors });
  return wxmlDocAst;
}
